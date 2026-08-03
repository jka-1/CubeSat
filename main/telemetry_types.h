#pragma once

#include <stdint.h>

typedef struct {
    float solar_panel_current_a;
    float battery_voltage_v;
    float mppt_switch_temperature_c;
    float esp32_temperature_c;

    uint32_t sample_counter;
    uint64_t device_uptime_ms;
} telemetry_sample_t;
