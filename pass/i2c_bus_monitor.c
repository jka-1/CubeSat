#include "i2c_bus_monitor.h"

#include <inttypes.h>
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
#define BQ25798_REG_CHARGER_CONTROL_3  0x12
#define BQ25798_REG_CHARGER_CONTROL_4  0x13
#define BQ25798_REG_CHARGER_STATUS_3   0x1E
#define BQ25798_DIS_ACDRV_MASK          0x80
#define BQ25798_EN_ACDRV1_MASK          0x40
#define BQ25798_EN_ACDRV2_MASK          0x80
#define BQ25798_ACDRV_SELECT_MASK       \
    (BQ25798_EN_ACDRV1_MASK | BQ25798_EN_ACDRV2_MASK)

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
static SemaphoreHandle_t s_bus_mutex;
static SemaphoreHandle_t s_telemetry_mutex;
static power_telemetry_t s_latest_telemetry;
static volatile uint32_t s_enabled_sensor_mask =
    I2C_SENSOR_GROUP_ALL;

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

static void clear_ina226_fields(
    power_telemetry_t *telemetry,
    esp_err_t status)
{
    if (telemetry == NULL) {
        return;
    }

    memset(
        telemetry->ina226_calibration,
        0,
        sizeof(telemetry->ina226_calibration));
    memset(
        telemetry->ina226_shunt_voltage,
        0,
        sizeof(telemetry->ina226_shunt_voltage));
    memset(
        telemetry->ina226_bus_voltage,
        0,
        sizeof(telemetry->ina226_bus_voltage));
    memset(
        telemetry->ina226_power,
        0,
        sizeof(telemetry->ina226_power));
    memset(
        telemetry->ina226_current,
        0,
        sizeof(telemetry->ina226_current));

    telemetry->ina226_calibration_status = status;
    telemetry->ina226_shunt_status = status;
    telemetry->ina226_bus_status = status;
    telemetry->ina226_power_status = status;
    telemetry->ina226_current_status = status;
}

static void clear_bms_fields(
    power_telemetry_t *telemetry,
    esp_err_t status)
{
    if (telemetry == NULL) {
        return;
    }

    memset(
        telemetry->bq76942_cell_voltage,
        0,
        sizeof(telemetry->bq76942_cell_voltage));

    for (size_t cell_index = 0;
         cell_index < BQ76942_CELL_COUNT;
         cell_index++) {
        telemetry->bq76942_cell_status[cell_index] = status;
    }
}

static void clear_mppt_fields(
    power_telemetry_t *telemetry,
    esp_err_t status)
{
    if (telemetry == NULL) {
        return;
    }

    telemetry->bq25798_reg13 = 0u;
    telemetry->bq25798_fault_status_0 = 0u;
    telemetry->bq25798_reg13_status = status;
    telemetry->bq25798_fault_status = status;
}

static void copy_group_from_snapshot(
    power_telemetry_t *destination,
    const power_telemetry_t *snapshot,
    uint32_t sensor_mask)
{
    if (destination == NULL || snapshot == NULL) {
        return;
    }

    if ((sensor_mask & I2C_SENSOR_GROUP_PV) != 0u) {
        memcpy(
            destination->ina226_calibration,
            snapshot->ina226_calibration,
            sizeof(destination->ina226_calibration));
        memcpy(
            destination->ina226_shunt_voltage,
            snapshot->ina226_shunt_voltage,
            sizeof(destination->ina226_shunt_voltage));
        memcpy(
            destination->ina226_bus_voltage,
            snapshot->ina226_bus_voltage,
            sizeof(destination->ina226_bus_voltage));
        memcpy(
            destination->ina226_power,
            snapshot->ina226_power,
            sizeof(destination->ina226_power));
        memcpy(
            destination->ina226_current,
            snapshot->ina226_current,
            sizeof(destination->ina226_current));

        destination->ina226_calibration_status =
            snapshot->ina226_calibration_status;
        destination->ina226_shunt_status =
            snapshot->ina226_shunt_status;
        destination->ina226_bus_status =
            snapshot->ina226_bus_status;
        destination->ina226_power_status =
            snapshot->ina226_power_status;
        destination->ina226_current_status =
            snapshot->ina226_current_status;
    }

    if ((sensor_mask & I2C_SENSOR_GROUP_BMS) != 0u) {
        memcpy(
            destination->bq76942_cell_voltage,
            snapshot->bq76942_cell_voltage,
            sizeof(destination->bq76942_cell_voltage));
        memcpy(
            destination->bq76942_cell_status,
            snapshot->bq76942_cell_status,
            sizeof(destination->bq76942_cell_status));
    }

    if ((sensor_mask & I2C_SENSOR_GROUP_MPPT) != 0u) {
        destination->bq25798_reg13 =
            snapshot->bq25798_reg13;
        destination->bq25798_fault_status_0 =
            snapshot->bq25798_fault_status_0;
        destination->bq25798_reg13_status =
            snapshot->bq25798_reg13_status;
        destination->bq25798_fault_status =
            snapshot->bq25798_fault_status;
    }
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

    if (s_bus_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(
            s_bus_mutex,
            pdMS_TO_TICKS(I2C_TRANSACTION_TIMEOUT_MS)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    const esp_err_t status = read_register_from_handle(
        device_handle,
        register_address,
        data,
        data_length);

    xSemaphoreGive(s_bus_mutex);
    return status;
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

    if (s_bus_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(
            s_bus_mutex,
            pdMS_TO_TICKS(I2C_TRANSACTION_TIMEOUT_MS)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    const esp_err_t status = write_register_to_handle(
        device_handle,
        register_address,
        data,
        data_length);

    xSemaphoreGive(s_bus_mutex);
    return status;
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

    s_bus_mutex =
        xSemaphoreCreateMutex();

    if (s_bus_mutex == NULL) {
        ESP_LOGE(
            TAG,
            "Failed to create I2C bus mutex");

        return ESP_ERR_NO_MEM;
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

    s_enabled_sensor_mask =
        I2C_SENSOR_GROUP_ALL;

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

    const uint32_t enabled_sensor_mask =
        s_enabled_sensor_mask;
    telemetry->enabled_sensor_mask =
        enabled_sensor_mask;
    power_telemetry_t latest_snapshot = {0};

    if (s_telemetry_mutex != NULL &&
        xSemaphoreTake(
            s_telemetry_mutex,
            pdMS_TO_TICKS(50)) == pdTRUE) {
        latest_snapshot = s_latest_telemetry;
        xSemaphoreGive(s_telemetry_mutex);
    }

    if (s_bus_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (xSemaphoreTake(
            s_bus_mutex,
            pdMS_TO_TICKS(I2C_TRANSACTION_TIMEOUT_MS * 5u)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    if ((enabled_sensor_mask & I2C_SENSOR_GROUP_PV) != 0u) {
        telemetry->ina226_calibration_status =
            read_register_from_handle(
                s_ina226_handle,
                0x05,
                telemetry->ina226_calibration,
                sizeof(telemetry->ina226_calibration));

        telemetry->ina226_shunt_status =
            read_register_from_handle(
                s_ina226_handle,
                0x01,
                telemetry->ina226_shunt_voltage,
                sizeof(telemetry->ina226_shunt_voltage));

        telemetry->ina226_bus_status =
            read_register_from_handle(
                s_ina226_handle,
                0x02,
                telemetry->ina226_bus_voltage,
                sizeof(telemetry->ina226_bus_voltage));

        telemetry->ina226_power_status =
            read_register_from_handle(
                s_ina226_handle,
                0x03,
                telemetry->ina226_power,
                sizeof(telemetry->ina226_power));

        telemetry->ina226_current_status =
            read_register_from_handle(
                s_ina226_handle,
                0x04,
                telemetry->ina226_current,
                sizeof(telemetry->ina226_current));
    } else {
        if (latest_snapshot.sample_number > 0u) {
            copy_group_from_snapshot(
                telemetry,
                &latest_snapshot,
                I2C_SENSOR_GROUP_PV);
        } else {
            clear_ina226_fields(
                telemetry,
                ESP_ERR_NOT_SUPPORTED);
        }
    }

    if ((enabled_sensor_mask & I2C_SENSOR_GROUP_BMS) != 0u) {
        for (size_t cell_index = 0;
             cell_index < BQ76942_CELL_COUNT;
             cell_index++) {

            const uint8_t register_address =
                get_bq76942_cell_register(cell_index);

            telemetry->bq76942_cell_status[cell_index] =
                read_register_from_handle(
                    s_bq76942_handle,
                    register_address,
                    telemetry->bq76942_cell_voltage[cell_index],
                    BQ76942_CELL_DATA_LENGTH);
        }
    } else {
        if (latest_snapshot.sample_number > 0u) {
            copy_group_from_snapshot(
                telemetry,
                &latest_snapshot,
                I2C_SENSOR_GROUP_BMS);
        } else {
            clear_bms_fields(
                telemetry,
                ESP_ERR_NOT_SUPPORTED);
        }
    }

    if ((enabled_sensor_mask & I2C_SENSOR_GROUP_MPPT) != 0u) {
        telemetry->bq25798_reg13_status =
            read_register_from_handle(
                s_bq25798_handle,
                0x13,
                &telemetry->bq25798_reg13,
                sizeof(telemetry->bq25798_reg13));

        telemetry->bq25798_fault_status =
            read_register_from_handle(
                s_bq25798_handle,
                0x20,
                &telemetry->bq25798_fault_status_0,
                sizeof(telemetry->bq25798_fault_status_0));
    } else {
        if (latest_snapshot.sample_number > 0u) {
            copy_group_from_snapshot(
                telemetry,
                &latest_snapshot,
                I2C_SENSOR_GROUP_MPPT);
        } else {
            clear_mppt_fields(
                telemetry,
                ESP_ERR_NOT_SUPPORTED);
        }
    }

    xSemaphoreGive(s_bus_mutex);

    if (s_telemetry_mutex != NULL &&
        xSemaphoreTake(
            s_telemetry_mutex,
            pdMS_TO_TICKS(50)) == pdTRUE) {
        s_latest_telemetry = *telemetry;
        xSemaphoreGive(s_telemetry_mutex);
    }

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

esp_err_t i2c_bus_monitor_set_sensor_enabled(
    uint32_t sensor_mask,
    bool enabled)
{
    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    if ((sensor_mask & I2C_SENSOR_GROUP_ALL) == 0u) {
        return ESP_ERR_INVALID_ARG;
    }

    const uint32_t normalized_mask =
        sensor_mask & I2C_SENSOR_GROUP_ALL;

    if (enabled) {
        s_enabled_sensor_mask |= normalized_mask;
    } else {
        s_enabled_sensor_mask &= ~normalized_mask;
    }

    ESP_LOGI(
        TAG,
        "Automatic polling %s for sensor mask 0x%02" PRIX32
        " (active mask 0x%02" PRIX32 ")",
        enabled ? "enabled" : "disabled",
        normalized_mask,
        s_enabled_sensor_mask);

    return ESP_OK;
}

esp_err_t i2c_bus_monitor_get_sensor_mask(
    uint32_t *out_sensor_mask)
{
    if (out_sensor_mask == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    *out_sensor_mask = s_enabled_sensor_mask;
    return ESP_OK;
}

esp_err_t i2c_bus_monitor_set_acdrv_state(
    i2c_acdrv_state_t state,
    i2c_acdrv_result_t *out_result)
{
    if (!s_initialized || s_bus_mutex == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    if (out_result == NULL ||
        state < I2C_ACDRV_DISABLED ||
        state > I2C_ACDRV2_SELECTED) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(out_result, 0, sizeof(*out_result));

    if (xSemaphoreTake(
            s_bus_mutex,
            pdMS_TO_TICKS(I2C_TRANSACTION_TIMEOUT_MS * 5u)) != pdTRUE) {
        return ESP_ERR_TIMEOUT;
    }

    esp_err_t status = read_register_from_handle(
        s_bq25798_handle,
        BQ25798_REG_CHARGER_CONTROL_3,
        &out_result->register_12_before,
        sizeof(out_result->register_12_before));

    if (status != ESP_OK) {
        goto release_bus;
    }

    status = read_register_from_handle(
        s_bq25798_handle,
        BQ25798_REG_CHARGER_CONTROL_4,
        &out_result->register_13_before,
        sizeof(out_result->register_13_before));

    if (status != ESP_OK) {
        goto release_bus;
    }

    status = read_register_from_handle(
        s_bq25798_handle,
        BQ25798_REG_CHARGER_STATUS_3,
        &out_result->acrb_status,
        sizeof(out_result->acrb_status));

    if (status != ESP_OK) {
        goto release_bus;
    }

    const uint8_t requested_presence_mask =
        state == I2C_ACDRV1_SELECTED
            ? BQ25798_EN_ACDRV1_MASK
            : state == I2C_ACDRV2_SELECTED
                ? BQ25798_EN_ACDRV2_MASK
                : 0u;

    if (requested_presence_mask != 0u &&
        (out_result->acrb_status & requested_presence_mask) == 0u) {
        status = ESP_ERR_NOT_FOUND;
        goto copy_current_state;
    }

    const uint8_t desired_register_12 =
        state == I2C_ACDRV_DISABLED
            ? (uint8_t)(
                out_result->register_12_before |
                BQ25798_DIS_ACDRV_MASK)
            : (uint8_t)(
                out_result->register_12_before &
                (uint8_t)~BQ25798_DIS_ACDRV_MASK);

    const uint8_t desired_acdrv_bits =
        state == I2C_ACDRV1_SELECTED
            ? BQ25798_EN_ACDRV1_MASK
            : state == I2C_ACDRV2_SELECTED
                ? BQ25798_EN_ACDRV2_MASK
                : 0u;

    const uint8_t desired_register_13 = (uint8_t)(
        (out_result->register_13_before &
         (uint8_t)~BQ25798_ACDRV_SELECT_MASK) |
        desired_acdrv_bits);

    if (state == I2C_ACDRV_DISABLED) {
        if (desired_register_12 != out_result->register_12_before) {
            status = write_register_to_handle(
                s_bq25798_handle,
                BQ25798_REG_CHARGER_CONTROL_3,
                &desired_register_12,
                sizeof(desired_register_12));
        }
    } else {
        /* Pre-stage the selection while DIS_ACDRV still protects the path. */
        if ((out_result->register_12_before &
             BQ25798_DIS_ACDRV_MASK) != 0u) {
            status = write_register_to_handle(
                s_bq25798_handle,
                BQ25798_REG_CHARGER_CONTROL_4,
                &desired_register_13,
                sizeof(desired_register_13));
        }

        if (status == ESP_OK &&
            desired_register_12 != out_result->register_12_before) {
            status = write_register_to_handle(
                s_bq25798_handle,
                BQ25798_REG_CHARGER_CONTROL_3,
                &desired_register_12,
                sizeof(desired_register_12));
        }

        if (status == ESP_OK) {
            status = write_register_to_handle(
                s_bq25798_handle,
                BQ25798_REG_CHARGER_CONTROL_4,
                &desired_register_13,
                sizeof(desired_register_13));
        }
    }

    if (status != ESP_OK) {
        goto release_bus;
    }

    status = read_register_from_handle(
        s_bq25798_handle,
        BQ25798_REG_CHARGER_CONTROL_3,
        &out_result->register_12_after,
        sizeof(out_result->register_12_after));

    if (status != ESP_OK) {
        goto release_bus;
    }

    status = read_register_from_handle(
        s_bq25798_handle,
        BQ25798_REG_CHARGER_CONTROL_4,
        &out_result->register_13_after,
        sizeof(out_result->register_13_after));

    if (status != ESP_OK) {
        goto release_bus;
    }

    status = read_register_from_handle(
        s_bq25798_handle,
        BQ25798_REG_CHARGER_STATUS_3,
        &out_result->acrb_status,
        sizeof(out_result->acrb_status));

    if (status != ESP_OK) {
        goto release_bus;
    }

    const bool register_12_preserved =
        (out_result->register_12_after &
         (uint8_t)~BQ25798_DIS_ACDRV_MASK) ==
        (out_result->register_12_before &
         (uint8_t)~BQ25798_DIS_ACDRV_MASK);
    const bool register_13_preserved =
        (out_result->register_13_after &
         (uint8_t)~BQ25798_ACDRV_SELECT_MASK) ==
        (out_result->register_13_before &
         (uint8_t)~BQ25798_ACDRV_SELECT_MASK);
    const bool state_verified =
        state == I2C_ACDRV_DISABLED
            ? (out_result->register_12_after &
               BQ25798_DIS_ACDRV_MASK) != 0u &&
              (out_result->register_13_after &
               BQ25798_ACDRV_SELECT_MASK) == 0u
            : (out_result->register_12_after &
               BQ25798_DIS_ACDRV_MASK) == 0u &&
              (out_result->register_13_after &
               BQ25798_ACDRV_SELECT_MASK) == desired_acdrv_bits;
    const bool presence_verified =
        requested_presence_mask == 0u ||
        (out_result->acrb_status & requested_presence_mask) != 0u;

    out_result->verified =
        register_12_preserved &&
        register_13_preserved &&
        state_verified &&
        presence_verified;

    if (!out_result->verified) {
        status = ESP_ERR_INVALID_RESPONSE;
    }

    goto release_bus;

copy_current_state:
    out_result->register_12_after =
        out_result->register_12_before;
    out_result->register_13_after =
        out_result->register_13_before;

release_bus:
    xSemaphoreGive(s_bus_mutex);
    return status;
}
