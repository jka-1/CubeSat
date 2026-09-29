#pragma once

#include <stdint.h>

enum {
    INA226_REG_SHUNT_VOLTAGE = 0x01,
    INA226_REG_BUS_VOLTAGE = 0x02,
    INA226_REG_POWER = 0x03,
    INA226_REG_CURRENT = 0x04,
    INA226_REG_CALIBRATION = 0x05,
};

typedef struct {
    uint16_t calibration;
    uint16_t shunt_voltage;
    uint16_t bus_voltage;
    uint16_t power;
    uint16_t current;
} ina226_register_snapshot_t;
