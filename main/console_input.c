#include "console_input.h"

#include <errno.h>
#include <inttypes.h>
#include <math.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>

#include "esp_err.h"
#include "esp_log.h"
#include "sensor_provider.h"

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "console_input";

static TaskHandle_t s_telemetry_task_handle = NULL;

static void request_immediate_send(void)
{
    if (s_telemetry_task_handle != NULL) {
        xTaskNotifyGive(s_telemetry_task_handle);
    }
}

static void trim_newline(char *text)
{
    if (text == NULL) {
        return;
    }

    text[strcspn(text, "\r\n")] = '\0';
}

static void print_fields(void)
{
    printf("\nSupported telemetry fields:\n");
    printf("  pv_shunt_mv\n");
    printf("  pv_power_w\n");
    printf("  pv_current_a\n");
    printf("  mppt_switch        (on/off or 1/0)\n");
    printf("  mppt_fault_mask    (decimal or 0x....)\n");
    printf("  cell1_v\n");
    printf("  cell2_v\n");
    printf("  cell3_v\n");
    printf("  cell4_v\n");
    printf("  load_shunt_mv\n");
    printf("  load_power_w\n");
    printf("  load_current_a\n");
    printf("  mcu_temp_c         (read-only hardware sensor)\n\n");
}

static void print_help(void)
{
    printf("\nCubeSat telemetry console commands:\n");
    printf("  help\n");
    printf("      Display this command list.\n\n");

    printf("  fields\n");
    printf("      Display the supported settable field names.\n\n");

    printf("  send\n");
    printf("      Immediately transmit the current telemetry sample.\n\n");

    printf("  status\n");
    printf("      Read and display the current telemetry values.\n\n");

    printf("  profile nominal\n");
    printf("      Load the default healthy demo telemetry values.\n\n");

    printf("  profile fault\n");
    printf("      Load a demo fault profile with MPPT disabled.\n\n");

    printf("  set <field> <value>\n");
    printf("      Example: set pv_current_a 1.240\n");
    printf("      Example: set mppt_switch on\n");
    printf("      Example: set mppt_fault_mask 0x0004\n\n");
}

static void print_status(void)
{
    telemetry_sample_t sample = {0};

    const esp_err_t err =
        sensor_provider_read_sample(&sample);

    if (err != ESP_OK) {
        printf(
            "Could not read telemetry: %s\n",
            esp_err_to_name(err)
        );

        return;
    }

    printf("\nCurrent telemetry:\n");
    printf(
        "  MCU temperature:      %.2f C\n",
        sample.mcu_temperature_c
    );
    printf(
        "  PV shunt voltage:     %.3f mV\n",
        sample.pv_shunt_voltage_mv
    );
    printf(
        "  PV power/current:     %.3f W / %.3f A\n",
        sample.pv_power_w,
        sample.pv_current_a
    );
    printf(
        "  MPPT switch:          %s\n",
        sample.mppt_switch_enabled ? "on" : "off"
    );
    printf(
        "  MPPT fault mask:      0x%04X\n",
        sample.mppt_fault_mask
    );
    printf(
        "  BMS cell voltages:    %.3f V / %.3f V / %.3f V / %.3f V\n",
        sample.bms_cell_voltages_v[0],
        sample.bms_cell_voltages_v[1],
        sample.bms_cell_voltages_v[2],
        sample.bms_cell_voltages_v[3]
    );
    printf(
        "  Load shunt voltage:   %.3f mV\n",
        sample.load_shunt_voltage_mv
    );
    printf(
        "  Load power/current:   %.3f W / %.3f A\n",
        sample.load_power_w,
        sample.load_current_a
    );
    printf(
        "  Sample counter:       %" PRIu32 "\n\n",
        sample.sample_counter
    );
}

static bool parse_float_value(
    const char *text,
    float *out_value
)
{
    if (text == NULL || out_value == NULL) {
        return false;
    }

    errno = 0;
    char *end = NULL;
    const float value = strtof(text, &end);

    if (
        errno != 0 ||
        end == text ||
        end == NULL ||
        *end != '\0' ||
        !isfinite(value)
    ) {
        return false;
    }

    *out_value = value;
    return true;
}

static bool parse_uint16_value(
    const char *text,
    uint16_t *out_value
)
{
    if (text == NULL || out_value == NULL) {
        return false;
    }

    errno = 0;
    char *end = NULL;
    const unsigned long value = strtoul(text, &end, 0);

    if (
        errno != 0 ||
        end == text ||
        end == NULL ||
        *end != '\0' ||
        value > 0xFFFFul
    ) {
        return false;
    }

    *out_value = (uint16_t)value;
    return true;
}

static bool parse_switch_state(
    const char *text,
    bool *out_enabled
)
{
    if (text == NULL || out_enabled == NULL) {
        return false;
    }

    if (
        strcasecmp(text, "1") == 0 ||
        strcasecmp(text, "on") == 0 ||
        strcasecmp(text, "true") == 0 ||
        strcasecmp(text, "enabled") == 0
    ) {
        *out_enabled = true;
        return true;
    }

    if (
        strcasecmp(text, "0") == 0 ||
        strcasecmp(text, "off") == 0 ||
        strcasecmp(text, "false") == 0 ||
        strcasecmp(text, "disabled") == 0
    ) {
        *out_enabled = false;
        return true;
    }

    return false;
}

static esp_err_t set_single_field(
    const char *field_name,
    const char *value_text
)
{
    if (field_name == NULL || value_text == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    float float_value = 0.0f;
    uint16_t uint16_value = 0;
    bool enabled = false;

    if (strcmp(field_name, "pv_shunt_mv") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_pv_shunt_voltage(float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "pv_power_w") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_pv_power(float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "pv_current_a") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_pv_current(float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "mppt_switch") == 0) {
        return parse_switch_state(value_text, &enabled)
            ? sensor_provider_set_mppt_switch_enabled(enabled)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "mppt_fault_mask") == 0) {
        return parse_uint16_value(value_text, &uint16_value)
            ? sensor_provider_set_mppt_fault_mask(uint16_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "cell1_v") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_bms_cell_voltage(0u, float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "cell2_v") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_bms_cell_voltage(1u, float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "cell3_v") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_bms_cell_voltage(2u, float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "cell4_v") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_bms_cell_voltage(3u, float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "load_shunt_mv") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_load_shunt_voltage(float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "load_power_w") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_load_power(float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "load_current_a") == 0) {
        return parse_float_value(value_text, &float_value)
            ? sensor_provider_set_load_current(float_value)
            : ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "mcu_temp_c") == 0) {
        printf(
            "mcu_temp_c is read-only. It comes from the "
            "ESP32-S3 internal temperature sensor.\n"
        );

        return ESP_ERR_NOT_SUPPORTED;
    }

    printf("Unknown telemetry field: %s\n", field_name);
    return ESP_ERR_NOT_FOUND;
}

static void process_set_command(const char *line)
{
    char field_name[48] = {0};
    char value_text[48] = {0};
    char extra_character = '\0';

    const int parsed_fields = sscanf(
        line,
        "set %47s %47s %c",
        field_name,
        value_text,
        &extra_character
    );

    if (parsed_fields != 2) {
        printf(
            "Usage: set <field> <value>\n"
            "Example: set pv_current_a 1.240\n"
            "Example: set mppt_fault_mask 0x0004\n"
        );

        return;
    }

    const esp_err_t err =
        set_single_field(field_name, value_text);

    if (err == ESP_OK) {
        printf(
            "Updated %s to %s\n",
            field_name,
            value_text
        );

        request_immediate_send();
    } else if (err == ESP_ERR_INVALID_ARG) {
        printf(
            "Invalid value for %s: %s\n",
            field_name,
            value_text
        );
    } else if (
        err != ESP_ERR_NOT_SUPPORTED &&
        err != ESP_ERR_NOT_FOUND
    ) {
        printf(
            "Could not update %s: %s\n",
            field_name,
            esp_err_to_name(err)
        );
    }
}

static void process_profile_command(const char *line)
{
    char profile_name[32] = {0};
    char extra_character = '\0';

    const int parsed_fields = sscanf(
        line,
        "profile %31s %c",
        profile_name,
        &extra_character
    );

    if (parsed_fields != 1) {
        printf("Usage: profile <nominal|fault>\n");
        return;
    }

    const bool faulted =
        strcmp(profile_name, "fault") == 0;

    if (
        !faulted &&
        strcmp(profile_name, "nominal") != 0
    ) {
        printf(
            "Unknown profile: %s\n"
            "Valid options: nominal, fault\n",
            profile_name
        );
        return;
    }

    const esp_err_t err =
        sensor_provider_load_demo_profile(faulted);

    if (err != ESP_OK) {
        printf(
            "Could not load profile %s: %s\n",
            profile_name,
            esp_err_to_name(err)
        );
        return;
    }

    printf("Loaded profile: %s\n", profile_name);
    request_immediate_send();
}

static void console_task(void *argument)
{
    (void)argument;

    setvbuf(stdin, NULL, _IONBF, 0);
    setvbuf(stdout, NULL, _IONBF, 0);

    print_help();

    char line[160] = {0};
    bool prompt_is_visible = false;

    while (true) {
        if (!prompt_is_visible) {
            printf("demo> ");
            fflush(stdout);
            prompt_is_visible = true;
        }

        if (fgets(line, sizeof(line), stdin) == NULL) {
            clearerr(stdin);
            vTaskDelay(pdMS_TO_TICKS(100));
            continue;
        }

        prompt_is_visible = false;
        trim_newline(line);

        if (line[0] == '\0') {
            continue;
        }

        if (strcmp(line, "help") == 0) {
            print_help();
            continue;
        }

        if (strcmp(line, "fields") == 0) {
            print_fields();
            continue;
        }

        if (strcmp(line, "send") == 0) {
            printf("Immediate telemetry transmission requested.\n");
            request_immediate_send();
            continue;
        }

        if (strcmp(line, "status") == 0) {
            print_status();
            continue;
        }

        if (strncmp(line, "profile ", 8) == 0) {
            process_profile_command(line);
            continue;
        }

        if (strncmp(line, "set ", 4) == 0) {
            process_set_command(line);
            continue;
        }

        if (strncmp(line, "sample", 6) == 0) {
            printf(
                "The old sample command has been replaced.\n"
                "Use profile nominal, profile fault, or set <field> <value>.\n"
            );
            continue;
        }

        printf(
            "Unrecognized command: %s\n"
            "Type help to display the available commands.\n",
            line
        );
    }
}

void console_input_start(
    TaskHandle_t telemetry_task_handle
)
{
    s_telemetry_task_handle = telemetry_task_handle;

    const BaseType_t task_result = xTaskCreate(
        console_task,
        "console_input",
        4096,
        NULL,
        4,
        NULL
    );

    if (task_result != pdPASS) {
        ESP_LOGE(TAG, "Could not create console task");
    }
}
