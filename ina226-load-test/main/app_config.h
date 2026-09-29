#pragma once

/* Edit these before flashing. No repository credentials are copied. */
#define INA226_TEST_WIFI_SSID                 "YOUR_WIFI_SSID"
#define INA226_TEST_WIFI_PASSWORD             "YOUR_WIFI_PASSWORD"

/* Telemetry bridge endpoint and this device's fixed receive port. */
#define INA226_TEST_SERVER_HOST               "45.55.77.215"
#define INA226_TEST_SERVER_PORT               3333
#define INA226_TEST_LOCAL_PORT                3334

#define INA226_TEST_I2C_ADDRESS               0x40
#define INA226_TEST_I2C_PORT                  I2C_NUM_0
#define INA226_TEST_I2C_SDA_GPIO              5
#define INA226_TEST_I2C_SCL_GPIO              4
#define INA226_TEST_I2C_FREQUENCY_HZ          400000
#define INA226_TEST_I2C_TIMEOUT_MS             100

#define INA226_TEST_TELEMETRY_PERIOD_MS       1000
#define INA226_TEST_COMMAND_POLL_MAX_MS        100

#define INA226_TEST_STARTUP_CALIBRATION       0x0A00
#define INA226_TEST_STARTUP_CONFIG            0x4127
#define INA226_TEST_SETTLE_MS                  10

/* Only datagrams from the configured bridge IP and port may write the device. */
#define INA226_TEST_REQUIRE_SERVER_PORT           1

_Static_assert(
    INA226_TEST_STARTUP_CALIBRATION > 0 &&
    INA226_TEST_STARTUP_CALIBRATION <= 0x7FFF,
    "Calibration must be 1..0x7FFF");
_Static_assert(
    INA226_TEST_TELEMETRY_PERIOD_MS >= 20,
    "Period must be at least 20 ms");
