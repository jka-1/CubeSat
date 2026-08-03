#include <inttypes.h>

#include "app_config.h"
#include "console_input.h"
#include "esp_log.h"
#include "sensor_provider.h"
#include "telemetry_types.h"
#include "udp_transport.h"
#include "wifi_station.h"

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

static const char *TAG = "demo_main";

static void telemetry_task(void *argument)
{
    (void)argument;

    udp_transport_t transport = {0};

    ESP_ERROR_CHECK(
        udp_transport_init(
            &transport,
            DEMO_SERVER_HOST,
            DEMO_SERVER_UDP_PORT,
            DEMO_DEVICE_ID));

    uint32_t consecutive_errors = 0;

    while (true) {
        xEventGroupWaitBits(
            wifi_station_event_group(),
            WIFI_CONNECTED_BIT,
            pdFALSE,
            pdTRUE,
            portMAX_DELAY);

        telemetry_sample_t sample = {0};
        esp_err_t err = sensor_provider_read_sample(&sample);

        if (err != ESP_OK) {
            ESP_LOGE(
                TAG,
                "Sample read failed: %s",
                esp_err_to_name(err));
        } else {
            uint32_t sequence = 0;
            uint32_t round_trip_ms = 0;

            err = udp_transport_send_sample(
                &transport,
                &sample,
                &sequence,
                &round_trip_ms);

            if (err == ESP_OK) {
                consecutive_errors = 0;

                ESP_LOGI(
                    TAG,
                    "Streamed sequence=%" PRIu32
                    " pv=%.3fA battery=%.3fV"
                    " mppt=%.2fC esp32=%.2fC",
                    sequence,
                    sample.solar_panel_current_a,
                    sample.battery_voltage_v,
                    sample.mppt_switch_temperature_c,
                    sample.esp32_temperature_c);
            } else {
                ++consecutive_errors;

                ESP_LOGW(
                    TAG,
                    "Stream failed (%" PRIu32 "/%d): %s",
                    consecutive_errors,
                    DEMO_MAX_CONSECUTIVE_ERRORS,
                    esp_err_to_name(err));

                if (consecutive_errors >=
                    DEMO_MAX_CONSECUTIVE_ERRORS) {
                    udp_transport_close(&transport);
                    consecutive_errors = 0;
                }
            }
        }

        /*
         * Wait for the next periodic sample, or wake immediately when
         * the serial console changes a mock value.
         */
        ulTaskNotifyTake(
            pdTRUE,
            pdMS_TO_TICKS(DEMO_STREAM_PERIOD_MS));
    }
}

void app_main(void)
{
    ESP_LOGI(TAG, "Starting CubeSat streaming DEMO");

    ESP_ERROR_CHECK(sensor_provider_init());
    ESP_ERROR_CHECK(wifi_station_init());

    TaskHandle_t telemetry_task_handle = NULL;

    const BaseType_t task_result = xTaskCreate(
        telemetry_task,
        "telemetry_stream",
        8192,
        NULL,
        5,
        &telemetry_task_handle);

    if (task_result != pdPASS) {
        ESP_LOGE(TAG, "Could not create telemetry task");
        return;
    }

    console_input_start(telemetry_task_handle);
}
