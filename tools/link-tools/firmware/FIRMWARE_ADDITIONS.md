# Proposed minimal firmware additions (NOT compiled — no ESP-IDF on the analysis box)

Goal: put link-health data on the wire so the droplet can correlate loss/latency with RSSI, reboots,
and transmit/ACK failures. Gated by `DEMO_LINK_STATS_V5` so a stock bridge (which rejects any
version other than 1–4 / lengths other than 16/20 words) keeps working until
`patches/bridge-udp-tap-and-v5.patch` is deployed.

v5 packet = the 20 v4 words (version word = 0x0005) + 6 words:

| word | field | notes |
|---|---|---|
| 21 | rssi_dbm (int16) | `esp_wifi_sta_get_ap_info().rssi`; 0x8000 = unavailable |
| 22–23 | uptime_ms hi/lo (uint32) | `esp_timer_get_time()/1000` at build time = tx timestamp; wraps ~49.7 days |
| 24 | tx_errors | `sendto()` failures + DNS failures (saturating) |
| 25 | ack_timeouts | `ESP_ERR_TIMEOUT` waiting for bridge ACK (saturating) |
| 26 | wifi_reconnects | STA_DISCONNECTED events since boot (saturating) |

## 1. `main/app_config.h`
```c
/* Link characterization: append RSSI/uptime/error counters (packet v5).
 * Requires the bridge v5 patch. Leave 0 for the stock bridge. */
#define DEMO_LINK_STATS_V5           0
```

## 2. `main/wifi_station.h` / `wifi_station.c` — reconnect counter
```c
/* wifi_station.h */
uint32_t wifi_station_reconnect_count(void);
```
```c
/* wifi_station.c — near s_retry_count */
static volatile uint32_t s_disconnect_count;

/* inside the WIFI_EVENT_STA_DISCONNECTED branch, before the retry check */
const wifi_event_sta_disconnected_t *disc =
    (const wifi_event_sta_disconnected_t *)event_data;
++s_disconnect_count;
ESP_LOGW(TAG, "Wi-Fi disconnected reason=%d rssi=%d",
         disc != NULL ? disc->reason : -1,
         disc != NULL ? disc->rssi : 0);

uint32_t wifi_station_reconnect_count(void)
{
    return s_disconnect_count;
}
```
(Note: `wifi_event_handler` currently casts `(void)event_data;` at the top — remove that line or keep it; it is harmless.)

**Separate behavior fix to consider (affects the reconnect-time test):** after 10 failed
`esp_wifi_connect()` attempts the handler only logs "Wi-Fi reconnect limit reached" and never retries
again; `s_retry_count` only resets on `IP_EVENT_STA_GOT_IP`. An AP outage longer than ~10 quick
attempts therefore leaves the board offline until reset. Suggested: replace the hard stop with a
back-off timer (e.g. `esp_timer_start_once` → `esp_wifi_connect()` every 5 s) so reconnect time is
measurable and bounded.

## 3. `main/udp_transport.h` — counters in the transport
```c
typedef struct {
    int socket_fd;
    uint32_t next_sequence;
    char server_host[128];
    uint16_t server_port;
    char device_id[48];
    uint16_t tx_errors;      /* new */
    uint16_t ack_timeouts;   /* new */
} udp_transport_t;
```
Counters live in the struct; `udp_transport_init()` memsets it, so they reset only at boot
(`udp_transport_close()` doesn't touch them).

## 4. `main/udp_transport.c`
Includes:
```c
#include "esp_wifi.h"
#include "wifi_station.h"
```
Helper:
```c
static inline uint16_t sat_inc16(uint16_t v) { return v == 0xFFFFu ? v : (uint16_t)(v + 1u); }

#if DEMO_LINK_STATS_V5
#define LINK_STATS_EXTRA_WORDS 6u
static void append_link_stats_hex(const udp_transport_t *t, char *hex, size_t hex_size)
{
    wifi_ap_record_t ap = {0};
    uint16_t rssi_word = 0x8000u;
    if (esp_wifi_sta_get_ap_info(&ap) == ESP_OK) {
        rssi_word = (uint16_t)(int16_t)ap.rssi;
    }
    const uint32_t uptime_ms = (uint32_t)(esp_timer_get_time() / 1000);
    const uint32_t reconnects = wifi_station_reconnect_count();

    /* version word is chars 4..7 */
    memcpy(&hex[4], "0005", 4);
    const size_t base = TELEMETRY_PACKET_V4_HEX_CHARS;
    snprintf(&hex[base], hex_size - base, "%04X%04X%04X%04X%04X%04X",
             rssi_word,
             (unsigned)(uptime_ms >> 16), (unsigned)(uptime_ms & 0xFFFFu),
             t->tx_errors, t->ack_timeouts,
             (unsigned)(reconnects > 0xFFFFu ? 0xFFFFu : reconnects));
}
#else
#define LINK_STATS_EXTRA_WORDS 0u
#endif
```
In `build_telemetry_hex_packet()` — signature gains the transport (`const udp_transport_t *transport`)
and the allocation grows:
```c
    const size_t hex_size = TELEMETRY_PACKET_V4_HEX_CHARS + (LINK_STATS_EXTRA_WORDS * 4u) + 1u;
    char *serialized = malloc(hex_size);                       /* was TELEMETRY_PACKET_V4_HEX_CHARS + 1u */
    /* existing call, last arg changed to hex_size: */
    const esp_err_t status = telemetry_packet_v4_format_hex(telemetry, &packet_meta, serialized, hex_size);
    if (status != ESP_OK) { free(serialized); return NULL; }
#if DEMO_LINK_STATS_V5
    append_link_stats_hex(transport, serialized, hex_size);
#endif
    return serialized;
```
(The existing malloc/format are at udp_transport.c lines 330–343; the caller at line 1200 must pass `transport`.)

Count errors in `udp_transport_send_power_telemetry()`:
```c
    /* getaddrinfo failure branches */
    transport->tx_errors = sat_inc16(transport->tx_errors);
    return ESP_ERR_NOT_FOUND;

    /* sendto() < 0 branch (line ~1229) */
    transport->tx_errors = sat_inc16(transport->tx_errors);

    /* EAGAIN/EWOULDBLOCK ACK-timeout branch (line ~1248) */
    transport->ack_timeouts = sat_inc16(transport->ack_timeouts);
```

## 5. Optional: report the firmware-measured ACK RTT on the wire
`main.c` already logs `rtt=%ums` (the time from `sendto` to the bridge ACK, measured on the MCU) only on
the serial console. With v5 you could replace `wifi_reconnects` or add a 27th word holding the
previous cycle's ACK RTT, so the droplet sees MCU-side RTT without a serial cable. Not included above
to keep the format small; decide before freezing v5.

## 6. Optional packet-rate knob for the rate sweep
`DEMO_STREAM_PERIOD_MS` (app_config.h) already sets the cadence (default 1000). For the rate sweep,
flash 1000 / 500 / 200 / 100 ms builds. Note the loop is stop-and-wait: each cycle does I2C reads,
then `sendto`, then blocks up to `DEMO_ACK_TIMEOUT_MS` (250 ms) for the ACK, then polls commands
until the deadline. Below ~300 ms period, ACK waits and I2C time can eat the whole cycle, so the
real rate can fall short of the target. That effect is something the sweep should measure.
