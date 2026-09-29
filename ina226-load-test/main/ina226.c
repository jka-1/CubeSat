#include "ina226.h"

#include <string.h>

#include "esp_check.h"

static const char *TAG = "ina226";

esp_err_t ina226_init(
    ina226_t *ina226,
    const ina226_config_t *config)
{
    if (ina226 == NULL || config == NULL || config->timeout_ms <= 0) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(ina226, 0, sizeof(*ina226));

    const i2c_master_bus_config_t bus_config = {
        .i2c_port = config->port,
        .sda_io_num = config->sda_gpio,
        .scl_io_num = config->scl_gpio,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .flags = {
            .enable_internal_pullup = false,
        },
    };

    ESP_RETURN_ON_ERROR(
        i2c_new_master_bus(&bus_config, &ina226->bus),
        TAG,
        "creating I2C bus failed");

    const i2c_device_config_t device_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = config->address,
        .scl_speed_hz = config->frequency_hz,
        .scl_wait_us = 0,
        .flags = {
            .disable_ack_check = 0,
        },
    };

    ESP_RETURN_ON_ERROR(
        i2c_master_bus_add_device(
            ina226->bus,
            &device_config,
            &ina226->device),
        TAG,
        "adding INA226 failed");

    ina226->timeout_ms = config->timeout_ms;
    return ESP_OK;
}

esp_err_t ina226_read_register(
    const ina226_t *ina226,
    uint8_t register_address,
    uint16_t *value)
{
    if (ina226 == NULL || ina226->device == NULL || value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    uint8_t data[2] = {0};
    const esp_err_t err = i2c_master_transmit_receive(
        ina226->device,
        &register_address,
        sizeof(register_address),
        data,
        sizeof(data),
        ina226->timeout_ms);

    if (err != ESP_OK) {
        return err;
    }

    *value = (uint16_t)(((uint16_t)data[0] << 8) | data[1]);
    return ESP_OK;
}

esp_err_t ina226_write_register(
    const ina226_t *ina226,
    uint8_t register_address,
    uint16_t value)
{
    if (ina226 == NULL || ina226->device == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const uint8_t data[] = {
        register_address,
        (uint8_t)(value >> 8),
        (uint8_t)value,
    };

    return i2c_master_transmit(
        ina226->device,
        data,
        sizeof(data),
        ina226->timeout_ms);
}

esp_err_t ina226_read_snapshot(
    const ina226_t *ina226,
    ina226_register_snapshot_t *snapshot)
{
    if (snapshot == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    ESP_RETURN_ON_ERROR(
        ina226_read_register(
            ina226,
            INA226_REG_CALIBRATION,
            &snapshot->calibration),
        TAG,
        "reading calibration failed");

    ESP_RETURN_ON_ERROR(
        ina226_read_register(
            ina226,
            INA226_REG_SHUNT_VOLTAGE,
            &snapshot->shunt_voltage),
        TAG,
        "reading shunt voltage failed");

    ESP_RETURN_ON_ERROR(
        ina226_read_register(
            ina226,
            INA226_REG_BUS_VOLTAGE,
            &snapshot->bus_voltage),
        TAG,
        "reading bus voltage failed");

    ESP_RETURN_ON_ERROR(
        ina226_read_register(
            ina226,
            INA226_REG_POWER,
            &snapshot->power),
        TAG,
        "reading power failed");

    ESP_RETURN_ON_ERROR(
        ina226_read_register(
            ina226,
            INA226_REG_CURRENT,
            &snapshot->current),
        TAG,
        "reading current failed");

    return ESP_OK;
}
