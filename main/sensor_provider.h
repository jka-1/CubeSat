#ifndef SENSOR_PROVIDER_H
#define SENSOR_PROVIDER_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "telemetry_types.h"

esp_err_t sensor_provider_init(void);

esp_err_t sensor_provider_read_sample(
    telemetry_sample_t *sample
);

esp_err_t sensor_provider_load_demo_profile(
    bool faulted
);

esp_err_t sensor_provider_set_pv_shunt_voltage(
    float shunt_voltage_mv
);

esp_err_t sensor_provider_set_pv_power(
    float power_w
);

esp_err_t sensor_provider_set_pv_current(
    float current_a
);

esp_err_t sensor_provider_set_mppt_switch_enabled(
    bool enabled
);

esp_err_t sensor_provider_set_mppt_fault_mask(
    uint16_t fault_mask
);

esp_err_t sensor_provider_set_bms_cell_voltage(
    size_t cell_index,
    float voltage_v
);

esp_err_t sensor_provider_set_load_shunt_voltage(
    float shunt_voltage_mv
);

esp_err_t sensor_provider_set_load_power(
    float power_w
);

esp_err_t sensor_provider_set_load_current(
    float current_a
);

#endif
