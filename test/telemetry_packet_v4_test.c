#include <assert.h>
#include <stdint.h>
#include <stdio.h>

#include "telemetry_packet_v4.h"

int main(void)
{
    power_telemetry_t telemetry = {0};
    telemetry_packet_v4_meta_t meta = {
        .sequence = 7,
        .has_mcu_temperature = false,
    };
    uint16_t words[TELEMETRY_PACKET_V4_WORD_COUNT] = {0};

    assert(telemetry_packet_v4_build_words(
        &telemetry,
        &meta,
        words) == ESP_OK);
    assert(words[0] == TELEMETRY_PACKET_V4_MAGIC);
    assert(words[1] == TELEMETRY_PACKET_V4_VERSION);
    assert(words[2] == 7u);
    assert(words[16] == 0u);
    assert(words[17] == 0u);
    assert(words[18] == 0u);
    assert(words[19] == 0u);

    meta.has_peripheral_temperature = true;
    meta.peripheral_temperature_saturated = true;
    meta.peripheral_temperature_centi_c = 2500;
    meta.has_light = true;
    meta.light_saturated = true;
    meta.light_voltage_mv = 1550;
    meta.relative_light_basis_points = 5000;

    assert(telemetry_packet_v4_build_words(
        &telemetry,
        &meta,
        words) == ESP_OK);
    assert(words[16] == 0x000fu);
    assert((int16_t)words[17] == 2500);
    assert(words[18] == 1550u);
    assert(words[19] == 5000u);

    puts("telemetry v4 packet tests passed");
    return 0;
}
