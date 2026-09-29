#pragma once

/* Replace these before flashing. */
#define INA226_TEST_WIFI_SSID                 "YOUR_WIFI_SSID"
#define INA226_TEST_WIFI_PASSWORD             "YOUR_WIFI_PASSWORD"

/* Telemetry bridge endpoint and this device's fixed receive port. */
#define INA226_TEST_SERVER_HOST               "45.55.77.215"
#define INA226_TEST_SERVER_PORT               3333
#define INA226_TEST_LOCAL_PORT                3334

/*
 * The dashboard's lower-right Load peripheral is 0x41. Change this to 0x40
 * if the test board's INA226 address pins are strapped to the original value.
 */
#define INA226_TEST_I2C_ADDRESS               0x41
#define INA226_TEST_I2C_PORT                  I2C_NUM_0
#define INA226_TEST_I2C_SDA_GPIO              5
#define INA226_TEST_I2C_SCL_GPIO              4
#define INA226_TEST_I2C_FREQUENCY_HZ          400000
#define INA226_TEST_I2C_TIMEOUT_MS             100

#define INA226_TEST_TELEMETRY_PERIOD_MS       1000
#define INA226_TEST_COMMAND_POLL_MAX_MS        100

/* Set to 0 to preserve the calibration value already in the INA226. */
#define INA226_TEST_APPLY_STARTUP_CALIBRATION    1
#define INA226_TEST_STARTUP_CALIBRATION       0x0A00

/* Only datagrams from the configured bridge IP and port may write the device. */
#define INA226_TEST_REQUIRE_SERVER_PORT           1
