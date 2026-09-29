#include "ina226_protocol.h"

#include <stdio.h>

enum {
    TELEMETRY_MAGIC = 0x494E, /* "IN" */
    COMMAND_MAGIC = 0x4943,   /* "IC" */
    RESULT_MAGIC = 0x4952,    /* "IR" */
    PROTOCOL_VERSION = 0x0001,
    COMMAND_WRITE_CALIBRATION = 0x0001,
};

static bool parse_hex_nibble(char character, uint8_t *value)
{
    if (character >= '0' && character <= '9') {
        *value = (uint8_t)(character - '0');
        return true;
    }

    if (character >= 'A' && character <= 'F') {
        *value = (uint8_t)(character - 'A' + 10);
        return true;
    }

    if (character >= 'a' && character <= 'f') {
        *value = (uint8_t)(character - 'a' + 10);
        return true;
    }

    return false;
}

static bool parse_hex_word(const char *text, uint16_t *value)
{
    uint16_t parsed = 0;

    for (size_t index = 0; index < 4; ++index) {
        uint8_t nibble = 0;
        if (!parse_hex_nibble(text[index], &nibble)) {
            return false;
        }
        parsed = (uint16_t)((parsed << 4) | nibble);
    }

    *value = parsed;
    return true;
}

size_t ina226_protocol_format_telemetry(
    char *output,
    size_t output_size,
    uint16_t sequence,
    const ina226_register_snapshot_t *snapshot)
{
    if (output == NULL || snapshot == NULL ||
        output_size < INA226_TELEMETRY_HEX_LENGTH + 1) {
        return 0;
    }

    const int written = snprintf(
        output,
        output_size,
        "%04X%04X%04X%04X%04X%04X%04X%04X",
        (unsigned int)TELEMETRY_MAGIC,
        (unsigned int)PROTOCOL_VERSION,
        (unsigned int)sequence,
        (unsigned int)snapshot->calibration,
        (unsigned int)snapshot->shunt_voltage,
        (unsigned int)snapshot->bus_voltage,
        (unsigned int)snapshot->power,
        (unsigned int)snapshot->current);

    return written == INA226_TELEMETRY_HEX_LENGTH
        ? (size_t)written
        : 0;
}

bool ina226_protocol_parse_calibration_command(
    const char *payload,
    size_t payload_length,
    ina226_calibration_command_t *command)
{
    if (payload == NULL || command == NULL ||
        payload_length != INA226_COMMAND_HEX_LENGTH) {
        return false;
    }

    uint16_t words[6] = {0};
    for (size_t index = 0; index < 6; ++index) {
        if (!parse_hex_word(&payload[index * 4], &words[index])) {
            return false;
        }
    }

    if (words[0] != COMMAND_MAGIC ||
        words[1] != PROTOCOL_VERSION ||
        words[2] != COMMAND_WRITE_CALIBRATION) {
        return false;
    }

    command->request_id = ((uint32_t)words[3] << 16) | words[4];
    command->calibration = words[5];
    return true;
}

size_t ina226_protocol_format_result(
    char *output,
    size_t output_size,
    uint32_t request_id,
    ina226_result_status_t status,
    uint16_t requested_value,
    uint16_t readback_value)
{
    if (output == NULL || output_size < INA226_RESULT_HEX_LENGTH + 1) {
        return 0;
    }

    const int written = snprintf(
        output,
        output_size,
        "%04X%04X%04X%04X%04X%04X%04X",
        (unsigned int)RESULT_MAGIC,
        (unsigned int)PROTOCOL_VERSION,
        (unsigned int)status,
        (unsigned int)(request_id >> 16),
        (unsigned int)(request_id & 0xFFFF),
        (unsigned int)requested_value,
        (unsigned int)readback_value);

    return written == INA226_RESULT_HEX_LENGTH
        ? (size_t)written
        : 0;
}
