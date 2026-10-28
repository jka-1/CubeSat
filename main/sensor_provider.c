#include "sensor_provider.h"

#include <stdbool.h>
#include <stddef.h>

#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"

#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"

static const char *TAG = "sensor_provider";

static SemaphoreHandle_t sample_mutex = NULL;

static uint32_t sample_counter = 0;

static telemetry_sample_t mock_sample = {0};

static telemetry_sample_t create_demo_sample(bool faulted)
{
    telemetry_sample_t sample = {
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
        .sample_counter = 0,
        .device_uptime_ms = 0
    };

    if (faulted) {
        sample.mppt_switch_enabled = false;
        sample.mppt_fault_mask = 0x0004u;
        sample.bms_cell_voltages_v[2] = 3.74f;
        sample.pv_power_w = 34.2f;
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

    ESP_LOGI(TAG, "Mock grouped telemetry initialized");

    return ESP_OK;
}

esp_err_t sensor_provider_read_sample(
    telemetry_sample_t *sample
)
{
    if (sample == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (sample_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t err = take_sample_mutex();
    if (err != ESP_OK) {
        return err;
    }

    *sample = mock_sample;
    xSemaphoreGive(sample_mutex);

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
