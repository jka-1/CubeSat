#include "peripheral_sensors.h"

#include <stdint.h>
#include <string.h>

#include "app_config.h"
#include "esp_adc/adc_cali.h"
#include "esp_adc/adc_cali_scheme.h"
#include "esp_adc/adc_oneshot.h"
#include "esp_log.h"
#include "i2c_bus_monitor.h"
#include "peripheral_sensor_math.h"

static const char *TAG = "peripheral_sensors";

#define PERIPHERAL_ADC_SAMPLE_COUNT 16
#define PERIPHERAL_ADC_MAX_RAW      4095

static adc_oneshot_unit_handle_t s_adc_handle;
static adc_cali_handle_t s_calibration_handle;
static adc_channel_t s_temperature_channel;
static adc_channel_t s_light_channel;
static bool s_temperature_enabled;
static bool s_light_enabled;

static bool resolve_adc1_channel(
    int gpio,
    const char *signal_name,
    adc_channel_t *out_channel)
{
    if (gpio < 0) {
        ESP_LOGI(TAG, "%s is unassigned; sensor disabled", signal_name);
        return false;
    }

    if (gpio == I2C_MONITOR_SCL_GPIO ||
        gpio == I2C_MONITOR_SDA_GPIO ||
        gpio == DEMO_RGB_LED_GPIO) {
        ESP_LOGE(
            TAG,
            "%s GPIO%d conflicts with an existing board signal",
            signal_name,
            gpio);
        return false;
    }

    adc_unit_t unit = ADC_UNIT_1;
    adc_channel_t channel = ADC_CHANNEL_0;
    const esp_err_t status = adc_oneshot_io_to_channel(
        gpio,
        &unit,
        &channel);

    if (status != ESP_OK || unit != ADC_UNIT_1) {
        ESP_LOGE(
            TAG,
            "%s GPIO%d is not an ESP32-S3 ADC1-capable GPIO",
            signal_name,
            gpio);
        return false;
    }

    *out_channel = channel;
    return true;
}

static esp_err_t read_calibrated_channel(
    adc_channel_t channel,
    int *out_voltage_mv,
    bool *out_saturated)
{
    int64_t voltage_sum_mv = 0;
    bool saturated = false;

    for (int index = 0; index < PERIPHERAL_ADC_SAMPLE_COUNT; index++) {
        int raw = 0;
        esp_err_t status = adc_oneshot_read(
            s_adc_handle,
            channel,
            &raw);

        if (status != ESP_OK) {
            return status;
        }

        int voltage_mv = 0;
        status = adc_cali_raw_to_voltage(
            s_calibration_handle,
            raw,
            &voltage_mv);

        if (status != ESP_OK) {
            return status;
        }

        voltage_sum_mv += voltage_mv;
        saturated = saturated || raw >= PERIPHERAL_ADC_MAX_RAW;
    }

    *out_voltage_mv = (int)(
        (voltage_sum_mv + (PERIPHERAL_ADC_SAMPLE_COUNT / 2)) /
        PERIPHERAL_ADC_SAMPLE_COUNT);
    *out_saturated = saturated;
    return ESP_OK;
}

esp_err_t peripheral_sensors_init(void)
{
    s_temperature_enabled = resolve_adc1_channel(
        DEMO_TEMP_OUT_GPIO,
        "TEMP_OUT",
        &s_temperature_channel);
    s_light_enabled = resolve_adc1_channel(
        DEMO_LIGHT_OUT_GPIO,
        "LIGHT_OUT",
        &s_light_channel);

    if (s_temperature_enabled &&
        s_light_enabled &&
        s_temperature_channel == s_light_channel) {
        ESP_LOGE(
            TAG,
            "TEMP_OUT and LIGHT_OUT resolve to the same ADC1 channel; both disabled");
        s_temperature_enabled = false;
        s_light_enabled = false;
    }

    if (!s_temperature_enabled && !s_light_enabled) {
        return ESP_OK;
    }

    const adc_oneshot_unit_init_cfg_t unit_config = {
        .unit_id = ADC_UNIT_1,
        .ulp_mode = ADC_ULP_MODE_DISABLE,
    };

    esp_err_t status = adc_oneshot_new_unit(
        &unit_config,
        &s_adc_handle);

    if (status != ESP_OK) {
        ESP_LOGE(TAG, "ADC1 initialization failed: %s", esp_err_to_name(status));
        s_temperature_enabled = false;
        s_light_enabled = false;
        return ESP_OK;
    }

    const adc_oneshot_chan_cfg_t channel_config = {
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };

    if (s_temperature_enabled) {
        status = adc_oneshot_config_channel(
            s_adc_handle,
            s_temperature_channel,
            &channel_config);
        if (status != ESP_OK) {
            ESP_LOGE(TAG, "TEMP_OUT channel configuration failed: %s", esp_err_to_name(status));
            s_temperature_enabled = false;
        }
    }

    if (s_light_enabled) {
        status = adc_oneshot_config_channel(
            s_adc_handle,
            s_light_channel,
            &channel_config);
        if (status != ESP_OK) {
            ESP_LOGE(TAG, "LIGHT_OUT channel configuration failed: %s", esp_err_to_name(status));
            s_light_enabled = false;
        }
    }

    if (!s_temperature_enabled && !s_light_enabled) {
        adc_oneshot_del_unit(s_adc_handle);
        s_adc_handle = NULL;
        return ESP_OK;
    }

    const adc_cali_curve_fitting_config_t calibration_config = {
        .unit_id = ADC_UNIT_1,
        .chan = s_temperature_enabled
            ? s_temperature_channel
            : s_light_channel,
        .atten = ADC_ATTEN_DB_12,
        .bitwidth = ADC_BITWIDTH_12,
    };

    status = adc_cali_create_scheme_curve_fitting(
        &calibration_config,
        &s_calibration_handle);

    if (status != ESP_OK) {
        ESP_LOGE(
            TAG,
            "ADC calibration unavailable; peripheral sensors disabled: %s",
            esp_err_to_name(status));
        adc_oneshot_del_unit(s_adc_handle);
        s_adc_handle = NULL;
        s_temperature_enabled = false;
        s_light_enabled = false;
        return ESP_OK;
    }

    ESP_LOGI(
        TAG,
        "Peripheral ADC ready: TEMP_OUT=%s, LIGHT_OUT=%s",
        s_temperature_enabled ? "enabled" : "disabled",
        s_light_enabled ? "enabled" : "disabled");
    return ESP_OK;
}

esp_err_t peripheral_sensors_read(
    peripheral_sensor_sample_t *out_sample)
{
    if (out_sample == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_sample, 0, sizeof(*out_sample));

    if (s_temperature_enabled) {
        int voltage_mv = 0;
        bool saturated = false;
        const esp_err_t status = read_calibrated_channel(
            s_temperature_channel,
            &voltage_mv,
            &saturated);

        if (status == ESP_OK) {
            out_sample->temperature_valid = true;
            out_sample->temperature_saturated = saturated;
            out_sample->temperature_c =
                peripheral_temperature_c_from_mv(voltage_mv);
        } else {
            ESP_LOGW(TAG, "TEMP_OUT read failed: %s", esp_err_to_name(status));
        }
    }

    if (s_light_enabled) {
        int voltage_mv = 0;
        bool saturated = false;
        const esp_err_t status = read_calibrated_channel(
            s_light_channel,
            &voltage_mv,
            &saturated);

        if (status == ESP_OK) {
            out_sample->light_valid = true;
            out_sample->light_saturated = saturated;
            out_sample->light_voltage_mv = voltage_mv;
            out_sample->relative_light_level =
                peripheral_relative_light_from_mv(voltage_mv);
        } else {
            ESP_LOGW(TAG, "LIGHT_OUT read failed: %s", esp_err_to_name(status));
        }
    }

    return ESP_OK;
}
