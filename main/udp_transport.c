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
#include "board_led.h"
#include "cJSON.h"
#include "esp_check.h"
#include "esp_log.h"
#include "esp_timer.h"

static const char *TAG = "udp_transport";

#define MAX_COMMAND_BYTES            1024
#define MAX_I2C_COMMAND_DATA_LENGTH  32

static void add_hex_string_field(
    cJSON *root,
    const char *field_name,
    uint8_t value)
{
    if (root == NULL || field_name == NULL) {
        return;
    }

    char buffer[8] = {0};
    snprintf(buffer, sizeof(buffer), "0x%02X", value);
    cJSON_AddStringToObject(root, field_name, buffer);
}

static cJSON *create_hex_byte_array(
    const uint8_t *data,
    size_t data_length)
{
    cJSON *array = cJSON_CreateArray();
    if (array == NULL) {
        return NULL;
    }

    for (size_t index = 0; index < data_length; index++) {
        char buffer[8] = {0};
        snprintf(buffer, sizeof(buffer), "0x%02X", data[index]);

        cJSON *entry = cJSON_CreateString(buffer);
        if (entry == NULL) {
            cJSON_Delete(array);
            return NULL;
        }

        cJSON_AddItemToArray(array, entry);
    }

    return array;
}

static void copy_optional_string_field(
    const cJSON *source_root,
    const char *source_name,
    cJSON *destination_root,
    const char *destination_name)
{
    if (source_root == NULL ||
        source_name == NULL ||
        destination_root == NULL ||
        destination_name == NULL) {
        return;
    }

    const cJSON *item =
        cJSON_GetObjectItemCaseSensitive(source_root, source_name);

    if (cJSON_IsString(item) &&
        item->valuestring != NULL &&
        item->valuestring[0] != '\0') {
        cJSON_AddStringToObject(
            destination_root,
            destination_name,
            item->valuestring);
    }
}

static cJSON *create_debug_response_root(
    const udp_transport_t *transport,
    const cJSON *request_root,
    const char *command_type)
{
    cJSON *root = cJSON_CreateObject();
    if (root == NULL) {
        return NULL;
    }

    cJSON_AddNumberToObject(root, "version", 1);
    cJSON_AddStringToObject(root, "type", "debug_result");
    cJSON_AddStringToObject(
        root,
        "device_id",
        transport != NULL ? transport->device_id : DEMO_DEVICE_ID);
    cJSON_AddStringToObject(
        root,
        "command_type",
        command_type != NULL ? command_type : "unknown");
    cJSON_AddNumberToObject(
        root,
        "device_time_ms",
        (double)(esp_timer_get_time() / 1000));

    copy_optional_string_field(
        request_root,
        "request_id",
        root,
        "request_id");
    copy_optional_string_field(
        request_root,
        "issued_at",
        root,
        "issued_at");

    return root;
}

static esp_err_t send_json_payload_to_server(
    udp_transport_t *transport,
    const char *payload_text)
{
    if (transport == NULL || payload_text == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (transport->socket_fd < 0) {
        return ESP_ERR_INVALID_STATE;
    }

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
    const int lookup_status = getaddrinfo(
        transport->server_host,
        port_text,
        &hints,
        &destination);

    if (lookup_status != 0 || destination == NULL) {
        return ESP_ERR_NOT_FOUND;
    }

    const ssize_t bytes_sent = sendto(
        transport->socket_fd,
        payload_text,
        strlen(payload_text),
        0,
        destination->ai_addr,
        destination->ai_addrlen);

    freeaddrinfo(destination);

    if (bytes_sent < 0) {
        ESP_LOGW(TAG, "sendto(debug_result) failed: errno=%d", errno);
        return ESP_FAIL;
    }

    return ESP_OK;
}

static esp_err_t send_debug_response(
    udp_transport_t *transport,
    cJSON *response_root)
{
    if (response_root == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    char *response_text = cJSON_PrintUnformatted(response_root);
    if (response_text == NULL) {
        return ESP_ERR_NO_MEM;
    }

    const esp_err_t status =
        send_json_payload_to_server(transport, response_text);

    cJSON_free(response_text);
    return status;
}

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

static esp_err_t parse_boolean_field(
    const cJSON *item,
    bool *out_value)
{
    if (item == NULL || out_value == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (cJSON_IsBool(item)) {
        *out_value = cJSON_IsTrue(item);
        return ESP_OK;
    }

    if (cJSON_IsNumber(item)) {
        *out_value = item->valuedouble != 0.0;
        return ESP_OK;
    }

    if (cJSON_IsString(item) && item->valuestring != NULL) {
        if (strcasecmp(item->valuestring, "true") == 0 ||
            strcasecmp(item->valuestring, "on") == 0 ||
            strcasecmp(item->valuestring, "enable") == 0 ||
            strcasecmp(item->valuestring, "enabled") == 0 ||
            strcasecmp(item->valuestring, "resume") == 0 ||
            strcasecmp(item->valuestring, "resumed") == 0) {
            *out_value = true;
            return ESP_OK;
        }

        if (strcasecmp(item->valuestring, "false") == 0 ||
            strcasecmp(item->valuestring, "off") == 0 ||
            strcasecmp(item->valuestring, "disable") == 0 ||
            strcasecmp(item->valuestring, "disabled") == 0 ||
            strcasecmp(item->valuestring, "pause") == 0 ||
            strcasecmp(item->valuestring, "paused") == 0) {
            *out_value = false;
            return ESP_OK;
        }
    }

    return ESP_ERR_INVALID_ARG;
}

static esp_err_t parse_sensor_mask_field(
    const cJSON *sensor_item,
    const cJSON *addr_item,
    uint32_t *out_sensor_mask)
{
    if (out_sensor_mask == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (cJSON_IsString(sensor_item) &&
        sensor_item->valuestring != NULL) {
        if (strcasecmp(sensor_item->valuestring, "pv") == 0 ||
            strcasecmp(sensor_item->valuestring, "ina226") == 0) {
            *out_sensor_mask = I2C_SENSOR_GROUP_PV;
            return ESP_OK;
        }

        if (strcasecmp(sensor_item->valuestring, "bms") == 0 ||
            strcasecmp(sensor_item->valuestring, "bq76942") == 0) {
            *out_sensor_mask = I2C_SENSOR_GROUP_BMS;
            return ESP_OK;
        }

        if (strcasecmp(sensor_item->valuestring, "mppt") == 0 ||
            strcasecmp(sensor_item->valuestring, "bq25798") == 0) {
            *out_sensor_mask = I2C_SENSOR_GROUP_MPPT;
            return ESP_OK;
        }

        if (strcasecmp(sensor_item->valuestring, "all") == 0) {
            *out_sensor_mask = I2C_SENSOR_GROUP_ALL;
            return ESP_OK;
        }
    }

    if (addr_item != NULL) {
        uint8_t address = 0;
        ESP_RETURN_ON_ERROR(
            parse_byte_field(addr_item, "addr", &address),
            TAG,
            "Invalid sensor-control address");

        if (address == INA226_I2C_ADDRESS) {
            *out_sensor_mask = I2C_SENSOR_GROUP_PV;
            return ESP_OK;
        }

        if (address == BQ76942_I2C_ADDRESS) {
            *out_sensor_mask = I2C_SENSOR_GROUP_BMS;
            return ESP_OK;
        }

        if (address == BQ25798_I2C_ADDRESS) {
            *out_sensor_mask = I2C_SENSOR_GROUP_MPPT;
            return ESP_OK;
        }
    }

    return ESP_ERR_INVALID_ARG;
}

static esp_err_t handle_i2c_write_command(
    const cJSON *root,
    cJSON *response_root)
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
    add_hex_string_field(response_root, "addr", address);

    ESP_RETURN_ON_ERROR(
        parse_byte_field(reg_item, "reg", &register_address),
        TAG,
        "Invalid I2C register");
    add_hex_string_field(response_root, "reg", register_address);

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

    if (response_root != NULL) {
        cJSON_AddNumberToObject(
            response_root,
            "len",
            (double)write_length);
        cJSON_AddItemToObject(
            response_root,
            "write_data",
            create_hex_byte_array(write_data, write_length));
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
    const cJSON *root,
    cJSON *response_root)
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
    add_hex_string_field(response_root, "addr", address);

    ESP_RETURN_ON_ERROR(
        parse_byte_field(reg_item, "reg", &register_address),
        TAG,
        "Invalid I2C register");
    add_hex_string_field(response_root, "reg", register_address);

    if (len_item != NULL || length_item != NULL) {
        ESP_RETURN_ON_ERROR(
            parse_length_field(
                len_item != NULL ? len_item : length_item,
                &read_length),
            TAG,
            "Invalid I2C read length");
    }

    if (response_root != NULL) {
        cJSON_AddNumberToObject(
            response_root,
            "len",
            (double)read_length);
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

    if (response_root != NULL) {
        cJSON_AddItemToObject(
            response_root,
            "data",
            create_hex_byte_array(read_data, read_length));
        cJSON_AddStringToObject(
            response_root,
            "note",
            response_text);
    }

    return ESP_OK;
}

static esp_err_t handle_sensor_control_command(
    const cJSON *root,
    cJSON *response_root)
{
    const cJSON *sensor_item =
        cJSON_GetObjectItemCaseSensitive(root, "sensor");
    const cJSON *addr_item =
        cJSON_GetObjectItemCaseSensitive(root, "addr");
    const cJSON *enabled_item =
        cJSON_GetObjectItemCaseSensitive(root, "enabled");
    const cJSON *state_item =
        cJSON_GetObjectItemCaseSensitive(root, "state");

    uint32_t sensor_mask = 0u;
    bool enabled = false;

    ESP_RETURN_ON_ERROR(
        parse_sensor_mask_field(
            sensor_item,
            addr_item,
            &sensor_mask),
        TAG,
        "Invalid sensor group");

    const cJSON *control_item =
        enabled_item != NULL ? enabled_item : state_item;

    ESP_RETURN_ON_ERROR(
        parse_boolean_field(control_item, &enabled),
        TAG,
        "Invalid sensor-control state");

    ESP_RETURN_ON_ERROR(
        i2c_bus_monitor_set_sensor_enabled(
            sensor_mask,
            enabled),
        TAG,
        "Could not update sensor polling state");

    uint32_t active_mask = 0u;
    ESP_RETURN_ON_ERROR(
        i2c_bus_monitor_get_sensor_mask(&active_mask),
        TAG,
        "Could not read sensor polling state");

    if (response_root != NULL) {
        if (cJSON_IsString(sensor_item) &&
            sensor_item->valuestring != NULL) {
            cJSON_AddStringToObject(
                response_root,
                "sensor",
                sensor_item->valuestring);
        } else if (addr_item != NULL) {
            uint8_t address = 0u;
            if (parse_byte_field(addr_item, "addr", &address) == ESP_OK) {
                add_hex_string_field(
                    response_root,
                    "addr",
                    address);
            }
        }

        cJSON_AddBoolToObject(
            response_root,
            "enabled",
            enabled);
        cJSON_AddNumberToObject(
            response_root,
            "sensor_mask",
            (double)sensor_mask);
        cJSON_AddNumberToObject(
            response_root,
            "active_sensor_mask",
            (double)active_mask);
        cJSON_AddStringToObject(
            response_root,
            "note",
            enabled
                ? "Automatic polling resumed for the selected sensor group."
                : "Automatic polling paused for the selected sensor group.");
    }

    return ESP_OK;
}

static const char *acdrv_state_name(
    i2c_acdrv_state_t state)
{
    switch (state) {
        case I2C_ACDRV1_SELECTED:
            return "acdrv1";

        case I2C_ACDRV2_SELECTED:
            return "acdrv2";

        case I2C_ACDRV_DISABLED:
        default:
            return "disabled";
    }
}

static esp_err_t parse_acdrv_state(
    const cJSON *item,
    i2c_acdrv_state_t *out_state)
{
    if (!cJSON_IsString(item) ||
        item->valuestring == NULL ||
        out_state == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (strcasecmp(item->valuestring, "acdrv1") == 0) {
        *out_state = I2C_ACDRV1_SELECTED;
        return ESP_OK;
    }

    if (strcasecmp(item->valuestring, "acdrv2") == 0) {
        *out_state = I2C_ACDRV2_SELECTED;
        return ESP_OK;
    }

    if (strcasecmp(item->valuestring, "disabled") == 0 ||
        strcasecmp(item->valuestring, "off") == 0) {
        *out_state = I2C_ACDRV_DISABLED;
        return ESP_OK;
    }

    return ESP_ERR_INVALID_ARG;
}

static esp_err_t handle_acdrv_control_command(
    const cJSON *root,
    cJSON *response_root)
{
    const cJSON *state_item =
        cJSON_GetObjectItemCaseSensitive(root, "state");
    i2c_acdrv_state_t state = I2C_ACDRV_DISABLED;

    ESP_RETURN_ON_ERROR(
        parse_acdrv_state(state_item, &state),
        TAG,
        "Invalid ACDRV state");

    i2c_acdrv_result_t result = {0};
    const esp_err_t status =
        i2c_bus_monitor_set_acdrv_state(
            state,
            &result);

    if (response_root != NULL) {
        cJSON_AddStringToObject(
            response_root,
            "state",
            acdrv_state_name(state));
        add_hex_string_field(
            response_root,
            "register_12_before",
            result.register_12_before);
        add_hex_string_field(
            response_root,
            "register_12_after",
            result.register_12_after);
        add_hex_string_field(
            response_root,
            "register_13_before",
            result.register_13_before);
        add_hex_string_field(
            response_root,
            "register_13_after",
            result.register_13_after);
        add_hex_string_field(
            response_root,
            "acrb_status",
            result.acrb_status);
        cJSON_AddBoolToObject(
            response_root,
            "acrb1_present",
            (result.acrb_status & 0x40u) != 0u);
        cJSON_AddBoolToObject(
            response_root,
            "acrb2_present",
            (result.acrb_status & 0x80u) != 0u);
        cJSON_AddBoolToObject(
            response_root,
            "verified",
            result.verified);
        cJSON_AddStringToObject(
            response_root,
            "note",
            status == ESP_OK
                ? "ACDRV control bits were preserved and verified by readback; confirm the physical PACK voltage separately."
                : "ACDRV control was not verified; no physical power-path success is claimed.");
    }

    return status;
}

static esp_err_t handle_led_control_command(
    const cJSON *root,
    cJSON *response_root)
{
    const cJSON *enabled_item =
        cJSON_GetObjectItemCaseSensitive(root, "enabled");
    const cJSON *state_item =
        cJSON_GetObjectItemCaseSensitive(root, "state");
    const cJSON *control_item =
        enabled_item != NULL ? enabled_item : state_item;
    bool enabled = false;

    ESP_RETURN_ON_ERROR(
        parse_boolean_field(control_item, &enabled),
        TAG,
        "Invalid LED state");

    ESP_RETURN_ON_ERROR(
        board_led_set_enabled(enabled),
        TAG,
        "Could not update RGB LED");

    bool confirmed_enabled = false;
    ESP_RETURN_ON_ERROR(
        board_led_get_enabled(&confirmed_enabled),
        TAG,
        "Could not read RGB LED state");

    if (response_root != NULL) {
        cJSON_AddBoolToObject(
            response_root,
            "enabled",
            confirmed_enabled);
        cJSON_AddNumberToObject(
            response_root,
            "gpio",
            DEMO_RGB_LED_GPIO);
        cJSON_AddStringToObject(
            response_root,
            "note",
            confirmed_enabled
                ? "Addressable RGB status LED is on."
                : "Addressable RGB status LED is off.");
    }

    return confirmed_enabled == enabled
        ? ESP_OK
        : ESP_ERR_INVALID_RESPONSE;
}

static esp_err_t handle_command_payload(
    udp_transport_t *transport,
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
    esp_err_t response_status = ESP_OK;
    bool handled = false;
    cJSON *response_root = NULL;

    if (cJSON_IsString(type_item) &&
        type_item->valuestring != NULL) {
        if (strcmp(type_item->valuestring, "ack") == 0) {
            status = ESP_OK;
            handled = false;
        } else if (strcmp(type_item->valuestring, "i2c_write") == 0) {
            response_root =
                create_debug_response_root(
                    transport,
                    root,
                    "i2c_write");
            status = handle_i2c_write_command(root, response_root);
            handled = true;
        } else if (strcmp(type_item->valuestring, "i2c_read") == 0) {
            response_root =
                create_debug_response_root(
                    transport,
                    root,
                    "i2c_read");
            status = handle_i2c_read_command(root, response_root);
            handled = true;
        } else if (strcmp(type_item->valuestring, "sensor_control") == 0) {
            response_root =
                create_debug_response_root(
                    transport,
                    root,
                    "sensor_control");
            status = handle_sensor_control_command(root, response_root);
            handled = true;
        } else if (strcmp(type_item->valuestring, "mppt_acdrv_control") == 0) {
            response_root =
                create_debug_response_root(
                    transport,
                    root,
                    "mppt_acdrv_control");
            status = handle_acdrv_control_command(root, response_root);
            handled = true;
        } else if (strcmp(type_item->valuestring, "led_control") == 0) {
            response_root =
                create_debug_response_root(
                    transport,
                    root,
                    "led_control");
            status = handle_led_control_command(root, response_root);
            handled = true;
        }
    }

    if (handled && response_root != NULL) {
        cJSON_AddBoolToObject(response_root, "ok", status == ESP_OK);
        cJSON_AddStringToObject(
            response_root,
            "status",
            status == ESP_OK ? "ok" : "error");

        if (status != ESP_OK) {
            cJSON_AddStringToObject(
                response_root,
                "error",
                esp_err_to_name(status));
        }

        response_status =
            send_debug_response(transport, response_root);

        if (response_status != ESP_OK) {
            ESP_LOGW(
                TAG,
                "Could not send debug response: %s",
                esp_err_to_name(response_status));
        }
    }

    cJSON_Delete(root);
    cJSON_Delete(response_root);

    if (out_handled != NULL) {
        *out_handled = handled;
    }

    if (status == ESP_OK && response_status != ESP_OK) {
        return response_status;
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
                transport,
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
            transport,
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
