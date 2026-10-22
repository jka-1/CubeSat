#ifndef PERIPHERAL_SENSOR_MATH_H
#define PERIPHERAL_SENSOR_MATH_H

#define PERIPHERAL_LIGHT_FULL_SCALE_MV 3100

/* TEMT6000 LIGHT_OUT level bands (calibrated mV); same constants in the bridge and UI. */
#define PERIPHERAL_LIGHT_BRIGHT_MIN_MV      800
#define PERIPHERAL_LIGHT_VERY_BRIGHT_MIN_MV 1800

typedef enum {
    PERIPHERAL_LIGHT_LIGHTLY_LIT = 0, /* < 800 mV */
    PERIPHERAL_LIGHT_BRIGHT,          /* 800..1800 mV */
    PERIPHERAL_LIGHT_VERY_BRIGHT      /* > 1800 mV */
} peripheral_light_level_t;

peripheral_light_level_t peripheral_light_level_from_mv(int voltage_mv);
const char *peripheral_light_level_name(peripheral_light_level_t level);

/* MCP9700: 500 mV at 0 degC, 10 mV/degC -> (mV - 500) / 10 */
float peripheral_temperature_c_from_mv(int voltage_mv);

float peripheral_relative_light_from_mv(int voltage_mv);

#endif
