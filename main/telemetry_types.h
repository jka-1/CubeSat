#pragma once

#include <stdbool.h>
#include <stdint.h>

#define TELEMETRY_PACKET_MAGIC 0x4353u
#define TELEMETRY_PACKET_VERSION 0x0002u
#define TELEMETRY_PACKET_WORD_COUNT 16u
#define TELEMETRY_PACKET_HEX_CHARS \
    (TELEMETRY_PACKET_WORD_COUNT * 4u)

typedef struct {
    float mcu_temperature_c;

    float pv_shunt_voltage_mv;
    float pv_power_w;
    float pv_current_a;

    bool mppt_switch_enabled;
    uint16_t mppt_fault_mask;

    float bms_cell_voltages_v[4];

    float load_shunt_voltage_mv;
    float load_power_w;
    float load_current_a;

    uint32_t sample_counter;
    uint64_t device_uptime_ms;
} telemetry_sample_t;
