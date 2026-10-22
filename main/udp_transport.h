#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "i2c_bus_monitor.h"
#include "telemetry_packet_v4.h"

typedef struct {
    int socket_fd;
    uint32_t next_sequence;
    char server_host[128];
    uint16_t server_port;
    char device_id[48];
    /* Link statistics (reset only at boot by udp_transport_init). */
    uint16_t tx_errors;
    uint16_t ack_timeouts;
    uint16_t last_ack_rtt_ms;   /* 0xFFFF when the last ACK timed out */
} udp_transport_t;

esp_err_t udp_transport_init(
    udp_transport_t *transport,
    const char *server_host,
    uint16_t server_port,
    const char *device_id);

esp_err_t udp_transport_send_power_telemetry(
    udp_transport_t *transport,
    const power_telemetry_t *telemetry,
    const telemetry_packet_v4_meta_t *meta,
    uint32_t *out_sequence,
    uint32_t *out_round_trip_ms);

esp_err_t udp_transport_poll_command(
    udp_transport_t *transport,
    uint32_t wait_ms,
    bool *out_handled);

void udp_transport_close(udp_transport_t *transport);

/* Blocking ACK wait used by udp_transport_send_power_telemetry():
 * min(DEMO_ACK_TIMEOUT_MS, scan period / 4). */
uint32_t udp_transport_ack_timeout_ms(void);
