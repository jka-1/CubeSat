#include <inttypes.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "app_config.h"
#include "esp_err.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"
#include "ina226.h"
#include "ina226_protocol.h"
#include "udp_link.h"
#include "wifi_station.h"

static const char *TAG = "ina226_load_test";

static void send_write_result(
    const udp_link_t *link,
    uint32_t request_id,
    ina226_result_status_t status,
    uint16_t requested_value,
    uint16_t readback_value)
{
    char packet[INA226_RESULT_HEX_LENGTH + 1];
    const size_t packet_length = ina226_protocol_format_result(
        packet,
        sizeof(packet),
        request_id,
        status,
        requested_value,
        readback_value);

    if (packet_length == 0 ||
        udp_link_send(link, packet, packet_length) != ESP_OK) {
        ESP_LOGE(TAG, "Unable to send calibration write result");
    }
}

static void handle_calibration_command(
    const ina226_t *ina226,
    const udp_link_t *link,
    const ina226_calibration_command_t *command)
{
    uint16_t readback = 0;
    ina226_result_status_t status = INA226_RESULT_OK;

    if (command->calibration == 0) {
        status = INA226_RESULT_INVALID_VALUE;
        (void)ina226_read_register(
            ina226,
            INA226_REG_CALIBRATION,
            &readback);
    } else {
        const esp_err_t write_status = ina226_write_register(
            ina226,
            INA226_REG_CALIBRATION,
            command->calibration);

        if (write_status != ESP_OK) {
            status = INA226_RESULT_I2C_WRITE_FAILED;
        } else {
            const esp_err_t read_status = ina226_read_register(
                ina226,
                INA226_REG_CALIBRATION,
                &readback);

            if (read_status != ESP_OK) {
                status = INA226_RESULT_I2C_READBACK_FAILED;
            } else if (readback != command->calibration) {
                status = INA226_RESULT_VERIFY_MISMATCH;
            }
        }
    }

    ESP_LOGI(
        TAG,
        "Calibration request 0x%08" PRIX32
        ": requested=0x%04X readback=0x%04X status=%u",
        command->request_id,
        (unsigned int)command->calibration,
        (unsigned int)readback,
        (unsigned int)status);

    send_write_result(
        link,
        command->request_id,
        status,
        command->calibration,
        readback);
}

void app_main(void)
{
    const ina226_config_t ina226_config = {
        .port = INA226_TEST_I2C_PORT,
        .sda_gpio = INA226_TEST_I2C_SDA_GPIO,
        .scl_gpio = INA226_TEST_I2C_SCL_GPIO,
        .frequency_hz = INA226_TEST_I2C_FREQUENCY_HZ,
        .address = INA226_TEST_I2C_ADDRESS,
        .timeout_ms = INA226_TEST_I2C_TIMEOUT_MS,
    };

    ina226_t ina226;
    ESP_ERROR_CHECK(ina226_init(&ina226, &ina226_config));

#if INA226_TEST_APPLY_STARTUP_CALIBRATION
    ESP_ERROR_CHECK(ina226_write_register(
        &ina226,
        INA226_REG_CALIBRATION,
        INA226_TEST_STARTUP_CALIBRATION));

    uint16_t startup_readback = 0;
    ESP_ERROR_CHECK(ina226_read_register(
        &ina226,
        INA226_REG_CALIBRATION,
        &startup_readback));

    if (startup_readback != INA226_TEST_STARTUP_CALIBRATION) {
        ESP_LOGE(
            TAG,
            "Startup calibration verify failed: wrote 0x%04X, read 0x%04X",
            (unsigned int)INA226_TEST_STARTUP_CALIBRATION,
            (unsigned int)startup_readback);
        ESP_ERROR_CHECK(ESP_ERR_INVALID_RESPONSE);
    }
#endif

    ESP_ERROR_CHECK(wifi_station_init());
    xEventGroupWaitBits(
        wifi_station_event_group(),
        INA226_WIFI_CONNECTED_BIT,
        pdFALSE,
        pdTRUE,
        portMAX_DELAY);

    udp_link_t link;
    ESP_ERROR_CHECK(udp_link_open(
        &link,
        INA226_TEST_SERVER_HOST,
        INA226_TEST_SERVER_PORT,
        INA226_TEST_LOCAL_PORT,
        INA226_TEST_REQUIRE_SERVER_PORT != 0));

    uint16_t sequence = 0;
    int64_t next_telemetry_us = 0;

    while (true) {
        const EventBits_t wifi_bits = xEventGroupGetBits(
            wifi_station_event_group());
        if ((wifi_bits & INA226_WIFI_CONNECTED_BIT) == 0) {
            xEventGroupWaitBits(
                wifi_station_event_group(),
                INA226_WIFI_CONNECTED_BIT,
                pdFALSE,
                pdTRUE,
                portMAX_DELAY);
            next_telemetry_us = 0;
        }

        const int64_t now_us = esp_timer_get_time();
        if (now_us >= next_telemetry_us) {
            ina226_register_snapshot_t snapshot = {0};
            const esp_err_t read_status = ina226_read_snapshot(
                &ina226,
                &snapshot);

            if (read_status == ESP_OK) {
                char packet[INA226_TELEMETRY_HEX_LENGTH + 1];
                const size_t packet_length =
                    ina226_protocol_format_telemetry(
                        packet,
                        sizeof(packet),
                        sequence++,
                        &snapshot);

                if (packet_length == 0 ||
                    udp_link_send(&link, packet, packet_length) != ESP_OK) {
                    ESP_LOGE(TAG, "Telemetry send failed");
                }
            } else {
                ESP_LOGW(
                    TAG,
                    "Snapshot skipped: %s",
                    esp_err_to_name(read_status));
            }

            next_telemetry_us = now_us +
                ((int64_t)INA226_TEST_TELEMETRY_PERIOD_MS * 1000);
        }

        const int64_t remaining_us = next_telemetry_us - esp_timer_get_time();
        int poll_ms = (int)(remaining_us / 1000);
        if (poll_ms < 0) {
            poll_ms = 0;
        } else if (poll_ms > INA226_TEST_COMMAND_POLL_MAX_MS) {
            poll_ms = INA226_TEST_COMMAND_POLL_MAX_MS;
        }

        /* One extra byte ensures oversized datagrams cannot look valid. */
        char command_packet[INA226_COMMAND_HEX_LENGTH + 1];
        size_t command_length = 0;
        const esp_err_t receive_status = udp_link_receive(
            &link,
            command_packet,
            sizeof(command_packet),
            poll_ms,
            &command_length);

        if (receive_status == ESP_OK) {
            ina226_calibration_command_t command;
            if (ina226_protocol_parse_calibration_command(
                    command_packet,
                    command_length,
                    &command)) {
                handle_calibration_command(&ina226, &link, &command);
                next_telemetry_us = 0;
            } else {
                ESP_LOGW(TAG, "Ignored malformed or unsupported command");
            }
        } else if (receive_status != ESP_ERR_TIMEOUT &&
                   receive_status != ESP_ERR_INVALID_RESPONSE) {
            ESP_LOGW(
                TAG,
                "UDP receive failed: %s",
                esp_err_to_name(receive_status));
        }
    }
}
