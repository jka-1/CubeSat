#include "udp_transport.h"

#include <errno.h>
#include <inttypes.h>
#include <netdb.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include "app_config.h"
#include "cJSON.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "udp_transport";

static esp_err_t open_udp_socket(
    udp_transport_t *transport,
    struct addrinfo **out_destination)
{
    char port_text[8] = {0};
    snprintf(
        port_text,
        sizeof(port_text),
        "%u",
        (unsigned int)transport->server_port);

    const struct addrinfo hints = {
        .ai_family = AF_INET,
        .ai_socktype = SOCK_DGRAM,
        .ai_protocol = IPPROTO_IP,
    };

    struct addrinfo *destination = NULL;
    const int dns_result = getaddrinfo(
        transport->server_host,
        port_text,
        &hints,
        &destination);

    if (dns_result != 0 || destination == NULL) {
        ESP_LOGE(
            TAG,
            "Could not resolve %s:%s",
            transport->server_host,
            port_text);
        return ESP_ERR_NOT_FOUND;
    }

    transport->socket_fd = socket(
        destination->ai_family,
        destination->ai_socktype,
        destination->ai_protocol);

    if (transport->socket_fd < 0) {
        ESP_LOGE(TAG, "socket() failed: errno=%d", errno);
        freeaddrinfo(destination);
        return ESP_FAIL;
    }

    const struct timeval receive_timeout = {
        .tv_sec = DEMO_ACK_TIMEOUT_MS / 1000,
        .tv_usec = (DEMO_ACK_TIMEOUT_MS % 1000) * 1000,
    };

    if (setsockopt(
            transport->socket_fd,
            SOL_SOCKET,
            SO_RCVTIMEO,
            &receive_timeout,
            sizeof(receive_timeout)) != 0) {
        ESP_LOGW(TAG, "Could not apply receive timeout");
    }

    *out_destination = destination;
    return ESP_OK;
}

static char *build_telemetry_json(
    const udp_transport_t *transport,
    const telemetry_sample_t *sample,
    uint32_t sequence)
{
    cJSON *root = cJSON_CreateObject();
    cJSON *telemetry = cJSON_CreateObject();

    if (root == NULL || telemetry == NULL) {
        cJSON_Delete(root);
        cJSON_Delete(telemetry);
        return NULL;
    }

    cJSON_AddNumberToObject(root, "version", 1);
    cJSON_AddStringToObject(root, "type", "telemetry");
    cJSON_AddStringToObject(root, "device_id", transport->device_id);
    cJSON_AddNumberToObject(root, "seq", sequence);
    cJSON_AddNumberToObject(
        root,
        "device_uptime_ms",
        (double)sample->device_uptime_ms);
    cJSON_AddNumberToObject(
        root,
        "sample_counter",
        sample->sample_counter);

    cJSON_AddNumberToObject(
        telemetry,
        "solar_panel_current_a",
        sample->solar_panel_current_a);
    cJSON_AddNumberToObject(
        telemetry,
        "battery_voltage_v",
        sample->battery_voltage_v);
    cJSON_AddNumberToObject(
        telemetry,
        "mppt_switch_temperature_c",
        sample->mppt_switch_temperature_c);
    cJSON_AddNumberToObject(
        telemetry,
        "esp32_temperature_c",
        sample->esp32_temperature_c);

    cJSON_AddItemToObject(root, "telemetry", telemetry);

    char *serialized = cJSON_PrintUnformatted(root);
    cJSON_Delete(root);
    return serialized;
}

static esp_err_t validate_ack(
    const char *ack_text,
    uint32_t expected_sequence)
{
    cJSON *root = cJSON_Parse(ack_text);
    if (root == NULL) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    const cJSON *type = cJSON_GetObjectItemCaseSensitive(root, "type");
    const cJSON *sequence = cJSON_GetObjectItemCaseSensitive(root, "seq");

    const bool valid =
        cJSON_IsString(type) &&
        strcmp(type->valuestring, "ack") == 0 &&
        cJSON_IsNumber(sequence) &&
        (uint32_t)sequence->valuedouble == expected_sequence;

    cJSON_Delete(root);
    return valid ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
}

esp_err_t udp_transport_init(
    udp_transport_t *transport,
    const char *server_host,
    uint16_t server_port,
    const char *device_id)
{
    if (transport == NULL ||
        server_host == NULL ||
        device_id == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    memset(transport, 0, sizeof(*transport));
    transport->socket_fd = -1;
    transport->server_port = server_port;
    transport->next_sequence = 1;

    strlcpy(
        transport->server_host,
        server_host,
        sizeof(transport->server_host));

    strlcpy(
        transport->device_id,
        device_id,
        sizeof(transport->device_id));

    return ESP_OK;
}

esp_err_t udp_transport_send_sample(
    udp_transport_t *transport,
    const telemetry_sample_t *sample,
    uint32_t *out_sequence,
    uint32_t *out_round_trip_ms)
{
    if (transport == NULL || sample == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    struct addrinfo *destination = NULL;

    if (transport->socket_fd < 0) {
        esp_err_t err = open_udp_socket(transport, &destination);
        if (err != ESP_OK) {
            return err;
        }
    } else {
        char port_text[8] = {0};
        snprintf(
            port_text,
            sizeof(port_text),
            "%u",
            (unsigned int)transport->server_port);

        const struct addrinfo hints = {
            .ai_family = AF_INET,
            .ai_socktype = SOCK_DGRAM,
            .ai_protocol = IPPROTO_IP,
        };

        if (getaddrinfo(
                transport->server_host,
                port_text,
                &hints,
                &destination) != 0 ||
            destination == NULL) {
            return ESP_ERR_NOT_FOUND;
        }
    }

    const uint32_t sequence = transport->next_sequence++;
    char *payload = build_telemetry_json(
        transport,
        sample,
        sequence);

    if (payload == NULL) {
        freeaddrinfo(destination);
        return ESP_ERR_NO_MEM;
    }

    const int64_t send_start_ms = esp_timer_get_time() / 1000;

    const ssize_t bytes_sent = sendto(
        transport->socket_fd,
        payload,
        strlen(payload),
        0,
        destination->ai_addr,
        destination->ai_addrlen);

    cJSON_free(payload);
    freeaddrinfo(destination);

    if (bytes_sent < 0) {
        ESP_LOGE(TAG, "sendto() failed: errno=%d", errno);
        udp_transport_close(transport);
        return ESP_FAIL;
    }

    char ack_buffer[256] = {0};
    const ssize_t received_length = recvfrom(
        transport->socket_fd,
        ack_buffer,
        sizeof(ack_buffer) - 1,
        0,
        NULL,
        NULL);

    if (received_length < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            ESP_LOGW(
                TAG,
                "ACK timeout for sequence %" PRIu32,
                sequence);
            return ESP_ERR_TIMEOUT;
        }

        ESP_LOGE(TAG, "recvfrom() failed: errno=%d", errno);
        udp_transport_close(transport);
        return ESP_FAIL;
    }

    ack_buffer[received_length] = '\0';

    esp_err_t ack_result = validate_ack(
        ack_buffer,
        sequence);

    if (ack_result != ESP_OK) {
        ESP_LOGW(
            TAG,
            "Invalid ACK for sequence %" PRIu32 ": %s",
            sequence,
            ack_buffer);
        return ack_result;
    }

    const int64_t receive_end_ms = esp_timer_get_time() / 1000;
    const uint32_t round_trip_ms =
        (uint32_t)(receive_end_ms - send_start_ms);

    if (out_sequence != NULL) {
        *out_sequence = sequence;
    }

    if (out_round_trip_ms != NULL) {
        *out_round_trip_ms = round_trip_ms;
    }

    ESP_LOGI(
        TAG,
        "ACK sequence=%" PRIu32 " RTT=%" PRIu32 " ms",
        sequence,
        round_trip_ms);

    return ESP_OK;
}

void udp_transport_close(udp_transport_t *transport)
{
    if (transport == NULL) {
        return;
    }

    if (transport->socket_fd >= 0) {
        shutdown(transport->socket_fd, SHUT_RDWR);
        close(transport->socket_fd);
        transport->socket_fd = -1;
    }
}
