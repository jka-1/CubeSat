#include "sensor_provider.h"

#include <stdbool.h>
#include <stddef.h>

#include "temperature_sensor.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "sensor_provider";

static SemaphoreHandle_t sample_mutex = NULL;

static temperature_sensor_handle_t temperature_handle = NULL;
static bool temperature_sensor_ready = false;
static uint32_t sample_counter = 0;

static telemetry_sample_t mock_sample = {0};

static telemetry_sample_t create_demo_sample(bool faulted)
{
    telemetry_sample_t sample = {
        .mcu_temperature_c = 0.0f,
        .pv_shunt_voltage_mv = 2.2f,
        .pv_power_w = 48.7f,
        .pv_current_a = 1.24f,
        .mppt_switch_enabled = true,
        .mppt_fault_mask = 0x0000u,
        .bms_cell_voltages_v = {
            4.02f,
            4.01f,
            3.99f,
            4.00f
        },
        .load_shunt_voltage_mv = 1.8f,
        .load_power_w = 21.3f,
        .load_current_a = 0.98f,
        .sample_counter = 0,
        .device_uptime_ms = 0
    };

    if (faulted) {
        sample.mppt_switch_enabled = false;
        sample.mppt_fault_mask = 0x0004u;
        sample.bms_cell_voltages_v[2] = 3.74f;
        sample.pv_power_w = 34.2f;
        sample.load_power_w = 18.6f;
    }

    return sample;
}

static esp_err_t take_sample_mutex(void)
{
    if (sample_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (
        xSemaphoreTake(
            sample_mutex,
            pdMS_TO_TICKS(100)
        ) != pdTRUE
    ) {
        ESP_LOGE(TAG, "Timed out waiting for sample mutex");
        return ESP_ERR_TIMEOUT;
    }

    return ESP_OK;
}

esp_err_t sensor_provider_init(void)
{
    sample_mutex = xSemaphoreCreateMutex();

    if (sample_mutex == NULL) {
        ESP_LOGE(TAG, "Could not create sample mutex");
        return ESP_ERR_NO_MEM;
    }

    mock_sample = create_demo_sample(false);

    /*
     * -10 C to 80 C provides the ESP32-S3 driver's highest-accuracy
     * predefined range for expected laboratory operation.
     */
    temperature_sensor_config_t temperature_config =
        TEMPERATURE_SENSOR_CONFIG_DEFAULT(-10, 80);

    esp_err_t err = temperature_sensor_install(
        &temperature_config,
        &temperature_handle
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Temperature sensor installation failed: %s",
            esp_err_to_name(err)
        );

        return err;
    }

    err = temperature_sensor_enable(temperature_handle);

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Temperature sensor enable failed: %s",
            esp_err_to_name(err)
        );

        temperature_sensor_uninstall(temperature_handle);
        temperature_handle = NULL;

        return err;
    }

    temperature_sensor_ready = true;

    ESP_LOGI(
        TAG,
        "Mock grouped telemetry initialized; "
        "ESP32 internal temperature sensor enabled"
    );

    return ESP_OK;
}

esp_err_t sensor_provider_read_sample(
    telemetry_sample_t *sample
)
{
    if (sample == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (
        sample_mutex == NULL ||
        !temperature_sensor_ready ||
        temperature_handle == NULL
    ) {
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    *sample = mock_sample;
    xSemaphoreGive(sample_mutex);

    /*
     * Always obtain MCU temperature from the physical internal
     * temperature sensor. No console value is used for this field.
     */
    err = temperature_sensor_get_celsius(
        temperature_handle,
        &sample->mcu_temperature_c
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Actual ESP32 temperature read failed: %s",
            esp_err_to_name(err)
        );

        return err;
    }

    sample->sample_counter = ++sample_counter;
    sample->device_uptime_ms = (uint64_t)(
        esp_timer_get_time() / 1000
    );

    return ESP_OK;
}

esp_err_t sensor_provider_load_demo_profile(
    bool faulted
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample = create_demo_sample(faulted);
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_pv_shunt_voltage(
    float shunt_voltage_mv
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.pv_shunt_voltage_mv = shunt_voltage_mv;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_pv_power(
    float power_w
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.pv_power_w = power_w;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_pv_current(
    float current_a
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.pv_current_a = current_a;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_mppt_switch_enabled(
    bool enabled
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.mppt_switch_enabled = enabled;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_mppt_fault_mask(
    uint16_t fault_mask
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.mppt_fault_mask = fault_mask;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_bms_cell_voltage(
    size_t cell_index,
    float voltage_v
)
{
    if (cell_index >= 4u) {
        return ESP_ERR_INVALID_ARG;
    }

    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.bms_cell_voltages_v[cell_index] =
        voltage_v;

    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_load_shunt_voltage(
    float shunt_voltage_mv
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.load_shunt_voltage_mv = shunt_voltage_mv;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_load_power(
    float power_w
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.load_power_w = power_w;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_load_current(
    float current_a
)
{
    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    mock_sample.load_current_a = current_a;
    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}
