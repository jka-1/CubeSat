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
#include "freertos/task.h"
#include "ina226.h"
#include "ina226_protocol.h"
#include "udp_link.h"
#include "wifi_station.h"

static const char *TAG = "ina226_load_test";
static ina226_t sensor;

static int32_t read_calibration(uint16_t *value)
{
    return ina226_read_register(&sensor, INA226_REG_CALIBRATION, value);
}

static int32_t write_calibration(uint16_t value)
{
    const esp_err_t status = ina226_write_register(
        &sensor,
        INA226_REG_CALIBRATION,
        value);
    if (status == ESP_OK) {
        vTaskDelay(pdMS_TO_TICKS(INA226_TEST_SETTLE_MS) + 1);
    }
    return status;
}

static esp_err_t configure_sensor(void)
{
    esp_err_t status = ina226_write_register(
        &sensor,
        INA226_REG_CONFIGURATION,
        INA226_TEST_STARTUP_CONFIG);
    if (status != ESP_OK) {
        return status;
    }

    status = (esp_err_t)write_calibration(
        INA226_TEST_STARTUP_CALIBRATION);
    if (status != ESP_OK) {
        return status;
    }

    uint16_t readback = 0;
    status = (esp_err_t)read_calibration(&readback);
    if (status != ESP_OK) {
        return status;
    }
    return readback == INA226_TEST_STARTUP_CALIBRATION
        ? ESP_OK
        : ESP_ERR_INVALID_RESPONSE;
}

void app_main(void)
{
    const ina226_config_t sensor_config = {
        .port = INA226_TEST_I2C_PORT,
        .sda_gpio = INA226_TEST_I2C_SDA_GPIO,
        .scl_gpio = INA226_TEST_I2C_SCL_GPIO,
        .frequency_hz = INA226_TEST_I2C_FREQUENCY_HZ,
        .address = INA226_TEST_I2C_ADDRESS,
        .timeout_ms = INA226_TEST_I2C_TIMEOUT_MS,
    };

    ESP_ERROR_CHECK(ina226_init(&sensor, &sensor_config));
    ESP_ERROR_CHECK(wifi_station_init());

    esp_err_t status;
    while ((status = configure_sensor()) != ESP_OK) {
        ESP_LOGW(
            TAG,
            "INA226 setup failed: %s; retrying in 1 s",
            esp_err_to_name(status));
        vTaskDelay(pdMS_TO_TICKS(1000));
    }

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

    ina226_command_state_t commands = {0};
    int64_t next_telemetry_us = 0;

    while (true) {
        if ((xEventGroupGetBits(wifi_station_event_group()) &
             INA226_WIFI_CONNECTED_BIT) == 0) {
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
            status = ina226_read_snapshot(&sensor, &snapshot);
            if (status == ESP_OK) {
                uint8_t packet[INA226_TELEMETRY_BYTES];
                ina226_protocol_encode_telemetry(&snapshot, packet);
                if (udp_link_send(&link, packet, sizeof(packet)) != ESP_OK) {
                    ESP_LOGE(TAG, "Telemetry send failed");
                }
            } else {
                ESP_LOGW(
                    TAG,
                    "Snapshot skipped: %s",
                    esp_err_to_name(status));
            }
            next_telemetry_us = esp_timer_get_time() +
                ((int64_t)INA226_TEST_TELEMETRY_PERIOD_MS * 1000);
        }

        int64_t remaining_us = next_telemetry_us - esp_timer_get_time();
        int poll_ms = (int)(remaining_us / 1000);
        if (poll_ms < 0) {
            poll_ms = 0;
        } else if (poll_ms > INA226_TEST_COMMAND_POLL_MAX_MS) {
            poll_ms = INA226_TEST_COMMAND_POLL_MAX_MS;
        }

        uint8_t incoming[INA226_COMMAND_BYTES + 1];
        size_t incoming_length = 0;
        const esp_err_t receive_status = udp_link_receive(
            &link,
            incoming,
            sizeof(incoming),
            poll_ms,
            &incoming_length);

        if (receive_status == ESP_OK) {
            uint8_t response[INA226_RESULT_BYTES];
            if (ina226_protocol_process_command(
                    &commands,
                    incoming,
                    incoming_length,
                    response,
                    read_calibration,
                    write_calibration)) {
                ESP_LOGI(
                    TAG,
                    "Command %u: status=%u readback_valid=%u value=0x%02X%02X",
                    ((unsigned)response[4] << 8) | response[5],
                    response[6],
                    response[7],
                    response[8],
                    response[9]);
                if (udp_link_send(&link, response, sizeof(response)) != ESP_OK) {
                    ESP_LOGE(TAG, "Command response send failed");
                }
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

        vTaskDelay(1);
    }
}
