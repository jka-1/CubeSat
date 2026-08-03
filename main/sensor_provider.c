#include "sensor_provider.h"

#include <stdbool.h>
#include <stddef.h>

#include "temperature_sensor.h"
#include "esp_err.h"
#include "esp_log.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "sensor_provider";

/*
 * These three values are still controlled by the console.
 */
static telemetry_sample_t mock_sample = {
    .solar_panel_current_a = 0.500f,
    .battery_voltage_v = 16.000f,
    .mppt_switch_temperature_c = 30.000f,

    /*
     * This initial value will not be transmitted once the real
     * temperature sensor is successfully initialized.
     */
    .esp32_temperature_c = 0.0f
};

static SemaphoreHandle_t sample_mutex = NULL;

static temperature_sensor_handle_t temperature_handle = NULL;
static bool temperature_sensor_ready = false;

esp_err_t sensor_provider_init(void)
{
    sample_mutex = xSemaphoreCreateMutex();

    if (sample_mutex == NULL) {
        ESP_LOGE(TAG, "Could not create sample mutex");
        return ESP_ERR_NO_MEM;
    }

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
        "Mock telemetry initialized; "
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

    /*
     * Copy the three console-controlled values.
     */
    if (
        xSemaphoreTake(
            sample_mutex,
            pdMS_TO_TICKS(100)
        ) != pdTRUE
    ) {
        ESP_LOGE(TAG, "Timed out waiting for sample mutex");
        return ESP_ERR_TIMEOUT;
    }

    sample->solar_panel_current_a =
        mock_sample.solar_panel_current_a;

    sample->battery_voltage_v =
        mock_sample.battery_voltage_v;

    sample->mppt_switch_temperature_c =
        mock_sample.mppt_switch_temperature_c;

    xSemaphoreGive(sample_mutex);

    /*
     * Always obtain ESP32 temperature from the physical internal
     * temperature sensor. No console value is used for this field.
     */
    esp_err_t err = temperature_sensor_get_celsius(
        temperature_handle,
        &sample->esp32_temperature_c
    );

    if (err != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Actual ESP32 temperature read failed: %s",
            esp_err_to_name(err)
        );

        return err;
    }

    return ESP_OK;
}

esp_err_t sensor_provider_set_solar_panel_current(
    float current_a
)
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
        return ESP_ERR_TIMEOUT;
    }

    mock_sample.solar_panel_current_a = current_a;

    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_battery_voltage(
    float voltage_v
)
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
        return ESP_ERR_TIMEOUT;
    }

    mock_sample.battery_voltage_v = voltage_v;

    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}

esp_err_t sensor_provider_set_mppt_temperature(
    float temperature_c
)
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
        return ESP_ERR_TIMEOUT;
    }

    mock_sample.mppt_switch_temperature_c =
        temperature_c;

    xSemaphoreGive(sample_mutex);

    return ESP_OK;
}