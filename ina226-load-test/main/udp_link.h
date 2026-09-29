#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"
#include "lwip/sockets.h"

typedef struct {
    int socket_fd;
    struct sockaddr_in server_address;
    bool require_server_port;
} udp_link_t;

esp_err_t udp_link_open(
    udp_link_t *link,
    const char *server_host,
    uint16_t server_port,
    uint16_t local_port,
    bool require_server_port);

esp_err_t udp_link_send(
    const udp_link_t *link,
    const void *payload,
    size_t payload_length);

esp_err_t udp_link_receive(
    const udp_link_t *link,
    void *payload,
    size_t payload_capacity,
    int timeout_ms,
    size_t *payload_length);
