#pragma once

#include <stdint.h>

#include "driver/i2c_master.h"
#include "esp_err.h"
#include "ina226_registers.h"

typedef struct {
    i2c_master_bus_handle_t bus;
    i2c_master_dev_handle_t device;
    int timeout_ms;
} ina226_t;

typedef struct {
    i2c_port_num_t port;
    int sda_gpio;
    int scl_gpio;
    uint32_t frequency_hz;
    uint8_t address;
    int timeout_ms;
} ina226_config_t;

esp_err_t ina226_init(
    ina226_t *ina226,
    const ina226_config_t *config);

esp_err_t ina226_read_register(
    const ina226_t *ina226,
    uint8_t register_address,
    uint16_t *value);

esp_err_t ina226_write_register(
    const ina226_t *ina226,
    uint8_t register_address,
    uint16_t value);

esp_err_t ina226_read_snapshot(
    const ina226_t *ina226,
    ina226_register_snapshot_t *snapshot);
