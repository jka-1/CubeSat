#ifndef PERIPHERAL_SENSOR_MATH_H
#define PERIPHERAL_SENSOR_MATH_H

#define PERIPHERAL_LIGHT_FULL_SCALE_MV 3100

float peripheral_temperature_c_from_mv(int voltage_mv);

float peripheral_relative_light_from_mv(int voltage_mv);

#endif
