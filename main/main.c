#include <stdbool.h>
#include <inttypes.h>

#include "app_config.h"
#include "board_led.h"
#include "esp_log.h"
#include "i2c_bus_monitor.h"
#include "sensor_provider.h"
#include "telemetry_packet_v3.h"
#include "udp_transport.h"
#include "wifi_station.h"

#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "freertos/task.h"

static const char *TAG = "demo_main";

static esp_err_t load_mcu_temperature_meta(
    telemetry_packet_v3_meta_t *out_meta)
{
    if (out_meta == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    telemetry_sample_t temperature_sample = {0};
    const esp_err_t status =
        sensor_provider_read_sample(&temperature_sample);

    if (status != ESP_OK) {
        out_meta->has_mcu_temperature = false;
        out_meta->mcu_temperature_centi_c = 0;
        return status;
    }

    out_meta->has_mcu_temperature = true;
    out_meta->mcu_temperature_centi_c = (int16_t)(
        temperature_sample.mcu_temperature_c * 100.0f);

    return ESP_OK;
}

static void apply_startup_hardware_configuration(void)
{
    /*
     * Match the lab-validated INA226 calibration write:
     * i2cset -c 0x40 -r 0x05 0x0A 0x00
     */
    const uint8_t ina226_calibration[] = {
        0x0A,
        0x00
    };

    const esp_err_t status =
        i2c_bus_write_register(
            INA226_I2C_ADDRESS,
            0x05,
            ina226_calibration,
            sizeof(ina226_calibration));

    if (status == ESP_OK) {
        ESP_LOGI(TAG, "Applied INA226 calibration 0x0A00");
    } else {
        ESP_LOGW(
            TAG,
            "INA226 calibration write failed: %s",
            esp_err_to_name(status));
    }
}

static const char *decode_mppt_state(
    uint8_t register_13)
{
    const bool acdrv1 = (register_13 & 0x40u) != 0u;
    const bool acdrv2 = (register_13 & 0x80u) != 0u;

    if (acdrv1 && !acdrv2) {
        return "acdrv1";
    }

    if (!acdrv1 && acdrv2) {
        return "acdrv2";
    }

    if (acdrv1 && acdrv2) {
        return "both";
    }

    return "off";
}

static void poll_commands_until_deadline(
    udp_transport_t *transport,
    TickType_t deadline_ticks)
{
    while ((int32_t)(deadline_ticks - xTaskGetTickCount()) > 0) {
        const TickType_t remaining_ticks =
            deadline_ticks - xTaskGetTickCount();

        uint32_t wait_ms = (uint32_t)(
            remaining_ticks * portTICK_PERIOD_MS);

        if (wait_ms == 0u) {
            wait_ms = 1u;
        }

        if (wait_ms > DEMO_COMMAND_POLL_SLICE_MS) {
            wait_ms = DEMO_COMMAND_POLL_SLICE_MS;
        }

        bool handled_command = false;
        const esp_err_t status =
            udp_transport_poll_command(
                transport,
                wait_ms,
                &handled_command);

        if (status == ESP_OK) {
            continue;
        }

        if (status == ESP_ERR_INVALID_STATE) {
            break;
        }

        if (status != ESP_ERR_INVALID_RESPONSE &&
            status != ESP_ERR_NOT_SUPPORTED) {
            ESP_LOGW(
                TAG,
                "Command poll failed: %s",
                esp_err_to_name(status));
        }
    }
}

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
    uint32_t sample_number = 0;

    while (true) {
        xEventGroupWaitBits(
            wifi_station_event_group(),
            WIFI_CONNECTED_BIT,
            pdFALSE,
            pdTRUE,
            portMAX_DELAY);

        const TickType_t cycle_start =
            xTaskGetTickCount();
        const TickType_t cycle_deadline =
            cycle_start +
            pdMS_TO_TICKS(DEMO_STREAM_PERIOD_MS);

        power_telemetry_t telemetry = {0};
        telemetry.sample_number = ++sample_number;
        telemetry_packet_v3_meta_t meta = {
            .sequence = 0,
            .has_mcu_temperature = false,
            .mcu_temperature_centi_c = 0
        };

        const esp_err_t temperature_status =
            load_mcu_temperature_meta(&meta);

        if (temperature_status != ESP_OK) {
            ESP_LOGW(
                TAG,
                "MCU temperature unavailable: %s",
                esp_err_to_name(temperature_status));
        }

        esp_err_t status =
            i2c_bus_monitor_read_all(&telemetry);

        if (status != ESP_OK) {
            consecutive_errors += 1u;

            ESP_LOGW(
                TAG,
                "I2C telemetry read failed (%" PRIu32 "/%u): %s",
                consecutive_errors,
                DEMO_MAX_CONSECUTIVE_ERRORS,
                esp_err_to_name(status));
        } else {
            uint32_t sequence = 0;
            uint32_t round_trip_ms = 0;

            status = udp_transport_send_power_telemetry(
                &transport,
                &telemetry,
                &meta,
                &sequence,
                &round_trip_ms);

            if (status == ESP_OK) {
                consecutive_errors = 0u;

                ESP_LOGI(
                    TAG,
                    "Streamed raw-v3 sequence=%" PRIu32
                    " temp=%s"
                    " pv_cal=0x%02X%02X"
                    " mppt=%s"
                    " fault=0x%02X"
                    " rtt=%" PRIu32 "ms",
                    sequence,
                    meta.has_mcu_temperature ? "yes" : "no",
                    telemetry.ina226_calibration[0],
                    telemetry.ina226_calibration[1],
                    decode_mppt_state(
                        telemetry.bq25798_reg13),
                    telemetry.bq25798_fault_status_0,
                    round_trip_ms);
            } else {
                consecutive_errors += 1u;

                ESP_LOGW(
                    TAG,
                    "Stream failed (%" PRIu32 "/%u): %s",
                    consecutive_errors,
                    DEMO_MAX_CONSECUTIVE_ERRORS,
                    esp_err_to_name(status));
            }
        }

        if (consecutive_errors >=
            DEMO_MAX_CONSECUTIVE_ERRORS) {
            udp_transport_close(&transport);
            consecutive_errors = 0u;
        }

        poll_commands_until_deadline(
            &transport,
            cycle_deadline);
    }
}

void app_main(void)
{
    ESP_LOGI(
        TAG,
        "Starting CubeSat live telemetry demo firmware");

    ESP_ERROR_CHECK(board_led_init());
    ESP_ERROR_CHECK(sensor_provider_init());
    ESP_ERROR_CHECK(i2c_bus_monitor_init());
    apply_startup_hardware_configuration();
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
}
