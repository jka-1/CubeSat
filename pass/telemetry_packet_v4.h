#ifndef TELEMETRY_PACKET_V4_H
#define TELEMETRY_PACKET_V4_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "i2c_bus_monitor.h"

#ifdef __cplusplus
extern "C" {
#endif

#define TELEMETRY_PACKET_V4_MAGIC                    0x4353u
#define TELEMETRY_PACKET_V4_VERSION                  0x0004u
#define TELEMETRY_PACKET_V4_WORD_COUNT               20u
#define TELEMETRY_PACKET_V4_HEX_CHARS                (TELEMETRY_PACKET_V4_WORD_COUNT * 4u)
#define TELEMETRY_PACKET_V4_FLAG_TEMPERATURE_VALID   (1u << 0)
#define TELEMETRY_PACKET_V4_FLAG_LIGHT_VALID         (1u << 1)
#define TELEMETRY_PACKET_V4_FLAG_TEMPERATURE_SATURATED (1u << 2)
#define TELEMETRY_PACKET_V4_FLAG_LIGHT_SATURATED     (1u << 3)

typedef struct
{
    uint16_t sequence;
    bool has_mcu_temperature;
    int16_t mcu_temperature_centi_c;
    bool has_peripheral_temperature;
    bool peripheral_temperature_saturated;
    int16_t peripheral_temperature_centi_c;
    bool has_light;
    bool light_saturated;
    uint16_t light_voltage_mv;
    uint16_t relative_light_basis_points;
} telemetry_packet_v4_meta_t;

esp_err_t telemetry_packet_v4_build_words(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v4_meta_t *meta,
    uint16_t out_words[TELEMETRY_PACKET_V4_WORD_COUNT]);

esp_err_t telemetry_packet_v4_format_hex(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v4_meta_t *meta,
    char *output_hex,
    size_t output_hex_size);

#ifdef __cplusplus
}
#endif

#endif
