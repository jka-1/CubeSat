#include <assert.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "ina226_protocol.h"

static uint16_t calibration = 0x0A00;
static unsigned reads;
static unsigned writes;
static int32_t read_error;
static int32_t write_error;
static bool ignore_write;

static int32_t mock_read(uint16_t *value)
{
    ++reads;
    if (read_error == 0) {
        *value = calibration;
    }
    return read_error;
}

static int32_t mock_write(uint16_t value)
{
    ++writes;
    if (write_error == 0 && !ignore_write) {
        calibration = value;
    }
    return write_error;
}

static void make_command(
    uint8_t output[INA226_COMMAND_BYTES],
    uint8_t opcode,
    uint16_t request_id,
    uint16_t value)
{
    const uint8_t command[] = {
        'I', 'C', 1, opcode,
        (uint8_t)(request_id >> 8), (uint8_t)request_id,
        (uint8_t)(value >> 8), (uint8_t)value,
    };
    memcpy(output, command, sizeof(command));
}

int main(void)
{
    const ina226_register_snapshot_t snapshot = {
        .calibration = 0x0A00,
        .shunt_voltage = 0xFFFE,
        .bus_voltage = 0x0FA3,
        .power = 0x000A,
        .current = 0x8000,
    };
    const uint8_t expected_telemetry[] = {
        0x0A, 0x00, 0xFF, 0xFE, 0x0F,
        0xA3, 0x00, 0x0A, 0x80, 0x00,
    };
    uint8_t telemetry[INA226_TELEMETRY_BYTES];
    ina226_protocol_encode_telemetry(&snapshot, telemetry);
    assert(memcmp(telemetry, expected_telemetry, sizeof(telemetry)) == 0);

    ina226_command_state_t state = {0};
    uint8_t request[INA226_COMMAND_BYTES + 1] = {0};
    uint8_t response[INA226_RESULT_BYTES];
    uint8_t cached[INA226_RESULT_BYTES];

    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 10, 0x1000);
    for (size_t length = 0; length < INA226_COMMAND_BYTES; ++length) {
        assert(!ina226_protocol_process_command(
            &state, request, length, response, mock_read, mock_write));
    }
    assert(!ina226_protocol_process_command(
        &state, request, sizeof(request), response, mock_read, mock_write));
    request[0] = 'X';
    assert(!ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    request[0] = 'I';
    request[2] = 2;
    assert(!ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    request[2] = 1;
    assert(writes == 0 && reads == 0);

    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    const uint8_t expected_response[] = {
        'I', 'R', 1, INA226_COMMAND_WRITE_CALIBRATION,
        0, 10, 0, 1, 0x10, 0, 0, 0,
    };
    assert(memcmp(response, expected_response, sizeof(response)) == 0);
    assert(writes == 1 && reads == 1 && calibration == 0x1000);

    memcpy(cached, response, sizeof(cached));
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(memcmp(cached, response, sizeof(response)) == 0);
    assert(writes == 1 && reads == 1);

    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 10, 0x1100);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_BAD_COMMAND && writes == 1);

    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 9, 0x1100);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_STALE_ID && writes == 1);

    make_command(request, INA226_COMMAND_READ_CALIBRATION, 11, 0);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_OK && response[7] == 1);
    assert(response[8] == 0x10 && response[9] == 0x00);

    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 12, 0);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_BAD_COMMAND);

    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 12, 0x8000);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_BAD_COMMAND);

    write_error = 0x107;
    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 12, 0x1200);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_I2C_WRITE_FAILED && response[7] == 1);
    assert(response[10] == 1 && response[11] == 7);

    write_error = 0;
    read_error = -1;
    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 13, 0x1200);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_I2C_READBACK_FAILED);
    assert(response[7] == 0 && calibration == 0x1200);

    read_error = 0;
    ignore_write = true;
    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 14, 0x1300);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_VERIFY_MISMATCH);

    state = (ina226_command_state_t){0};
    ignore_write = false;
    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 65535, 1);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_OK);
    make_command(request, INA226_COMMAND_WRITE_CALIBRATION, 0, 0x7FFF);
    assert(ina226_protocol_process_command(
        &state, request, INA226_COMMAND_BYTES, response, mock_read, mock_write));
    assert(response[6] == INA226_RESULT_OK && calibration == 0x7FFF);

    puts("PASS: binary framing, reads/writes, errors, replay, stale IDs, wraparound");
    return 0;
}
