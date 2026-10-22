#include "debug_mode.h"

#include <string.h>

#include "app_config.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "peripheral_sensors.h"

static const char *TAG = "debug_mode";

static const uint8_t k_device_address[DEBUG_DEVICE_COUNT] = {
    INA226_I2C_ADDRESS,
    BQ76942_I2C_ADDRESS,
    BQ25798_I2C_ADDRESS,
};

static const uint32_t k_device_group[DEBUG_DEVICE_COUNT] = {
    I2C_SENSOR_GROUP_PV,
    I2C_SENSOR_GROUP_BMS,
    I2C_SENSOR_GROUP_MPPT,
};

static volatile bool s_enabled = (DEMO_DEBUG_MODE_DEFAULT != 0);
static volatile uint32_t s_scan_period_ms = DEMO_STREAM_PERIOD_MS;
static uint32_t s_present_mask = I2C_SENSOR_GROUP_ALL;
static uint32_t s_probed_mask;
static int64_t s_last_probe_us;
static uint8_t s_status[DEBUG_DEVICE_COUNT] = {
    DEBUG_STATUS_UNKNOWN, DEBUG_STATUS_UNKNOWN, DEBUG_STATUS_UNKNOWN,
};
static uint16_t s_error_count[DEBUG_DEVICE_COUNT];

static uint16_t sat_inc16(uint16_t value)
{
    return value == 0xFFFFu ? value : (uint16_t)(value + 1u);
}

esp_err_t debug_mode_init(void)
{
    s_scan_period_ms = debug_mode_set_scan_period_ms(DEMO_STREAM_PERIOD_MS);
    debug_mode_probe_devices(true);
    ESP_LOGI(TAG, "debug mode %s, scan period %u ms, presence 0x%X",
             s_enabled ? "on" : "off", (unsigned)s_scan_period_ms, (unsigned)s_present_mask);
    return ESP_OK;
}

bool debug_mode_is_enabled(void)
{
    return s_enabled;
}

void debug_mode_apply_power_save(void)
{
    /*
     * Default modem sleep (WIFI_PS_MIN_MODEM) only wakes the radio every DTIM, so
     * ACKs and commands addressed to the ESP32 can wait up to one DTIM interval
     * (~100-300 ms). Debug mode disables modem sleep for responsive round trips.
     */
    const esp_err_t status = esp_wifi_set_ps(s_enabled ? WIFI_PS_NONE : WIFI_PS_MIN_MODEM);
    if (status != ESP_OK) {
        ESP_LOGW(TAG, "esp_wifi_set_ps failed: %s", esp_err_to_name(status));
    }
}

void debug_mode_set_enabled(bool enabled)
{
    s_enabled = enabled;
    debug_mode_apply_power_save();
    ESP_LOGI(TAG, "debug mode %s", enabled ? "enabled" : "disabled");
}

uint32_t debug_mode_scan_period_ms(void)
{
    return s_scan_period_ms;
}

uint32_t debug_mode_set_scan_period_ms(uint32_t period_ms)
{
    if (period_ms < DEMO_SCAN_PERIOD_MIN_MS) {
        period_ms = DEMO_SCAN_PERIOD_MIN_MS;
    }
    if (period_ms > DEMO_SCAN_PERIOD_MAX_MS) {
        period_ms = DEMO_SCAN_PERIOD_MAX_MS;
    }
    s_scan_period_ms = period_ms;
    return period_ms;
}

uint32_t debug_mode_probe_period_ms(void)
{
    return DEMO_PRESENCE_PROBE_PERIOD_MS;
}

void debug_mode_probe_devices(bool force)
{
#if DEMO_PRESENCE_DETECTION
    const int64_t now_us = esp_timer_get_time();

    if (!force &&
        s_last_probe_us != 0 &&
        (now_us - s_last_probe_us) < ((int64_t)DEMO_PRESENCE_PROBE_PERIOD_MS * 1000)) {
        return;
    }

    s_last_probe_us = now_us;
    uint32_t present = 0u;

    for (uint32_t index = 0; index < DEBUG_DEVICE_COUNT; index++) {
        const esp_err_t status = i2c_bus_probe(k_device_address[index], 20u);

        if (status == ESP_OK) {
            present |= k_device_group[index];
        } else if (status == ESP_ERR_NOT_FOUND) {
            s_status[index] = DEBUG_STATUS_ABSENT;
        } else {
            /* Bus error/timeout: skip reads too, so a stuck device cannot stall the
             * loop with 100 ms transaction timeouts; the status code stays visible. */
            s_status[index] = status == ESP_ERR_TIMEOUT ? DEBUG_STATUS_TIMEOUT : DEBUG_STATUS_OTHER;
            s_error_count[index] = sat_inc16(s_error_count[index]);
        }
        s_probed_mask |= k_device_group[index];
    }

    if (present != s_present_mask) {
        ESP_LOGW(TAG, "device presence changed 0x%X -> 0x%X", (unsigned)s_present_mask, (unsigned)present);
    }
    s_present_mask = present;
    i2c_bus_monitor_set_present_mask(present);
#else
    (void)force;
#endif
}

uint32_t debug_mode_present_mask(void)
{
    return s_present_mask;
}

uint32_t debug_mode_probed_mask(void)
{
    return s_probed_mask;
}

static uint8_t classify(esp_err_t status)
{
    switch (status) {
    case ESP_OK:
        return DEBUG_STATUS_OK;
    case ESP_ERR_NOT_FOUND:
        return DEBUG_STATUS_ABSENT;
    case ESP_ERR_TIMEOUT:
        return DEBUG_STATUS_TIMEOUT;
    case ESP_ERR_NOT_SUPPORTED:
        return DEBUG_STATUS_PAUSED;
    case ESP_FAIL:
    case ESP_ERR_INVALID_STATE:
    case ESP_ERR_INVALID_RESPONSE:
        return DEBUG_STATUS_NACK;
    default:
        return DEBUG_STATUS_OTHER;
    }
}

/* Worst status of a group of transactions (ok < paused < absent < nack < timeout < other). */
static esp_err_t worst(const esp_err_t *statuses, size_t count)
{
    esp_err_t result = ESP_OK;
    for (size_t i = 0; i < count; i++) {
        if (statuses[i] == ESP_OK) {
            continue;
        }
        if (result == ESP_OK ||
            result == ESP_ERR_NOT_SUPPORTED ||
            (result == ESP_ERR_NOT_FOUND && statuses[i] != ESP_ERR_NOT_SUPPORTED)) {
            result = statuses[i];
        }
    }
    return result;
}

void debug_mode_account_read(const power_telemetry_t *telemetry, esp_err_t read_all_status)
{
    if (telemetry == NULL) {
        return;
    }

    if (read_all_status != ESP_OK) {
        /* Bus mutex timeout etc.: every device that should have been read failed. */
        for (uint32_t index = 0; index < DEBUG_DEVICE_COUNT; index++) {
            if ((s_present_mask & k_device_group[index]) != 0u) {
                s_status[index] = classify(read_all_status);
                s_error_count[index] = sat_inc16(s_error_count[index]);
            }
        }
        return;
    }

    const esp_err_t pv[] = {
        telemetry->ina226_calibration_status, telemetry->ina226_shunt_status,
        telemetry->ina226_bus_status, telemetry->ina226_power_status,
        telemetry->ina226_current_status,
    };
    const esp_err_t mppt[] = {
        telemetry->bq25798_reg13_status, telemetry->bq25798_fault_status,
        telemetry->bq25798_adc_status,
    };
    esp_err_t bms[BQ76942_CELL_COUNT + 2];
    memcpy(bms, telemetry->bq76942_cell_status, sizeof(telemetry->bq76942_cell_status));
    bms[BQ76942_CELL_COUNT] = telemetry->bq76942_pack_status;
    bms[BQ76942_CELL_COUNT + 1] = telemetry->bq76942_temp_status;
    const esp_err_t group_status[DEBUG_DEVICE_COUNT] = {
        worst(pv, sizeof(pv) / sizeof(pv[0])),
        worst(bms, sizeof(bms) / sizeof(bms[0])),
        worst(mppt, sizeof(mppt) / sizeof(mppt[0])),
    };

    for (uint32_t index = 0; index < DEBUG_DEVICE_COUNT; index++) {
        if (group_status[index] == ESP_ERR_NOT_FOUND &&
            (s_status[index] == DEBUG_STATUS_TIMEOUT || s_status[index] == DEBUG_STATUS_OTHER)) {
            continue; /* skipped after a failed probe: keep the probe's error code */
        }
        s_status[index] = classify(group_status[index]);
        if (group_status[index] != ESP_OK &&
            group_status[index] != ESP_ERR_NOT_FOUND &&
            group_status[index] != ESP_ERR_NOT_SUPPORTED) {
            s_error_count[index] = sat_inc16(s_error_count[index]);
        }
    }
}

uint8_t debug_mode_device_status(uint32_t device_index)
{
    return device_index < DEBUG_DEVICE_COUNT ? s_status[device_index] : DEBUG_STATUS_UNKNOWN;
}

uint16_t debug_mode_device_error_count(uint32_t device_index)
{
    return device_index < DEBUG_DEVICE_COUNT ? s_error_count[device_index] : 0u;
}

void debug_mode_build_v5_words(
    const debug_link_stats_t *link,
    uint16_t out_words[DEBUG_V5_EXTRA_WORDS])
{
    memset(out_words, 0, DEBUG_V5_EXTRA_WORDS * sizeof(uint16_t));

    const uint32_t read_us = i2c_bus_monitor_last_read_duration_us();
    const uint32_t read_tenths_ms = read_us / 100u;

    out_words[0] = (link == NULL || link->rssi_dbm == INT16_MIN) ? 0x8000u : (uint16_t)link->rssi_dbm;
    out_words[1] = link != NULL ? (uint16_t)(link->uptime_ms >> 16) : 0u;
    out_words[2] = link != NULL ? (uint16_t)(link->uptime_ms & 0xFFFFu) : 0u;
    out_words[3] = link != NULL ? link->tx_errors : 0u;
    out_words[4] = link != NULL ? link->ack_timeouts : 0u;
    out_words[5] = link != NULL ? link->wifi_reconnects : 0u;
    out_words[6] = (uint16_t)((s_enabled ? 0x0001u : 0u) | (DEMO_PRESENCE_DETECTION ? 0x0002u : 0u));
    out_words[7] = (uint16_t)((s_present_mask & 0xFFu) | ((s_probed_mask & 0xFFu) << 8));
    out_words[8] = (uint16_t)s_scan_period_ms;
    out_words[9] = (uint16_t)DEMO_PRESENCE_PROBE_PERIOD_MS;
    out_words[10] = s_error_count[0];
    out_words[11] = s_error_count[1];
    out_words[12] = s_error_count[2];
    out_words[13] = (uint16_t)((s_status[0] & 0xFu) | ((s_status[1] & 0xFu) << 4) | ((s_status[2] & 0xFu) << 8));
    out_words[14] = read_tenths_ms > 0xFFFFu ? 0xFFFFu : (uint16_t)read_tenths_ms;
    out_words[15] = link != NULL ? link->last_ack_rtt_ms : 0xFFFFu;
}

/*
 * v6 Streaming Telemetry words (offsets from word 36). Raw register values; the bridge converts:
 *   0 validity flags (V6_VALID_*)
 *   1 BQ76942 0x36 PACK Pin Voltage (userV, default 10 mV)     0xFFFF when invalid
 *   2 BQ76942 0x68 Int Temperature (0.1 K)                      0xFFFF when invalid
 *   3 BQ25798 REG31 IBUS_ADC (signed, 1 mA)                     0x8000 when invalid
 *   4 BQ25798 REG35 VBUS_ADC (1 mV)                             0xFFFF when invalid
 *   5 BQ25798 REG37 VAC1_ADC (1 mV)                             0xFFFF when invalid
 *   6 BQ25798 REG3B VBAT_ADC (1 mV)                             0xFFFF when invalid
 *   7 BQ25798 REG3D VSYS_ADC (1 mV)                             0xFFFF when invalid
 *   8 BQ25798 REG41 TDIE_ADC (signed, 0.5 degC)                 0x8000 when invalid
 *   9 BQ25798 REG2E ADC_Control readback (low byte)
 *  10 ADC device 1 TEMP_OUT calibrated mV                       0xFFFF when invalid
 *  11 ADC GPIOs: low byte TEMP_OUT GPIO, high byte LIGHT_OUT GPIO (0xFF = unassigned)
 * LIGHT_OUT mV/relative level stay in v4 words 18/19.
 */
void debug_mode_build_v6_words(
    const power_telemetry_t *telemetry,
    uint16_t out_words[DEBUG_V6_EXTRA_WORDS])
{
    uint16_t flags = 0u;
    for (size_t i = 1; i < DEBUG_V6_EXTRA_WORDS - 1u; i++) {
        out_words[i] = 0xFFFFu;
    }
    out_words[3] = 0x8000u;
    out_words[8] = 0x8000u;
    out_words[9] = 0u;

    if (telemetry != NULL) {
        if (telemetry->bq76942_pack_status == ESP_OK) {
            flags |= V6_VALID_BMS_PACK;
            out_words[1] = (uint16_t)(telemetry->bq76942_pack_voltage[0] |
                                      ((uint16_t)telemetry->bq76942_pack_voltage[1] << 8));
        }
        if (telemetry->bq76942_temp_status == ESP_OK) {
            flags |= V6_VALID_BMS_TEMP;
            out_words[2] = (uint16_t)(telemetry->bq76942_int_temp[0] |
                                      ((uint16_t)telemetry->bq76942_int_temp[1] << 8));
        }
        const bool adc_ok = telemetry->bq25798_adc_status == ESP_OK;
        const bool adc_running = telemetry->bq25798_adc_control_status == ESP_OK &&
                                 (telemetry->bq25798_adc_control & BQ25798_ADC_EN_BIT) != 0u;
        if (telemetry->bq25798_adc_control_status == ESP_OK) {
            flags |= V6_VALID_MPPT_ADC_CTRL;
            out_words[9] = telemetry->bq25798_adc_control;
        }
        if (adc_ok && adc_running) {
            static const struct { bq25798_adc_word_t w; uint8_t slot; uint16_t flag; } k_map[] = {
                { BQ25798_ADC_IBUS, 3, V6_VALID_MPPT_IBUS },
                { BQ25798_ADC_VBUS, 4, V6_VALID_MPPT_VBUS },
                { BQ25798_ADC_VAC1, 5, V6_VALID_MPPT_VAC1 },
                { BQ25798_ADC_VBAT, 6, V6_VALID_MPPT_VBAT },
                { BQ25798_ADC_VSYS, 7, V6_VALID_MPPT_VSYS },
                { BQ25798_ADC_TDIE, 8, V6_VALID_MPPT_TDIE },
            };
            for (size_t i = 0; i < sizeof(k_map) / sizeof(k_map[0]); i++) {
                out_words[k_map[i].slot] = i2c_bq25798_adc_word(telemetry, k_map[i].w);
                flags |= k_map[i].flag;
            }
        }
    }

    peripheral_sensor_sample_t sample;
    peripheral_sensors_get_last(&sample);
    if (sample.temperature_valid && sample.temperature_voltage_mv >= 0) {
        flags |= V6_VALID_ADC_TEMP_MV;
        out_words[10] = (uint16_t)sample.temperature_voltage_mv;
    }
    if (sample.light_valid) {
        flags |= V6_VALID_ADC_LIGHT_MV;
    }
    const int tg = peripheral_sensors_temp_gpio();
    const int lg = peripheral_sensors_light_gpio();
    out_words[11] = (uint16_t)(((tg < 0 || tg > 0xFE) ? 0xFFu : (uint16_t)tg) |
                               (((lg < 0 || lg > 0xFE) ? 0xFFu : (uint16_t)lg) << 8));
    out_words[0] = flags;
}
