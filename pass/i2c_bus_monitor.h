#ifndef I2C_BUS_MONITOR_H
#define I2C_BUS_MONITOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

#define I2C_MONITOR_SCL_GPIO           40
#define I2C_MONITOR_SDA_GPIO           41
#define I2C_MONITOR_FREQUENCY_HZ       400000
#define I2C_TRANSACTION_TIMEOUT_MS     100

#define INA226_I2C_ADDRESS             0x40
#define BQ76942_I2C_ADDRESS            0x08
#define BQ25798_I2C_ADDRESS            0x6B

#define BQ76942_CELL_COUNT             10
#define BQ76942_CELL_DATA_LENGTH       2
#define BQ76942_CELL_1_REGISTER        0x14
#define BQ76942_PACK_VOLTAGE_REGISTER  0x36   /* direct command: PACK Pin Voltage, userV (default 10 mV) */
#define BQ76942_INT_TEMP_REGISTER      0x68   /* direct command: Int Temperature, 0.1 K */

/* BQ25798 ADC block REG31..REG42 (big-endian 16-bit words), one burst read. */
#define BQ25798_REG_ADC_CONTROL        0x2E
#define BQ25798_REG_ADC_DISABLE_0      0x2F
#define BQ25798_REG_ADC_DISABLE_1      0x30
#define BQ25798_ADC_BLOCK_START        0x31
#define BQ25798_ADC_BLOCK_LENGTH       18     /* 0x31..0x42 */
#define BQ25798_ADC_EN_BIT             0x80u  /* REG2E ADC_EN */
#define BQ25798_ADC_RATE_BIT           0x40u  /* REG2E ADC_RATE: 0 = continuous */
#define BQ25798_ADC_SAMPLE_MASK        0x30u  /* REG2E ADC_SAMPLE[1:0]: 00 = 15-bit */
/* REG2F disable bits we need cleared: IBUS_ADC_DIS(7) VBUS_ADC_DIS(5) VBAT_ADC_DIS(4) VSYS_ADC_DIS(3) TDIE_ADC_DIS(1) */
#define BQ25798_ADC_DIS0_NEEDED        0xBAu
/* REG30 VAC1_ADC_DIS(4) */
#define BQ25798_ADC_DIS1_NEEDED        0x10u

typedef enum {
    BQ25798_ADC_IBUS = 0,  /* REG31, signed, 1 mA */
    BQ25798_ADC_IBAT,      /* REG33 */
    BQ25798_ADC_VBUS,      /* REG35, 1 mV */
    BQ25798_ADC_VAC1,      /* REG37, 1 mV */
    BQ25798_ADC_VAC2,      /* REG39 */
    BQ25798_ADC_VBAT,      /* REG3B, 1 mV */
    BQ25798_ADC_VSYS,      /* REG3D, 1 mV */
    BQ25798_ADC_TS,        /* REG3F */
    BQ25798_ADC_TDIE,      /* REG41, signed, 0.5 degC */
    BQ25798_ADC_WORDS
} bq25798_adc_word_t;

#define I2C_SENSOR_GROUP_PV            (1u << 0)
#define I2C_SENSOR_GROUP_BMS           (1u << 1)
#define I2C_SENSOR_GROUP_MPPT          (1u << 2)
#define I2C_SENSOR_GROUP_ALL           \
    (I2C_SENSOR_GROUP_PV |            \
     I2C_SENSOR_GROUP_BMS |           \
     I2C_SENSOR_GROUP_MPPT)

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

    /* Streaming Telemetry v6 additions */
    uint8_t bq76942_pack_voltage[2];   /* 0x36 little-endian */
    uint8_t bq76942_int_temp[2];       /* 0x68 little-endian */
    uint8_t bq25798_adc_block[BQ25798_ADC_BLOCK_LENGTH]; /* REG31..REG42 */
    uint8_t bq25798_adc_control;       /* REG2E readback */
    uint8_t bq25798_adc_disable_0;     /* REG2F readback */

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
    esp_err_t bq76942_pack_status;
    esp_err_t bq76942_temp_status;
    esp_err_t bq25798_adc_status;
    esp_err_t bq25798_adc_control_status;

    uint32_t sample_number;
    uint32_t enabled_sensor_mask;
} power_telemetry_t;

typedef enum
{
    I2C_ACDRV_DISABLED = 0,
    I2C_ACDRV1_SELECTED,
    I2C_ACDRV2_SELECTED
} i2c_acdrv_state_t;

typedef struct
{
    uint8_t register_12_before;
    uint8_t register_12_after;
    uint8_t register_13_before;
    uint8_t register_13_after;
    uint8_t acrb_status;
    bool verified;
} i2c_acdrv_result_t;

/**
 * @brief Initialize the I2C master bus and device handles.
 *
 * Configures:
 * - SDA: GPIO 41
 * - SCL: GPIO 40
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

/**
 * @brief Enable or disable automatic polling for one or more sensor groups.
 *
 * Manual register reads and writes still work while a group is disabled.
 */
esp_err_t i2c_bus_monitor_set_sensor_enabled(
    uint32_t sensor_mask,
    bool enabled);

/**
 * @brief Copy the current automatic-polling sensor mask.
 */
esp_err_t i2c_bus_monitor_get_sensor_mask(
    uint32_t *out_sensor_mask);

/**
 * @brief Select or disable BQ25798 ACDRV using masked, verified updates.
 *
 * Only REG12.DIS_ACDRV and REG13.EN_ACDRV1/2 are changed. All unrelated
 * control bits are preserved and read back before success is reported.
 */
esp_err_t i2c_bus_monitor_set_acdrv_state(
    i2c_acdrv_state_t state,
    i2c_acdrv_result_t *out_result);

/**
 * @brief Probe one 7-bit address for an ACK (i2cdetect-style), holding the bus mutex.
 *
 * @return ESP_OK when the address ACKs, ESP_ERR_NOT_FOUND on NACK, or another error
 *         (for example ESP_ERR_TIMEOUT when the bus is stuck).
 */
esp_err_t i2c_bus_probe(uint8_t device_address, uint32_t timeout_ms);

/**
 * @brief Probe every address in [first_address, last_address] and list the ones that ACK.
 */
esp_err_t i2c_bus_scan(
    uint8_t first_address,
    uint8_t last_address,
    uint8_t *out_addresses,
    size_t max_addresses,
    size_t *out_count);

/**
 * @brief Set which sensor groups are physically present.
 *
 * Groups whose bit is clear are skipped by i2c_bus_monitor_read_all(): no bus
 * transactions are issued and their status fields are set to ESP_ERR_NOT_FOUND.
 * Defaults to I2C_SENSOR_GROUP_ALL (every group is attempted).
 */
void i2c_bus_monitor_set_present_mask(uint32_t present_mask);
uint32_t i2c_bus_monitor_get_present_mask(void);

/**
 * @brief Duration of the most recent i2c_bus_monitor_read_all() bus phase in microseconds.
 */
uint32_t i2c_bus_monitor_last_read_duration_us(void);

/* Big-endian 16-bit word from the BQ25798 ADC block. */
uint16_t i2c_bq25798_adc_word(const power_telemetry_t *telemetry, bq25798_adc_word_t word);

#ifdef __cplusplus
}
#endif

#endif
