#pragma once

/*
 * Wireless debug mode: per-device presence detection, per-device read
 * accounting, a runtime-configurable scan period, and the v5 debug packet
 * extension (link statistics + device status) appended to the v4 words.
 */

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "i2c_bus_monitor.h"

#ifdef __cplusplus
extern "C" {
#endif

#define DEBUG_DEVICE_COUNT            3u   /* index 0 = PV INA226, 1 = BMS BQ76942, 2 = MPPT BQ25798 */
#define DEBUG_V5_EXTRA_WORDS          16u  /* words 20..35 of the v5 packet */
#define DEBUG_V6_EXTRA_WORDS          12u  /* words 36..47 of the v6 packet (Streaming Telemetry) */

/* v6 word 36 validity flags: a cleared bit means the value word is a sentinel, not data. */
#define V6_VALID_BMS_PACK             (1u << 0)
#define V6_VALID_BMS_TEMP             (1u << 1)
#define V6_VALID_MPPT_IBUS            (1u << 2)
#define V6_VALID_MPPT_VBUS            (1u << 3)
#define V6_VALID_MPPT_VAC1            (1u << 4)
#define V6_VALID_MPPT_VBAT            (1u << 5)
#define V6_VALID_MPPT_VSYS            (1u << 6)
#define V6_VALID_MPPT_TDIE            (1u << 7)
#define V6_VALID_MPPT_ADC_CTRL        (1u << 8)
#define V6_VALID_ADC_TEMP_MV          (1u << 9)
#define V6_VALID_ADC_LIGHT_MV         (1u << 10)

/* 4-bit per-device status codes carried in v5 word 33 */
#define DEBUG_STATUS_OK               0x0u
#define DEBUG_STATUS_ABSENT           0x1u /* probe NACK: reads skipped */
#define DEBUG_STATUS_NACK             0x2u /* present but a read failed */
#define DEBUG_STATUS_TIMEOUT          0x3u
#define DEBUG_STATUS_PAUSED           0x4u /* automatic polling paused by sensor_control */
#define DEBUG_STATUS_OTHER            0x5u
#define DEBUG_STATUS_UNKNOWN          0xFu /* not probed / not read yet */

typedef struct {
    int16_t rssi_dbm;          /* INT16_MIN when unavailable */
    uint32_t uptime_ms;
    uint16_t tx_errors;
    uint16_t ack_timeouts;
    uint16_t wifi_reconnects;
    uint16_t last_ack_rtt_ms;  /* 0xFFFF when the last ACK timed out */
} debug_link_stats_t;

esp_err_t debug_mode_init(void);

bool debug_mode_is_enabled(void);
void debug_mode_set_enabled(bool enabled);
/* Apply the Wi-Fi power-save mode for the current state (call after esp_wifi_start). */
void debug_mode_apply_power_save(void);

uint32_t debug_mode_scan_period_ms(void);
/* Clamps to [DEMO_SCAN_PERIOD_MIN_MS, DEMO_SCAN_PERIOD_MAX_MS]; returns the applied value. */
uint32_t debug_mode_set_scan_period_ms(uint32_t period_ms);
uint32_t debug_mode_probe_period_ms(void);

/* Probe the three known addresses and update the present mask used by
 * i2c_bus_monitor_read_all(). Runs when forced or when the probe period elapsed. */
void debug_mode_probe_devices(bool force);
uint32_t debug_mode_present_mask(void);
uint32_t debug_mode_probed_mask(void);

/* Record the per-device outcome of one i2c_bus_monitor_read_all() call. */
void debug_mode_account_read(const power_telemetry_t *telemetry, esp_err_t read_all_status);

uint8_t debug_mode_device_status(uint32_t device_index);
uint16_t debug_mode_device_error_count(uint32_t device_index);

/* Fill the DEBUG_V5_EXTRA_WORDS words that follow the 20 v4 words. */
void debug_mode_build_v5_words(
    const debug_link_stats_t *link,
    uint16_t out_words[DEBUG_V5_EXTRA_WORDS]);

/* Fill the DEBUG_V6_EXTRA_WORDS words that follow the 36 v5 words. */
void debug_mode_build_v6_words(
    const power_telemetry_t *telemetry,
    uint16_t out_words[DEBUG_V6_EXTRA_WORDS]);

#ifdef __cplusplus
}
#endif
