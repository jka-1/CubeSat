#include "telemetry_packet_v3.h"

#include <stdio.h>

static uint16_t combine_big_endian_bytes(
    const uint8_t bytes[2])
{
    return (uint16_t)(
        ((uint16_t)bytes[0] << 8) |
        (uint16_t)bytes[1]);
}

static uint16_t combine_little_endian_bytes(
    const uint8_t bytes[2])
{
    return (uint16_t)(
        ((uint16_t)bytes[1] << 8) |
        (uint16_t)bytes[0]);
}

esp_err_t telemetry_packet_v3_build_words(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    uint16_t out_words[TELEMETRY_PACKET_V3_WORD_COUNT])
{
    if (telemetry == NULL || out_words == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    const uint16_t mcu_temperature_word =
        (meta != NULL && meta->has_mcu_temperature)
            ? (uint16_t)meta->mcu_temperature_centi_c
            : TELEMETRY_PACKET_V3_MCU_TEMP_NOT_SUPPLIED;

    const uint16_t sequence =
        (meta != NULL) ? meta->sequence : 0u;

    out_words[0] = TELEMETRY_PACKET_V3_MAGIC;
    out_words[1] = TELEMETRY_PACKET_V3_VERSION;
    out_words[2] = sequence;
    out_words[3] = mcu_temperature_word;

    /*
     * INA226 bytes are already arranged high-byte then low-byte in the
     * captured telemetry buffers.
     */
    out_words[4] = combine_big_endian_bytes(
        telemetry->ina226_calibration);
    out_words[5] = combine_big_endian_bytes(
        telemetry->ina226_shunt_voltage);
    out_words[6] = combine_big_endian_bytes(
        telemetry->ina226_bus_voltage);
    out_words[7] = combine_big_endian_bytes(
        telemetry->ina226_power);
    out_words[8] = combine_big_endian_bytes(
        telemetry->ina226_current);

    /*
     * BQ76942 cell-voltage registers are little-endian. The dashboard uses
     * cells 1, 2, 3, and 10 for the current validated hardware.
     */
    out_words[9] = combine_little_endian_bytes(
        telemetry->bq76942_cell_voltage[0]);
    out_words[10] = combine_little_endian_bytes(
        telemetry->bq76942_cell_voltage[1]);
    out_words[11] = combine_little_endian_bytes(
        telemetry->bq76942_cell_voltage[2]);
    out_words[12] = combine_little_endian_bytes(
        telemetry->bq76942_cell_voltage[9]);

    out_words[13] = (uint16_t)telemetry->bq25798_reg13;
    out_words[14] = (uint16_t)telemetry->bq25798_fault_status_0;
    out_words[15] = 0u;

    return ESP_OK;
}

esp_err_t telemetry_packet_v3_format_hex(
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    char *output_hex,
    size_t output_hex_size)
{
    if (output_hex == NULL ||
        output_hex_size < (TELEMETRY_PACKET_V3_HEX_CHARS + 1u)) {
        return ESP_ERR_INVALID_SIZE;
    }

    uint16_t words[TELEMETRY_PACKET_V3_WORD_COUNT] = {0};

    const esp_err_t status =
        telemetry_packet_v3_build_words(
            telemetry,
            meta,
            words);

    if (status != ESP_OK) {
        return status;
    }

    size_t offset = 0u;

    for (size_t index = 0;
         index < TELEMETRY_PACKET_V3_WORD_COUNT;
         index++) {

        offset += (size_t)snprintf(
            output_hex + offset,
            output_hex_size - offset,
            "%04X",
            words[index]);
    }

    output_hex[TELEMETRY_PACKET_V3_HEX_CHARS] = '\0';
    return ESP_OK;
}
