#include "udp_transport.h"

#include <errno.h>
#include <inttypes.h>
#include <netdb.h>
#include <stdbool.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <strings.h>
#include <sys/socket.h>
#include <sys/time.h>
#include <unistd.h>

#include "app_config.h"
#include "cJSON.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "udp_transport";

#define MAX_COMMAND_BYTES            256
#define MAX_I2C_COMMAND_DATA_LENGTH  32

static esp_err_t set_socket_receive_timeout(
    int socket_fd,
    uint32_t timeout_ms)
{
    const struct timeval timeout = {
        .tv_sec = timeout_ms / 1000u,
        .tv_usec = (timeout_ms % 1000u) * 1000u,
    };

    if (setsockopt(
            socket_fd,
            SOL_SOCKET,
            SO_RCVTIMEO,
            &timeout,
            sizeof(timeout)) != 0) {
        ESP_LOGW(TAG, "Could not apply receive timeout");
        return ESP_FAIL;
    }

    return ESP_OK;
}

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

    *out_destination = destination;
    return ESP_OK;
}

static uint16_t next_sequence_word(
    udp_transport_t *transport)
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
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    uint16_t sequence)
{
    telemetry_packet_v3_meta_t packet_meta = {
        .sequence = sequence,
        .has_mcu_temperature = false,
        .mcu_temperature_centi_c = 0
    };

    if (meta != NULL) {
        packet_meta.has_mcu_temperature =
            meta->has_mcu_temperature;
        packet_meta.mcu_temperature_centi_c =
            meta->mcu_temperature_centi_c;
    }

    char *serialized = malloc(
        TELEMETRY_PACKET_V3_HEX_CHARS + 1u
    );

    if (serialized == NULL) {
        return NULL;
    }

    const esp_err_t status =
        telemetry_packet_v3_format_hex(
            telemetry,
            &packet_meta,
            serialized,
            TELEMETRY_PACKET_V3_HEX_CHARS + 1u);

    if (status != ESP_OK) {
        free(serialized);
        return NULL;
    }

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

    const cJSON *type =
        cJSON_GetObjectItemCaseSensitive(root, "type");
    const cJSON *sequence =
        cJSON_GetObjectItemCaseSensitive(root, "seq");

    const bool valid =
        cJSON_IsString(type) &&
        strcmp(type->valuestring, "ack") == 0 &&
        cJSON_IsNumber(sequence) &&
        (uint16_t)sequence->valuedouble == expected_sequence;

    cJSON_Delete(root);
    return valid ? ESP_OK : ESP_ERR_INVALID_RESPONSE;
}

static bool parse_u32_text(
    const char *text,
    uint32_t maximum,
    uint32_t *out_value)
{
    if (text == NULL || out_value == NULL) {
        return false;
    }

    errno = 0;
    char *end = NULL;
    const unsigned long value = strtoul(text, &end, 0);

    if (errno != 0 ||
        end == text ||
        end == NULL ||
        *end != '\0' ||
        value > maximum) {
        return false;
    }

    *out_value = (uint32_t)value;
    return true;
}

static bool parse_u32_json(
    const cJSON *item,
    uint32_t maximum,
    uint32_t *out_value)
{
    if (item == NULL || out_value == NULL) {
        return false;
    }

    if (cJSON_IsNumber(item)) {
        const double value = item->valuedouble;

        if (value < 0.0 || value > (double)maximum) {
            return false;
        }

        *out_value = (uint32_t)value;
        return true;
    }

    if (cJSON_IsString(item) && item->valuestring != NULL) {
        return parse_u32_text(
            item->valuestring,
            maximum,
            out_value);
    }

    return false;
}

static esp_err_t parse_byte_field(
    const cJSON *item,
    const char *field_name,
    uint8_t *out_value)
{
    uint32_t value = 0;

    if (!parse_u32_json(item, 0xFFu, &value)) {
        ESP_LOGW(TAG, "Invalid byte field: %s", field_name);
        return ESP_ERR_INVALID_ARG;
    }

    *out_value = (uint8_t)value;
    return ESP_OK;
}

static esp_err_t parse_length_field(
    const cJSON *item,
    uint8_t *out_length)
{
    uint32_t value = 0;

    if (!parse_u32_json(
            item,
            MAX_I2C_COMMAND_DATA_LENGTH,
            &value) ||
        value == 0u) {
        return ESP_ERR_INVALID_ARG;
    }

    *out_length = (uint8_t)value;
    return ESP_OK;
}

static esp_err_t handle_i2c_write_command(
    const cJSON *root)
{
    const cJSON *addr_item =
        cJSON_GetObjectItemCaseSensitive(root, "addr");
    const cJSON *reg_item =
        cJSON_GetObjectItemCaseSensitive(root, "reg");
    const cJSON *data_item =
        cJSON_GetObjectItemCaseSensitive(root, "data");
    const cJSON *value_item =
        cJSON_GetObjectItemCaseSensitive(root, "value");
    const cJSON *values_item =
        cJSON_GetObjectItemCaseSensitive(root, "values");

    uint8_t address = 0;
    uint8_t register_address = 0;

    ESP_RETURN_ON_ERROR(
        parse_byte_field(addr_item, "addr", &address),
        TAG,
        "Invalid I2C address");

    ESP_RETURN_ON_ERROR(
        parse_byte_field(reg_item, "reg", &register_address),
        TAG,
        "Invalid I2C register");

    uint8_t write_data[MAX_I2C_COMMAND_DATA_LENGTH] = {0};
    size_t write_length = 0u;

    const cJSON *payload_item = data_item;
    if (payload_item == NULL) {
        payload_item = value_item;
    }
    if (payload_item == NULL) {
        payload_item = values_item;
    }

    if (payload_item == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (cJSON_IsArray(payload_item)) {
        const int item_count = cJSON_GetArraySize(payload_item);

        if (item_count < 1 ||
            item_count > MAX_I2C_COMMAND_DATA_LENGTH) {
            return ESP_ERR_INVALID_SIZE;
        }

        for (int index = 0; index < item_count; index++) {
            const cJSON *entry =
                cJSON_GetArrayItem(payload_item, index);

            ESP_RETURN_ON_ERROR(
                parse_byte_field(
                    entry,
                    "data[]",
                    &write_data[index]),
                TAG,
                "Invalid I2C write byte");
        }

        write_length = (size_t)item_count;
    } else {
        ESP_RETURN_ON_ERROR(
            parse_byte_field(
                payload_item,
                "data",
                &write_data[0]),
            TAG,
            "Invalid I2C write byte");

        write_length = 1u;
    }

    const esp_err_t status =
        i2c_bus_write_register(
            address,
            register_address,
            write_data,
            write_length);

    if (status == ESP_OK) {
        ESP_LOGI(
            TAG,
            "Executed i2c_write addr=0x%02X reg=0x%02X bytes=%u",
            address,
            register_address,
            (unsigned int)write_length);
    }

    return status;
}

static esp_err_t handle_i2c_read_command(
    const cJSON *root)
{
    const cJSON *addr_item =
        cJSON_GetObjectItemCaseSensitive(root, "addr");
    const cJSON *reg_item =
        cJSON_GetObjectItemCaseSensitive(root, "reg");
    const cJSON *len_item =
        cJSON_GetObjectItemCaseSensitive(root, "len");
    const cJSON *length_item =
        cJSON_GetObjectItemCaseSensitive(root, "length");

    uint8_t address = 0;
    uint8_t register_address = 0;
    uint8_t read_length = 1u;

    ESP_RETURN_ON_ERROR(
        parse_byte_field(addr_item, "addr", &address),
        TAG,
        "Invalid I2C address");

    ESP_RETURN_ON_ERROR(
        parse_byte_field(reg_item, "reg", &register_address),
        TAG,
        "Invalid I2C register");

    if (len_item != NULL || length_item != NULL) {
        ESP_RETURN_ON_ERROR(
            parse_length_field(
                len_item != NULL ? len_item : length_item,
                &read_length),
            TAG,
            "Invalid I2C read length");
    }

    uint8_t read_data[MAX_I2C_COMMAND_DATA_LENGTH] = {0};

    const esp_err_t status =
        i2c_bus_read_register(
            address,
            register_address,
            read_data,
            read_length);

    if (status != ESP_OK) {
        return status;
    }

    char response_text[
        (MAX_I2C_COMMAND_DATA_LENGTH * 5u) + 1u] = {0};
    size_t offset = 0u;

    for (uint8_t index = 0; index < read_length; index++) {
        offset += (size_t)snprintf(
            response_text + offset,
            sizeof(response_text) - offset,
            index == 0 ? "0x%02X" : " 0x%02X",
            read_data[index]);
    }

    ESP_LOGI(
        TAG,
        "Executed i2c_read addr=0x%02X reg=0x%02X -> %s",
        address,
        register_address,
        response_text);

    return ESP_OK;
}

static esp_err_t handle_legacy_target_state(
    const cJSON *root)
{
    const cJSON *target_item =
        cJSON_GetObjectItemCaseSensitive(root, "target");
    const cJSON *state_item =
        cJSON_GetObjectItemCaseSensitive(root, "state");

    if (!cJSON_IsString(target_item) ||
        !cJSON_IsString(state_item) ||
        target_item->valuestring == NULL ||
        state_item->valuestring == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (strcasecmp(target_item->valuestring, "mppt") != 0) {
        return ESP_ERR_NOT_SUPPORTED;
    }

    uint8_t register_value = 0;

    if (strcasecmp(state_item->valuestring, "on") == 0) {
        register_value = 0x1D;
    } else if (strcasecmp(state_item->valuestring, "off") == 0) {
        register_value = 0x2D;
    } else {
        return ESP_ERR_INVALID_ARG;
    }

    return i2c_bus_write_register(
        BQ25798_I2C_ADDRESS,
        0x13,
        &register_value,
        sizeof(register_value));
}

static esp_err_t handle_command_payload(
    const char *payload_text,
    bool *out_handled)
{
    if (out_handled != NULL) {
        *out_handled = false;
    }

    cJSON *root = cJSON_Parse(payload_text);
    if (root == NULL) {
        return ESP_ERR_INVALID_RESPONSE;
    }

    const cJSON *type_item =
        cJSON_GetObjectItemCaseSensitive(root, "type");
    esp_err_t status = ESP_ERR_NOT_SUPPORTED;
    bool handled = false;

    if (cJSON_IsString(type_item) &&
        type_item->valuestring != NULL) {
        if (strcmp(type_item->valuestring, "ack") == 0) {
            status = ESP_OK;
            handled = false;
        } else if (strcmp(type_item->valuestring, "i2c_write") == 0) {
            status = handle_i2c_write_command(root);
            handled = true;
        } else if (strcmp(type_item->valuestring, "i2c_read") == 0) {
            status = handle_i2c_read_command(root);
            handled = true;
        }
    } else if (
        cJSON_GetObjectItemCaseSensitive(root, "target") != NULL &&
        cJSON_GetObjectItemCaseSensitive(root, "state") != NULL) {
        status = handle_legacy_target_state(root);
        handled = true;
    }

    cJSON_Delete(root);

    if (out_handled != NULL) {
        *out_handled = handled;
    }

    return status;
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
    transport->next_sequence = 1u;

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

esp_err_t udp_transport_send_power_telemetry(
    udp_transport_t *transport,
    const power_telemetry_t *telemetry,
    const telemetry_packet_v3_meta_t *meta,
    uint32_t *out_sequence,
    uint32_t *out_round_trip_ms)
{
    if (transport == NULL || telemetry == NULL) {
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

    const uint16_t sequence =
        next_sequence_word(transport);

    char *payload = build_telemetry_hex_packet(
        telemetry,
        meta,
        sequence);

    if (payload == NULL) {
        freeaddrinfo(destination);
        return ESP_ERR_NO_MEM;
    }

    ESP_ERROR_CHECK_WITHOUT_ABORT(
        set_socket_receive_timeout(
            transport->socket_fd,
            DEMO_ACK_TIMEOUT_MS));

    const int64_t send_start_ms =
        esp_timer_get_time() / 1000;

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

    char incoming[MAX_COMMAND_BYTES] = {0};

    while (true) {
        const ssize_t received_length = recvfrom(
            transport->socket_fd,
            incoming,
            sizeof(incoming) - 1,
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

        incoming[received_length] = '\0';

        const esp_err_t ack_result =
            validate_ack(incoming, sequence);

        if (ack_result == ESP_OK) {
            break;
        }

        bool handled_command = false;
        const esp_err_t command_status =
            handle_command_payload(
                incoming,
                &handled_command);

        if (handled_command) {
            if (command_status != ESP_OK) {
                ESP_LOGW(
                    TAG,
                    "Command while waiting for ACK failed: %s",
                    esp_err_to_name(command_status));
            }

            continue;
        }

        ESP_LOGW(
            TAG,
            "Invalid ACK for sequence %" PRIu32 ": %s",
            (uint32_t)sequence,
            incoming);
        return ack_result;
    }

    const int64_t receive_end_ms =
        esp_timer_get_time() / 1000;
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

esp_err_t udp_transport_poll_command(
    udp_transport_t *transport,
    uint32_t wait_ms,
    bool *out_handled)
{
    if (out_handled != NULL) {
        *out_handled = false;
    }

    if (transport == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (transport->socket_fd < 0) {
        return ESP_ERR_INVALID_STATE;
    }

    ESP_ERROR_CHECK_WITHOUT_ABORT(
        set_socket_receive_timeout(
            transport->socket_fd,
            wait_ms));

    char incoming[MAX_COMMAND_BYTES] = {0};
    const ssize_t received_length = recvfrom(
        transport->socket_fd,
        incoming,
        sizeof(incoming) - 1,
        0,
        NULL,
        NULL);

    if (received_length < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) {
            return ESP_OK;
        }

        ESP_LOGE(TAG, "recvfrom() failed: errno=%d", errno);
        udp_transport_close(transport);
        return ESP_FAIL;
    }

    incoming[received_length] = '\0';

    const esp_err_t status =
        handle_command_payload(
            incoming,
            out_handled);

    if (status == ESP_ERR_NOT_SUPPORTED) {
        ESP_LOGW(TAG, "Unsupported UDP payload: %s", incoming);
        return status;
    }

    if (status == ESP_ERR_INVALID_RESPONSE) {
        ESP_LOGW(TAG, "Ignoring non-JSON UDP payload: %s", incoming);
        return status;
    }

    return status;
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
