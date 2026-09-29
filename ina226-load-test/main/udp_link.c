#include "udp_link.h"

#include <errno.h>
#include <string.h>

#include "esp_log.h"
#include "lwip/netdb.h"

static const char *TAG = "udp_link";

esp_err_t udp_link_open(
    udp_link_t *link,
    const char *server_host,
    uint16_t server_port,
    uint16_t local_port,
    bool require_server_port)
{
    if (link == NULL || server_host == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(link, 0, sizeof(*link));
    link->socket_fd = -1;

    struct addrinfo hints = {
        .ai_family = AF_INET,
        .ai_socktype = SOCK_DGRAM,
    };
    struct addrinfo *result = NULL;

    const int lookup_status = getaddrinfo(
        server_host,
        NULL,
        &hints,
        &result);
    if (lookup_status != 0 || result == NULL) {
        ESP_LOGE(TAG, "Unable to resolve bridge host %s", server_host);
        return ESP_ERR_NOT_FOUND;
    }

    link->server_address = *(struct sockaddr_in *)result->ai_addr;
    link->server_address.sin_port = htons(server_port);
    link->require_server_port = require_server_port;
    freeaddrinfo(result);

    link->socket_fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (link->socket_fd < 0) {
        ESP_LOGE(TAG, "socket failed: errno %d", errno);
        return ESP_FAIL;
    }

    const struct sockaddr_in local_address = {
        .sin_family = AF_INET,
        .sin_port = htons(local_port),
        .sin_addr.s_addr = htonl(INADDR_ANY),
    };

    if (bind(
            link->socket_fd,
            (const struct sockaddr *)&local_address,
            sizeof(local_address)) != 0) {
        ESP_LOGE(TAG, "bind failed: errno %d", errno);
        close(link->socket_fd);
        link->socket_fd = -1;
        return ESP_FAIL;
    }

    ESP_LOGI(
        TAG,
        "UDP ready: local :%u, bridge %s:%u",
        (unsigned int)local_port,
        server_host,
        (unsigned int)server_port);
    return ESP_OK;
}

esp_err_t udp_link_send(
    const udp_link_t *link,
    const void *payload,
    size_t payload_length)
{
    if (link == NULL || link->socket_fd < 0 ||
        payload == NULL || payload_length == 0) {
        return ESP_ERR_INVALID_ARG;
    }

    const ssize_t sent = sendto(
        link->socket_fd,
        payload,
        payload_length,
        0,
        (const struct sockaddr *)&link->server_address,
        sizeof(link->server_address));

    return sent == (ssize_t)payload_length ? ESP_OK : ESP_FAIL;
}

esp_err_t udp_link_receive(
    const udp_link_t *link,
    void *payload,
    size_t payload_capacity,
    int timeout_ms,
    size_t *payload_length)
{
    if (link == NULL || link->socket_fd < 0 || payload == NULL ||
        payload_capacity == 0 || timeout_ms < 0 || payload_length == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    fd_set read_fds;
    FD_ZERO(&read_fds);
    FD_SET(link->socket_fd, &read_fds);

    struct timeval timeout = {
        .tv_sec = timeout_ms / 1000,
        .tv_usec = (timeout_ms % 1000) * 1000,
    };

    const int ready = select(
        link->socket_fd + 1,
        &read_fds,
        NULL,
        NULL,
        &timeout);

    if (ready == 0) {
        return ESP_ERR_TIMEOUT;
    }
    if (ready < 0) {
        return errno == EINTR ? ESP_ERR_TIMEOUT : ESP_FAIL;
    }

    struct sockaddr_in source_address = {0};
    socklen_t source_length = sizeof(source_address);
    const ssize_t received = recvfrom(
        link->socket_fd,
        payload,
        payload_capacity,
        0,
        (struct sockaddr *)&source_address,
        &source_length);

    if (received <= 0) {
        return ESP_FAIL;
    }

    const bool address_matches =
        source_address.sin_addr.s_addr ==
        link->server_address.sin_addr.s_addr;
    const bool port_matches =
        source_address.sin_port == link->server_address.sin_port;

    if (!address_matches || (link->require_server_port && !port_matches)) {
        ESP_LOGW(TAG, "Ignored UDP datagram from an untrusted source");
        return ESP_ERR_INVALID_RESPONSE;
    }

    *payload_length = (size_t)received;
    return ESP_OK;
}
