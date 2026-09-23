#include "telemetry_packet_v4.h"

#include <stdio.h>

#include "telemetry_packet_v3.h"

esp_err_t telemetry_packet_v4_build_words(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v4_meta_t *meta,
    uint16_t out_words[TELEMETRY_PACKET_V4_WORD_COUNT])
{
    if (telemetry == NULL || out_words == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const telemetry_packet_v3_meta_t legacy_meta = {
        .sequence = meta != NULL ? meta->sequence : 0u,
        .has_mcu_temperature = meta != NULL && meta->has_mcu_temperature,
        .mcu_temperature_centi_c = meta != NULL
            ? meta->mcu_temperature_centi_c
            : 0,
    };

    esp_err_t status = telemetry_packet_v3_build_words(
        telemetry,
        &legacy_meta,
        out_words);

    if (status != ESP_OK) {
        return status;
    }

    out_words[1] = TELEMETRY_PACKET_V4_VERSION;

    uint16_t flags = 0u;
    if (meta != NULL && meta->has_peripheral_temperature) {
        flags |= TELEMETRY_PACKET_V4_FLAG_TEMPERATURE_VALID;
    }
    if (meta != NULL && meta->has_light) {
        flags |= TELEMETRY_PACKET_V4_FLAG_LIGHT_VALID;
    }
    if (meta != NULL &&
        meta->has_peripheral_temperature &&
        meta->peripheral_temperature_saturated) {
        flags |= TELEMETRY_PACKET_V4_FLAG_TEMPERATURE_SATURATED;
    }
    if (meta != NULL && meta->has_light && meta->light_saturated) {
        flags |= TELEMETRY_PACKET_V4_FLAG_LIGHT_SATURATED;
    }

    out_words[16] = flags;
    out_words[17] = meta != NULL && meta->has_peripheral_temperature
        ? (uint16_t)meta->peripheral_temperature_centi_c
        : 0u;
    out_words[18] = meta != NULL && meta->has_light
        ? meta->light_voltage_mv
        : 0u;
    out_words[19] = meta != NULL && meta->has_light
        ? (meta->relative_light_basis_points > 10000u
            ? 10000u
            : meta->relative_light_basis_points)
        : 0u;

    return ESP_OK;
}

esp_err_t telemetry_packet_v4_format_hex(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v4_meta_t *meta,
    char *output_hex,
    size_t output_hex_size)
{
    if (output_hex == NULL ||
        output_hex_size < (TELEMETRY_PACKET_V4_HEX_CHARS + 1u)) {
        return ESP_ERR_INVALID_SIZE;
    }

    uint16_t words[TELEMETRY_PACKET_V4_WORD_COUNT] = {0};
    const esp_err_t status = telemetry_packet_v4_build_words(
        telemetry,
        meta,
        words);

    if (status != ESP_OK) {
        return status;
    }

    size_t offset = 0u;
    for (size_t index = 0; index < TELEMETRY_PACKET_V4_WORD_COUNT; index++) {
        offset += (size_t)snprintf(
            output_hex + offset,
            output_hex_size - offset,
            "%04X",
            words[index]);
    }

    output_hex[TELEMETRY_PACKET_V4_HEX_CHARS] = '\0';
    return ESP_OK;
}
