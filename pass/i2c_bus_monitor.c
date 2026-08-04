#include "i2c_bus_monitor.h"

#include <stdbool.h>
#include <stdio.h>
#include <string.h>

#include "driver/i2c_master.h"
#include "esp_check.h"
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "freertos/task.h"

#define BUS_MONITOR_PERIOD_MS       1000
#define BUS_MONITOR_TASK_STACK      4096
#define BUS_MONITOR_TASK_PRIORITY   5
#define MAX_I2C_WRITE_DATA_LENGTH   32

static const char *TAG = "i2c_bus_monitor";

/*
 * I2C bus and device handles.
 */
static i2c_master_bus_handle_t s_bus_handle;
static i2c_master_dev_handle_t s_ina226_handle;
static i2c_master_dev_handle_t s_bq76942_handle;
static i2c_master_dev_handle_t s_bq25798_handle;

/*
 * Monitoring task and shared telemetry state.
 */
static TaskHandle_t s_monitor_task_handle;
static SemaphoreHandle_t s_telemetry_mutex;
static power_telemetry_t s_latest_telemetry;

static bool s_initialized;

/**
 * @brief Return the device handle associated with an I2C address.
 */
static i2c_master_dev_handle_t get_device_handle(
    uint8_t device_address)
{
    switch (device_address) {
        case INA226_I2C_ADDRESS:
            return s_ina226_handle;

        case BQ76942_I2C_ADDRESS:
            return s_bq76942_handle;

        case BQ25798_I2C_ADDRESS:
            return s_bq25798_handle;

        default:
            return NULL;
    }
}

/**
 * @brief Calculate the starting register for a BQ76942 cell voltage.
 *
 * Cell 1:  0x14
 * Cell 2:  0x16
 * Cell 3:  0x18
 * ...
 * Cell 10: 0x26
 */
static uint8_t get_bq76942_cell_register(
    size_t cell_index)
{
    return (uint8_t)(
        BQ76942_CELL_1_REGISTER +
        (cell_index * BQ76942_CELL_DATA_LENGTH));
}

/**
 * @brief Add one seven-bit I2C device to the master bus.
 */
static esp_err_t add_i2c_device(
    uint8_t device_address,
    i2c_master_dev_handle_t *device_handle)
{
    if (device_handle == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const i2c_device_config_t device_config = {
        .dev_addr_length = I2C_ADDR_BIT_LEN_7,
        .device_address = device_address,
        .scl_speed_hz = I2C_MONITOR_FREQUENCY_HZ,
        .scl_wait_us = 0,
        .flags = {
            .disable_ack_check = 0,
        },
    };

    return i2c_master_bus_add_device(
        s_bus_handle,
        &device_config,
        device_handle);
}

/**
 * @brief Print raw I2C bytes without decoding.
 */
static void print_raw_bytes(
    const char *device_name,
    uint8_t device_address,
    uint8_t register_address,
    const uint8_t *data,
    size_t data_length,
    esp_err_t status)
{
    if (device_name == NULL) {
        device_name = "I2C device";
    }

    if (status != ESP_OK) {
        ESP_LOGW(
            TAG,
            "%s [0x%02X] register 0x%02X: read failed: %s",
            device_name,
            device_address,
            register_address,
            esp_err_to_name(status));

        return;
    }

    printf(
        "%s [0x%02X] register 0x%02X:",
        device_name,
        device_address,
        register_address);

    for (size_t index = 0; index < data_length; index++) {
        printf(" 0x%02X", data[index]);
    }

    printf("\n");
}

/**
 * @brief Read bytes from a register using a device handle.
 */
static esp_err_t read_register_from_handle(
    i2c_master_dev_handle_t device_handle,
    uint8_t register_address,
    uint8_t *data,
    size_t data_length)
{
    if (device_handle == NULL ||
        data == NULL ||
        data_length == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    return i2c_master_transmit_receive(
        device_handle,
        &register_address,
        sizeof(register_address),
        data,
        data_length,
        I2C_TRANSACTION_TIMEOUT_MS);
}

/**
 * @brief Write a register address followed by zero or more data bytes.
 */
static esp_err_t write_register_to_handle(
    i2c_master_dev_handle_t device_handle,
    uint8_t register_address,
    const uint8_t *data,
    size_t data_length)
{
    if (device_handle == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (data_length > 0 && data == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (data_length > MAX_I2C_WRITE_DATA_LENGTH) {
        return ESP_ERR_INVALID_SIZE;
    }

    uint8_t transmit_buffer[
        MAX_I2C_WRITE_DATA_LENGTH + 1];

    transmit_buffer[0] = register_address;

    if (data_length > 0) {
        memcpy(
            &transmit_buffer[1],
            data,
            data_length);
    }

    return i2c_master_transmit(
        device_handle,
        transmit_buffer,
        data_length + 1,
        I2C_TRANSACTION_TIMEOUT_MS);
}

/**
 * @brief Print all ten BQ76942 cell-voltage register values.
 */
static void print_bq76942_cell_voltages(
    const power_telemetry_t *telemetry)
{
    if (telemetry == NULL) {
        return;
    }

    for (size_t cell_index = 0;
         cell_index < BQ76942_CELL_COUNT;
         cell_index++) {

        const uint8_t register_address =
            get_bq76942_cell_register(cell_index);

        char cell_name[32];

        snprintf(
            cell_name,
            sizeof(cell_name),
            "BQ76942 Cell %u voltage",
            (unsigned int)(cell_index + 1));

        print_raw_bytes(
            cell_name,
            BQ76942_I2C_ADDRESS,
            register_address,
            telemetry->bq76942_cell_voltage[cell_index],
            BQ76942_CELL_DATA_LENGTH,
            telemetry->bq76942_cell_status[cell_index]);
    }
}

/**
 * @brief Print one complete telemetry sample.
 */
static void print_telemetry(
    const power_telemetry_t *telemetry)
{
    if (telemetry == NULL) {
        return;
    }

    printf(
        "\n================ SAMPLE %lu ================\n",
        (unsigned long)telemetry->sample_number);

    print_raw_bytes(
        "INA226 calibration",
        INA226_I2C_ADDRESS,
        0x05,
        telemetry->ina226_calibration,
        sizeof(telemetry->ina226_calibration),
        telemetry->ina226_calibration_status);

    print_raw_bytes(
        "INA226 shunt voltage",
        INA226_I2C_ADDRESS,
        0x01,
        telemetry->ina226_shunt_voltage,
        sizeof(telemetry->ina226_shunt_voltage),
        telemetry->ina226_shunt_status);

    print_raw_bytes(
        "INA226 bus voltage",
        INA226_I2C_ADDRESS,
        0x02,
        telemetry->ina226_bus_voltage,
        sizeof(telemetry->ina226_bus_voltage),
        telemetry->ina226_bus_status);

    print_raw_bytes(
        "INA226 power",
        INA226_I2C_ADDRESS,
        0x03,
        telemetry->ina226_power,
        sizeof(telemetry->ina226_power),
        telemetry->ina226_power_status);

    print_raw_bytes(
        "INA226 current",
        INA226_I2C_ADDRESS,
        0x04,
        telemetry->ina226_current,
        sizeof(telemetry->ina226_current),
        telemetry->ina226_current_status);

    print_bq76942_cell_voltages(telemetry);

    print_raw_bytes(
        "BQ25798 register 13",
        BQ25798_I2C_ADDRESS,
        0x13,
        &telemetry->bq25798_reg13,
        sizeof(telemetry->bq25798_reg13),
        telemetry->bq25798_reg13_status);

    print_raw_bytes(
        "BQ25798 fault status",
        BQ25798_I2C_ADDRESS,
        0x20,
        &telemetry->bq25798_fault_status_0,
        sizeof(telemetry->bq25798_fault_status_0),
        telemetry->bq25798_fault_status);

    printf(
        "============================================\n");
}

/**
 * @brief Continuous telemetry monitoring task.
 */
static void bus_monitor_task(void *argument)
{
    (void)argument;

    TickType_t last_wake_time =
        xTaskGetTickCount();

    uint32_t sample_number = 0;

    while (true) {
        power_telemetry_t telemetry = {0};

        telemetry.sample_number =
            ++sample_number;

        const esp_err_t status =
            i2c_bus_monitor_read_all(&telemetry);

        if (status == ESP_OK) {
            print_telemetry(&telemetry);

            if (xSemaphoreTake(
                    s_telemetry_mutex,
                    pdMS_TO_TICKS(50)) == pdTRUE) {

                s_latest_telemetry = telemetry;

                xSemaphoreGive(
                    s_telemetry_mutex);
            } else {
                ESP_LOGW(
                    TAG,
                    "Could not lock telemetry mutex");
            }
        } else {
            ESP_LOGE(
                TAG,
                "Monitoring cycle failed: %s",
                esp_err_to_name(status));
        }

        vTaskDelayUntil(
            &last_wake_time,
            pdMS_TO_TICKS(BUS_MONITOR_PERIOD_MS));
    }
}

esp_err_t i2c_bus_read_register(
    uint8_t device_address,
    uint8_t register_address,
    uint8_t *data,
    size_t data_length)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (data == NULL || data_length == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    const i2c_master_dev_handle_t device_handle =
        get_device_handle(device_address);

    if (device_handle == NULL) {
        ESP_LOGE(
            TAG,
            "No device handle exists for address 0x%02X",
            device_address);

        return ESP_ERR_NOT_FOUND;
    }

    return read_register_from_handle(
        device_handle,
        register_address,
        data,
        data_length);
}

esp_err_t i2c_bus_write_register(
    uint8_t device_address,
    uint8_t register_address,
    const uint8_t *data,
    size_t data_length)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    const i2c_master_dev_handle_t device_handle =
        get_device_handle(device_address);

    if (device_handle == NULL) {
        ESP_LOGE(
            TAG,
            "No device handle exists for address 0x%02X",
            device_address);

        return ESP_ERR_NOT_FOUND;
    }

    return write_register_to_handle(
        device_handle,
        register_address,
        data,
        data_length);
}

esp_err_t i2c_bus_monitor_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    const i2c_master_bus_config_t bus_config = {
        .i2c_port = I2C_NUM_0,
        .sda_io_num = I2C_MONITOR_SDA_GPIO,
        .scl_io_num = I2C_MONITOR_SCL_GPIO,
        .clk_source = I2C_CLK_SRC_DEFAULT,
        .glitch_ignore_cnt = 7,
        .intr_priority = 0,
        .trans_queue_depth = 0,
        .flags = {
            .enable_internal_pullup = 0,
            .allow_pd = 0,
        },
    };

    esp_err_t status =
        i2c_new_master_bus(
            &bus_config,
            &s_bus_handle);

    if (status != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to create I2C master bus: %s",
            esp_err_to_name(status));

        return status;
    }

    status = add_i2c_device(
        INA226_I2C_ADDRESS,
        &s_ina226_handle);

    if (status != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to add INA226: %s",
            esp_err_to_name(status));

        return status;
    }

    status = add_i2c_device(
        BQ76942_I2C_ADDRESS,
        &s_bq76942_handle);

    if (status != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to add BQ76942: %s",
            esp_err_to_name(status));

        return status;
    }

    status = add_i2c_device(
        BQ25798_I2C_ADDRESS,
        &s_bq25798_handle);

    if (status != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Failed to add BQ25798: %s",
            esp_err_to_name(status));

        return status;
    }

    s_telemetry_mutex =
        xSemaphoreCreateMutex();

    if (s_telemetry_mutex == NULL) {
        ESP_LOGE(
            TAG,
            "Failed to create telemetry mutex");

        return ESP_ERR_NO_MEM;
    }

    memset(
        &s_latest_telemetry,
        0,
        sizeof(s_latest_telemetry));

    s_initialized = true;

    ESP_LOGI(
        TAG,
        "I2C initialized: SDA=%d, SCL=%d, frequency=%d Hz",
        I2C_MONITOR_SDA_GPIO,
        I2C_MONITOR_SCL_GPIO,
        I2C_MONITOR_FREQUENCY_HZ);

    ESP_LOGI(
        TAG,
        "Devices configured: INA226=0x%02X, BQ76942=0x%02X, BQ25798=0x%02X",
        INA226_I2C_ADDRESS,
        BQ76942_I2C_ADDRESS,
        BQ25798_I2C_ADDRESS);

    return ESP_OK;
}

esp_err_t i2c_bus_monitor_read_all(
    power_telemetry_t *telemetry)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (telemetry == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    /*
     * INA226 register 0x05, length 2.
     */
    telemetry->ina226_calibration_status =
        i2c_bus_read_register(
            INA226_I2C_ADDRESS,
            0x05,
            telemetry->ina226_calibration,
            sizeof(telemetry->ina226_calibration));

    /*
     * INA226 register 0x01, length 2.
     */
    telemetry->ina226_shunt_status =
        i2c_bus_read_register(
            INA226_I2C_ADDRESS,
            0x01,
            telemetry->ina226_shunt_voltage,
            sizeof(telemetry->ina226_shunt_voltage));

    /*
     * INA226 register 0x02, length 2.
     */
    telemetry->ina226_bus_status =
        i2c_bus_read_register(
            INA226_I2C_ADDRESS,
            0x02,
            telemetry->ina226_bus_voltage,
            sizeof(telemetry->ina226_bus_voltage));

    /*
     * INA226 register 0x03, length 2.
     */
    telemetry->ina226_power_status =
        i2c_bus_read_register(
            INA226_I2C_ADDRESS,
            0x03,
            telemetry->ina226_power,
            sizeof(telemetry->ina226_power));

    /*
     * INA226 register 0x04, length 2.
     */
    telemetry->ina226_current_status =
        i2c_bus_read_register(
            INA226_I2C_ADDRESS,
            0x04,
            telemetry->ina226_current,
            sizeof(telemetry->ina226_current));

    /*
     * BQ76942 cell-voltage registers.
     *
     * Cell 1:  read 0x14 and 0x15
     * Cell 2:  read 0x16 and 0x17
     * Cell 3:  read 0x18 and 0x19
     * Cell 4:  read 0x1A and 0x1B
     * Cell 5:  read 0x1C and 0x1D
     * Cell 6:  read 0x1E and 0x1F
     * Cell 7:  read 0x20 and 0x21
     * Cell 8:  read 0x22 and 0x23
     * Cell 9:  read 0x24 and 0x25
     * Cell 10: read 0x26 and 0x27
     */
    for (size_t cell_index = 0;
         cell_index < BQ76942_CELL_COUNT;
         cell_index++) {

        const uint8_t register_address =
            get_bq76942_cell_register(cell_index);

        telemetry->bq76942_cell_status[cell_index] =
            i2c_bus_read_register(
                BQ76942_I2C_ADDRESS,
                register_address,
                telemetry->bq76942_cell_voltage[cell_index],
                BQ76942_CELL_DATA_LENGTH);
    }

    /*
     * BQ25798 register 0x13, length 1.
     */
    telemetry->bq25798_reg13_status =
        i2c_bus_read_register(
            BQ25798_I2C_ADDRESS,
            0x13,
            &telemetry->bq25798_reg13,
            sizeof(telemetry->bq25798_reg13));

    /*
     * BQ25798 fault status register 0x20, length 1.
     */
    telemetry->bq25798_fault_status =
        i2c_bus_read_register(
            BQ25798_I2C_ADDRESS,
            0x20,
            &telemetry->bq25798_fault_status_0,
            sizeof(telemetry->bq25798_fault_status_0));

    /*
     * Individual failures are stored in each status field.
     * The overall monitoring cycle continues even if one device
     * does not respond.
     */
    return ESP_OK;
}

esp_err_t i2c_bus_monitor_start(void)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if (s_monitor_task_handle != NULL) {
        return ESP_OK;
    }

    const BaseType_t task_result =
        xTaskCreate(
            bus_monitor_task,
            "i2c_bus_monitor",
            BUS_MONITOR_TASK_STACK,
            NULL,
            BUS_MONITOR_TASK_PRIORITY,
            &s_monitor_task_handle);

    if (task_result != pdPASS) {
        s_monitor_task_handle = NULL;

        ESP_LOGE(
            TAG,
            "Failed to create I2C monitor task");

        return ESP_ERR_NO_MEM;
    }

    ESP_LOGI(
        TAG,
        "I2C monitor task started");

    return ESP_OK;
}

esp_err_t i2c_bus_monitor_get_latest(
    power_telemetry_t *telemetry)
{
    if (telemetry == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (s_telemetry_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(
            s_telemetry_mutex,
            pdMS_TO_TICKS(100)) != pdTRUE) {

        return ESP_ERR_TIMEOUT;
    }

    *telemetry = s_latest_telemetry;

    xSemaphoreGive(
        s_telemetry_mutex);

    return ESP_OK;
}