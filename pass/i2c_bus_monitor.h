#ifndef I2C_BUS_MONITOR_H
#define I2C_BUS_MONITOR_H

#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define I2C_MONITOR_SCL_GPIO           4
#define I2C_MONITOR_SDA_GPIO           5
#define I2C_MONITOR_FREQUENCY_HZ       400000
#define I2C_TRANSACTION_TIMEOUT_MS     100

#define INA226_I2C_ADDRESS             0x40
#define BQ76942_I2C_ADDRESS            0x08
#define BQ25798_I2C_ADDRESS            0x6B

#define BQ76942_CELL_COUNT             10
#define BQ76942_CELL_DATA_LENGTH       2
#define BQ76942_CELL_1_REGISTER        0x14

typedef struct
{
    /*
     * INA226 raw two-byte register data.
     */
    uint8_t ina226_calibration[2];
    uint8_t ina226_shunt_voltage[2];
    uint8_t ina226_bus_voltage[2];
    uint8_t ina226_power[2];
    uint8_t ina226_current[2];

    /*
     * BQ76942 raw cell-voltage register data.
     *
     * Index 0 = Cell 1, registers 0x14 and 0x15
     * Index 1 = Cell 2, registers 0x16 and 0x17
     * ...
     * Index 9 = Cell 10, registers 0x26 and 0x27
     */
    uint8_t bq76942_cell_voltage
        [BQ76942_CELL_COUNT]
        [BQ76942_CELL_DATA_LENGTH];

    /*
     * BQ25798 raw one-byte register data.
     */
    uint8_t bq25798_reg13;
    uint8_t bq25798_fault_status_0;

    /*
     * INA226 transaction status values.
     */
    esp_err_t ina226_calibration_status;
    esp_err_t ina226_shunt_status;
    esp_err_t ina226_bus_status;
    esp_err_t ina226_power_status;
    esp_err_t ina226_current_status;

    /*
     * BQ76942 transaction status values.
     */
    esp_err_t bq76942_cell_status[BQ76942_CELL_COUNT];

    /*
     * BQ25798 transaction status values.
     */
    esp_err_t bq25798_reg13_status;
    esp_err_t bq25798_fault_status;

    uint32_t sample_number;
} power_telemetry_t;

/**
 * @brief Initialize the I2C master bus and device handles.
 *
 * Configures:
 * - SDA: GPIO 5
 * - SCL: GPIO 4
 * - Frequency: 400 kHz
 */
esp_err_t i2c_bus_monitor_init(void);

/**
 * @brief Read all predefined telemetry registers once.
 *
 * @param telemetry Destination telemetry structure.
 *
 * @return
 * - ESP_OK when the monitoring cycle was executed.
 * - ESP_ERR_INVALID_STATE when the bus is not initialized.
 * - ESP_ERR_INVALID_ARG when telemetry is NULL.
 *
 * Individual transaction results are stored in the structure's
 * status fields.
 */
esp_err_t i2c_bus_monitor_read_all(power_telemetry_t *telemetry);

/**
 * @brief Start the continuous I2C monitoring task.
 */
esp_err_t i2c_bus_monitor_start(void);

/**
 * @brief Read raw bytes from an 8-bit register address.
 *
 * Equivalent to:
 *
 * i2cget -c device_address -r register_address -l data_length
 *
 * @param device_address Seven-bit I2C device address.
 * @param register_address Eight-bit register address.
 * @param data Destination buffer.
 * @param data_length Number of bytes to read.
 */
esp_err_t i2c_bus_read_register(
    uint8_t device_address,
    uint8_t register_address,
    uint8_t *data,
    size_t data_length);

/**
 * @brief Write raw bytes beginning at an 8-bit register address.
 *
 * Equivalent to:
 *
 * i2cset -c device_address -r register_address data...
 *
 * A data_length of zero performs a register-only write.
 *
 * @param device_address Seven-bit I2C device address.
 * @param register_address Eight-bit register address.
 * @param data Data bytes to write, or NULL when data_length is zero.
 * @param data_length Number of data bytes to write.
 */
esp_err_t i2c_bus_write_register(
    uint8_t device_address,
    uint8_t register_address,
    const uint8_t *data,
    size_t data_length);

/**
 * @brief Copy the latest telemetry snapshot.
 */
esp_err_t i2c_bus_monitor_get_latest(power_telemetry_t *telemetry);

#ifdef __cplusplus
}
#endif

#endif