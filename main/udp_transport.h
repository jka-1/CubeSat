#pragma once

#include <stdint.h>

#include "esp_err.h"
#include "telemetry_types.h"

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

esp_err_t udp_transport_send_sample(
    udp_transport_t *transport,
    const telemetry_sample_t *sample,
    uint32_t *out_sequence,
    uint32_t *out_round_trip_ms);

void udp_transport_close(udp_transport_t *transport);
