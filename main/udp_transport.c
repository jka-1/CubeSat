#include "udp_transport.h"

#include <errno.h>
#include <inttypes.h>
#include <math.h>
#include <netdb.h>
#include <stdbool.h>
#include <stdlib.h>
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

static int16_t clamp_int16_from_float(
    float value
)
{
    if (!isfinite(value)) {
        return 0;
    }

    if (value > 32767.0f) {
        value = 32767.0f;
    } else if (value < -32768.0f) {
        value = -32768.0f;
    }

    return (int16_t)lroundf(value);
}

static uint16_t clamp_uint16_from_float(
    float value
)
{
    if (!isfinite(value) || value < 0.0f) {
        return 0u;
    }

    if (value > 65535.0f) {
        value = 65535.0f;
    }

    return (uint16_t)lroundf(value);
}

static uint16_t encode_mcu_temperature(
    float temperature_c
)
{
    return (uint16_t)clamp_int16_from_float(
        temperature_c * 100.0f
    );
}

static uint16_t encode_centi_millivolts(
    float shunt_voltage_mv
)
{
    return (uint16_t)clamp_int16_from_float(
        shunt_voltage_mv * 100.0f
    );
}

static uint16_t encode_milliamps(
    float current_a
)
{
    return (uint16_t)clamp_int16_from_float(
        current_a * 1000.0f
    );
}

static uint16_t encode_centi_watts(
    float power_w
)
{
    return clamp_uint16_from_float(
        power_w * 100.0f
    );
}

static uint16_t next_sequence_word(
    udp_transport_t *transport
)
{
    uint16_t sequence = (uint16_t)(
        transport->next_sequence & 0xFFFFu
    );

    transport->next_sequence += 1u;

    if (sequence == 0u) {
        sequence = (uint16_t)(
            transport->next_sequence & 0xFFFFu
        );
        transport->next_sequence += 1u;
    }

    return sequence;
}

static char *build_telemetry_hex_packet(
    const telemetry_sample_t *sample,
    uint16_t sequence)
{
    const uint16_t words[TELEMETRY_PACKET_WORD_COUNT] = {
        TELEMETRY_PACKET_MAGIC,
        TELEMETRY_PACKET_VERSION,
        sequence,
        encode_mcu_temperature(
            sample->mcu_temperature_c
        ),
        encode_centi_millivolts(
            sample->pv_shunt_voltage_mv
        ),
        encode_centi_watts(
            sample->pv_power_w
        ),
        encode_milliamps(
            sample->pv_current_a
        ),
        sample->mppt_switch_enabled ? 1u : 0u,
        sample->mppt_fault_mask,
        clamp_uint16_from_float(
            sample->bms_cell_voltages_v[0] * 1000.0f
        ),
        clamp_uint16_from_float(
            sample->bms_cell_voltages_v[1] * 1000.0f
        ),
        clamp_uint16_from_float(
            sample->bms_cell_voltages_v[2] * 1000.0f
        ),
        clamp_uint16_from_float(
            sample->bms_cell_voltages_v[3] * 1000.0f
        ),
        encode_centi_millivolts(
            sample->load_shunt_voltage_mv
        ),
        encode_centi_watts(
            sample->load_power_w
        ),
        encode_milliamps(
            sample->load_current_a
        )
    };

    char *serialized = malloc(
        TELEMETRY_PACKET_HEX_CHARS + 1u
    );

    if (serialized == NULL) {
        return NULL;
    }

    size_t offset = 0u;

    for (size_t i = 0; i < TELEMETRY_PACKET_WORD_COUNT; ++i) {
        offset += (size_t)snprintf(
            serialized + offset,
            (TELEMETRY_PACKET_HEX_CHARS + 1u) - offset,
            "%04X",
            words[i]
        );
    }

    serialized[TELEMETRY_PACKET_HEX_CHARS] = '\0';
    return serialized;
}

static esp_err_t validate_ack(
    const char *ack_text,
    uint16_t expected_sequence)
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
        (uint16_t)sequence->valuedouble == expected_sequence;

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

    const uint16_t sequence = next_sequence_word(
        transport
    );

    char *payload = build_telemetry_hex_packet(
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

    free(payload);
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
                (uint32_t)sequence);
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
            (uint32_t)sequence,
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
        (uint32_t)sequence,
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
