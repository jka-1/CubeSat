#include "ina226_protocol.h"

#include <string.h>

static uint16_t get_word(const uint8_t *input)
{
    return (uint16_t)(((uint16_t)input[0] << 8) | input[1]);
}

static void put_word(uint8_t *output, uint16_t value)
{
    output[0] = (uint8_t)(value >> 8);
    output[1] = (uint8_t)value;
}

void ina226_protocol_encode_telemetry(
    const ina226_register_snapshot_t *snapshot,
    uint8_t output[INA226_TELEMETRY_BYTES])
{
    const uint16_t words[] = {
        snapshot->calibration,
        snapshot->shunt_voltage,
        snapshot->bus_voltage,
        snapshot->power,
        snapshot->current,
    };

    for (size_t index = 0; index < 5; ++index) {
        put_word(output + (index * 2), words[index]);
    }
}

bool ina226_protocol_process_command(
    ina226_command_state_t *state,
    const uint8_t *data,
    size_t length,
    uint8_t output[INA226_RESULT_BYTES],
    ina226_calibration_read_fn read_calibration,
    ina226_calibration_write_fn write_calibration)
{
    if (state == NULL || data == NULL || output == NULL ||
        read_calibration == NULL || write_calibration == NULL ||
        length != INA226_COMMAND_BYTES ||
        data[0] != 'I' || data[1] != 'C' || data[2] != 1) {
        return false;
    }

    const uint8_t opcode = data[3];
    const uint16_t request_id = get_word(data + 4);
    const uint16_t requested = get_word(data + 6);

    memset(output, 0, INA226_RESULT_BYTES);
    output[0] = 'I';
    output[1] = 'R';
    output[2] = 1;
    output[3] = opcode;
    put_word(output + 4, request_id);

    if ((opcode != INA226_COMMAND_READ_CALIBRATION &&
         opcode != INA226_COMMAND_WRITE_CALIBRATION) ||
        (opcode == INA226_COMMAND_READ_CALIBRATION && requested != 0) ||
        (opcode == INA226_COMMAND_WRITE_CALIBRATION &&
         (requested == 0 || requested > 0x7FFF))) {
        output[6] = INA226_RESULT_BAD_COMMAND;
        return true;
    }

    if (state->has_last) {
        const uint16_t delta = (uint16_t)(request_id - state->last_id);
        if (delta == 0) {
            if (memcmp(data, state->last_command, INA226_COMMAND_BYTES) == 0) {
                memcpy(output, state->last_response, INA226_RESULT_BYTES);
            } else {
                output[6] = INA226_RESULT_BAD_COMMAND;
            }
            return true;
        }
        if (delta >= 0x8000) {
            output[6] = INA226_RESULT_STALE_ID;
            return true;
        }
    }

    int32_t write_error = 0;
    if (opcode == INA226_COMMAND_WRITE_CALIBRATION) {
        write_error = write_calibration(requested);
    }

    uint16_t actual = 0;
    const int32_t read_error = read_calibration(&actual);
    if (read_error == 0) {
        output[7] = 1;
        put_word(output + 8, actual);
    }

    if (write_error != 0) {
        output[6] = INA226_RESULT_I2C_WRITE_FAILED;
    } else if (read_error != 0) {
        output[6] = INA226_RESULT_I2C_READBACK_FAILED;
    } else if (opcode == INA226_COMMAND_WRITE_CALIBRATION &&
               actual != requested) {
        output[6] = INA226_RESULT_VERIFY_MISMATCH;
    }

    put_word(
        output + 10,
        (uint16_t)(write_error != 0 ? write_error : read_error));

    state->has_last = true;
    state->last_id = request_id;
    memcpy(state->last_command, data, INA226_COMMAND_BYTES);
    memcpy(state->last_response, output, INA226_RESULT_BYTES);
    return true;
}
