#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "ina226_registers.h"

#define INA226_TELEMETRY_BYTES 10
#define INA226_COMMAND_BYTES 8
#define INA226_RESULT_BYTES 12

typedef enum {
    INA226_COMMAND_READ_CALIBRATION = 1,
    INA226_COMMAND_WRITE_CALIBRATION = 2,
} ina226_command_opcode_t;

typedef enum {
    INA226_RESULT_OK = 0,
    INA226_RESULT_BAD_COMMAND = 1,
    INA226_RESULT_I2C_WRITE_FAILED = 2,
    INA226_RESULT_I2C_READBACK_FAILED = 3,
    INA226_RESULT_VERIFY_MISMATCH = 4,
    INA226_RESULT_STALE_ID = 5,
} ina226_result_status_t;

typedef int32_t (*ina226_calibration_read_fn)(uint16_t *value);
typedef int32_t (*ina226_calibration_write_fn)(uint16_t value);

typedef struct {
    bool has_last;
    uint16_t last_id;
    uint8_t last_command[INA226_COMMAND_BYTES];
    uint8_t last_response[INA226_RESULT_BYTES];
} ina226_command_state_t;

void ina226_protocol_encode_telemetry(
    const ina226_register_snapshot_t *snapshot,
    uint8_t output[INA226_TELEMETRY_BYTES]);

/* False means the datagram had the wrong framing, length, or version and
 * should be dropped. True means output contains a response to send.
 */
bool ina226_protocol_process_command(
    ina226_command_state_t *state,
    const uint8_t *data,
    size_t length,
    uint8_t output[INA226_RESULT_BYTES],
    ina226_calibration_read_fn read_calibration,
    ina226_calibration_write_fn write_calibration);
