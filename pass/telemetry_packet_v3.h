#ifndef TELEMETRY_PACKET_V3_H
#define TELEMETRY_PACKET_V3_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "i2c_bus_monitor.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TELEMETRY_PACKET_V3_MAGIC                  0x4353u
#define TELEMETRY_PACKET_V3_VERSION                0x0003u
#define TELEMETRY_PACKET_V3_WORD_COUNT             16u
#define TELEMETRY_PACKET_V3_HEX_CHARS              (TELEMETRY_PACKET_V3_WORD_COUNT * 4u)
#define TELEMETRY_PACKET_V3_MCU_TEMP_NOT_SUPPLIED  0x8000u

typedef struct
{
    uint16_t sequence;
    bool has_mcu_temperature;
    int16_t mcu_temperature_centi_c;
} telemetry_packet_v3_meta_t;

esp_err_t telemetry_packet_v3_build_words(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    uint16_t out_words[TELEMETRY_PACKET_V3_WORD_COUNT]);

esp_err_t telemetry_packet_v3_format_hex(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    char *output_hex,
    size_t output_hex_size);

#ifdef __cplusplus
}
#endif

#endif
