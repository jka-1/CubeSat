#ifndef PERIPHERAL_SENSORS_H
#define PERIPHERAL_SENSORS_H

#include <stdbool.h>

#include "esp_err.h"

typedef struct
{
    bool temperature_valid;
    bool temperature_saturated;
    float temperature_c;
    int temperature_voltage_mv;

    bool light_valid;
    bool light_saturated;
    int light_voltage_mv;
    float relative_light_level;
} peripheral_sensor_sample_t;

esp_err_t peripheral_sensors_init(void);

esp_err_t peripheral_sensors_read(
    peripheral_sensor_sample_t *out_sample);

/* Copy of the last peripheral_sensors_read() result (all invalid before the first read). */
void peripheral_sensors_get_last(peripheral_sensor_sample_t *out_sample);

/* Configured GPIO of each ADC device, or -1 when unassigned/disabled. */
int peripheral_sensors_temp_gpio(void);
int peripheral_sensors_light_gpio(void);

#endif
