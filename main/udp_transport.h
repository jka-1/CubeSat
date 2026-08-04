#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "i2c_bus_monitor.h"
#include "telemetry_packet_v3.h"

typedef struct {
    int socket_fd;
    uint32_t next_sequence;
    char server_host[128];
    uint16_t server_port;
    char device_id[48];
} udp_transport_t;

esp_err_t udp_transport_init(
    udp_transport_t *transport,
    const char *server_host,
    uint16_t server_port,
    const char *device_id);

esp_err_t udp_transport_send_power_telemetry(
    udp_transport_t *transport,
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    uint32_t *out_sequence,
    uint32_t *out_round_trip_ms);

esp_err_t udp_transport_poll_command(
    udp_transport_t *transport,
    uint32_t wait_ms,
    bool *out_handled);

void udp_transport_close(udp_transport_t *transport);
