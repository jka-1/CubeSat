#ifndef PERIPHERAL_SENSORS_H
#define PERIPHERAL_SENSORS_H

#include <stdbool.h>

#include "esp_err.h"

typedef struct
{
    bool temperature_valid;
    bool temperature_saturated;
    float temperature_c;

    bool light_valid;
    bool light_saturated;
    int light_voltage_mv;
    float relative_light_level;
} peripheral_sensor_sample_t;

esp_err_t peripheral_sensors_init(void);

esp_err_t peripheral_sensors_read(
    peripheral_sensor_sample_t *out_sample);

#endif
