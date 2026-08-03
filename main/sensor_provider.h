#ifndef SENSOR_PROVIDER_H
#define SENSOR_PROVIDER_H

#include "esp_err.h"
#include "telemetry_types.h"

esp_err_t sensor_provider_init(void);

esp_err_t sensor_provider_read_sample(
    telemetry_sample_t *sample
);

esp_err_t sensor_provider_set_solar_panel_current(
    float current_a
);

esp_err_t sensor_provider_set_battery_voltage(
    float voltage_v
);

esp_err_t sensor_provider_set_mppt_temperature(
    float temperature_c
);

#endif