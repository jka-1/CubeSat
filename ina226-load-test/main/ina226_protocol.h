#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "ina226_registers.h"

#define INA226_TELEMETRY_HEX_LENGTH 32
#define INA226_COMMAND_HEX_LENGTH   24
#define INA226_RESULT_HEX_LENGTH    28

typedef struct {
    uint32_t request_id;
    uint16_t calibration;
} ina226_calibration_command_t;

typedef enum {
    INA226_RESULT_OK = 0,
    INA226_RESULT_INVALID_VALUE = 1,
    INA226_RESULT_I2C_WRITE_FAILED = 2,
    INA226_RESULT_I2C_READBACK_FAILED = 3,
    INA226_RESULT_VERIFY_MISMATCH = 4,
} ina226_result_status_t;

size_t ina226_protocol_format_telemetry(
    char *output,
    size_t output_size,
    uint16_t sequence,
    const ina226_register_snapshot_t *snapshot);

bool ina226_protocol_parse_calibration_command(
    const char *payload,
    size_t payload_length,
    ina226_calibration_command_t *command);

size_t ina226_protocol_format_result(
    char *output,
    size_t output_size,
    uint32_t request_id,
    ina226_result_status_t status,
    uint16_t requested_value,
    uint16_t readback_value);
