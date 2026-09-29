#include <assert.h>
#include <stdio.h>
#include <string.h>

#include "ina226_protocol.h"

static void test_telemetry(void)
{
    const ina226_register_snapshot_t snapshot = {
        .calibration = 0x0A00,
        .shunt_voltage = 0xFF9C,
        .bus_voltage = 0x2EE0,
        .power = 0x0012,
        .current = 0xFFF0,
    };
    char output[INA226_TELEMETRY_HEX_LENGTH + 1];

    const size_t length = ina226_protocol_format_telemetry(
        output,
        sizeof(output),
        0x1234,
        &snapshot);

    assert(length == INA226_TELEMETRY_HEX_LENGTH);
    assert(strcmp(
        output,
        "494E000112340A00FF9C2EE00012FFF0") == 0);
}

static void test_command(void)
{
    ina226_calibration_command_t command = {0};

    assert(ina226_protocol_parse_calibration_command(
        "494300010001123456780A00",
        INA226_COMMAND_HEX_LENGTH,
        &command));
    assert(command.request_id == 0x12345678);
    assert(command.calibration == 0x0A00);

    assert(!ina226_protocol_parse_calibration_command(
        "494300010002123456780A00",
        INA226_COMMAND_HEX_LENGTH,
        &command));
    assert(!ina226_protocol_parse_calibration_command(
        "494300010001123456780A0Z",
        INA226_COMMAND_HEX_LENGTH,
        &command));
    assert(!ina226_protocol_parse_calibration_command(
        "494300010001123456780A000",
        INA226_COMMAND_HEX_LENGTH + 1,
        &command));
}

static void test_result(void)
{
    char output[INA226_RESULT_HEX_LENGTH + 1];
    const size_t length = ina226_protocol_format_result(
        output,
        sizeof(output),
        0x12345678,
        INA226_RESULT_OK,
        0x0A00,
        0x0A00);

    assert(length == INA226_RESULT_HEX_LENGTH);
    assert(strcmp(
        output,
        "495200010000123456780A000A00") == 0);
}

int main(void)
{
    test_telemetry();
    test_command();
    test_result();
    puts("INA226 protocol tests passed");
    return 0;
}
