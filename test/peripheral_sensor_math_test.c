#include <assert.h>
#include <math.h>
#include <stdio.h>

#include "peripheral_sensor_math.h"

static void assert_near(float actual, float expected)
{
    assert(fabsf(actual - expected) < 0.0001f);
}

int main(void)
{
    assert_near(peripheral_temperature_c_from_mv(500), 0.0f);
    assert_near(peripheral_temperature_c_from_mv(750), 25.0f);
    assert_near(peripheral_temperature_c_from_mv(1000), 50.0f);

    assert_near(peripheral_relative_light_from_mv(0), 0.0f);
    assert_near(peripheral_relative_light_from_mv(1550), 0.5f);
    assert_near(peripheral_relative_light_from_mv(3100), 1.0f);
    assert_near(peripheral_relative_light_from_mv(3600), 1.0f);

    assert(peripheral_light_level_from_mv(0) == PERIPHERAL_LIGHT_LIGHTLY_LIT);
    assert(peripheral_light_level_from_mv(799) == PERIPHERAL_LIGHT_LIGHTLY_LIT);
    assert(peripheral_light_level_from_mv(800) == PERIPHERAL_LIGHT_BRIGHT);
    assert(peripheral_light_level_from_mv(1800) == PERIPHERAL_LIGHT_BRIGHT);
    assert(peripheral_light_level_from_mv(1801) == PERIPHERAL_LIGHT_VERY_BRIGHT);

    puts("peripheral sensor conversion tests passed");
    return 0;
}
