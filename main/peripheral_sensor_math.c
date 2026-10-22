#include "peripheral_sensor_math.h"

float peripheral_temperature_c_from_mv(int voltage_mv)
{
    return ((float)voltage_mv - 500.0f) / 10.0f;
}

float peripheral_relative_light_from_mv(int voltage_mv)
{
    if (voltage_mv <= 0) {
        return 0.0f;
    }

    if (voltage_mv >= PERIPHERAL_LIGHT_FULL_SCALE_MV) {
        return 1.0f;
    }

    return (float)voltage_mv /
        (float)PERIPHERAL_LIGHT_FULL_SCALE_MV;
}

peripheral_light_level_t peripheral_light_level_from_mv(int voltage_mv)
{
    if (voltage_mv < PERIPHERAL_LIGHT_BRIGHT_MIN_MV) {
        return PERIPHERAL_LIGHT_LIGHTLY_LIT;
    }
    if (voltage_mv <= PERIPHERAL_LIGHT_VERY_BRIGHT_MIN_MV) {
        return PERIPHERAL_LIGHT_BRIGHT;
    }
    return PERIPHERAL_LIGHT_VERY_BRIGHT;
}

const char *peripheral_light_level_name(peripheral_light_level_t level)
{
    switch (level) {
    case PERIPHERAL_LIGHT_LIGHTLY_LIT:
        return "Lightly Lit";
    case PERIPHERAL_LIGHT_BRIGHT:
        return "Bright";
    default:
        return "Very Bright";
    }
}
