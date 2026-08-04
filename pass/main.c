#include "i2c_bus_monitor.h"

#include "esp_err.h"
#include "esp_log.h"

static const char *TAG = "main";

void app_main(void)
{
    ESP_ERROR_CHECK(i2c_bus_monitor_init());

    /*
     * Equivalent to:
     *
     * i2cset -c 0x40 -r 0x05 0x0A 0x00
     */
    const uint8_t ina226_calibration[] = {
        0x0A,
        0x00
    };

    esp_err_t status = i2c_bus_write_register(
        INA226_I2C_ADDRESS,
        0x05,
        ina226_calibration,
        sizeof(ina226_calibration));

    if (status != ESP_OK) {
        ESP_LOGW(
            TAG,
            "INA226 calibration write failed: %s",
            esp_err_to_name(status));
    }

    /*
     * Choose only one of these BQ25798 commands.
     *
     * EN_ACDRV1:
     * i2cset -c 0x6B -r 0x13 0x1D
     */
    const uint8_t enable_acdrv1 = 0x1D;

    status = i2c_bus_write_register(
        BQ25798_I2C_ADDRESS,
        0x13,
        &enable_acdrv1,
        sizeof(enable_acdrv1));

    if (status != ESP_OK) {
        ESP_LOGW(
            TAG,
            "BQ25798 EN_ACDRV1 write failed: %s",
            esp_err_to_name(status));
    }

    /*
     * Do not issue 0x1D and 0x2D sequentially unless you intentionally
     * want the second value to replace the first.
     *
     * To use EN_ACDRV2 instead, replace enable_acdrv1 above with:
     *
     * const uint8_t enable_acdrv2 = 0x2D;
     */

    /*
     * Equivalent to:
     *
     * i2cset -c 0x08 -r 0x14
     *
     * This transmits only the byte 0x14 to address 0x08.
     *
     * Enable this only if a register-only write is actually required by
     * your BMS command protocol.
     */
#if 0
    status = i2c_bus_write_register(
        BQ76942_I2C_ADDRESS,
        0x14,
        NULL,
        0);

    if (status != ESP_OK) {
        ESP_LOGW(
            TAG,
            "BQ76942 command 0x14 failed: %s",
            esp_err_to_name(status));
    }
#endif

    ESP_ERROR_CHECK(i2c_bus_monitor_start());
}