#include "console_input.h"

#include <math.h>
#include <stdbool.h>
#include <stdio.h>
#include <string.h>

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

    /*
     * Replace the first CR or LF with a null terminator.
     * Handles \n, \r, and \r\n line endings.
     */
    text[strcspn(text, "\r\n")] = '\0';
}

static void print_help(void)
{
    printf("\nCubeSat telemetry console commands:\n");
    printf("  help\n");
    printf("      Display this command list.\n\n");

    printf("  send\n");
    printf("      Immediately transmit the current telemetry sample.\n\n");

    printf("  status\n");
    printf("      Read and display the current telemetry values.\n\n");

    printf("  set pv_current <amps>\n");
    printf("      Example: set pv_current 0.825\n\n");

    printf("  set battery_voltage <volts>\n");
    printf("      Example: set battery_voltage 16.420\n\n");

    printf("  set mppt_temp <degrees_C>\n");
    printf("      Example: set mppt_temp 33.5\n\n");

    printf("  sample <pv_current> <battery_voltage> <mppt_temp>\n");
    printf("      Example: sample 0.825 16.420 33.5\n\n");

    printf(
        "  ESP32 temperature is read-only and comes from the "
        "internal temperature sensor.\n\n"
    );
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
        "  Solar-panel current:   %.3f A\n",
        sample.solar_panel_current_a
    );
    printf(
        "  Battery voltage:       %.3f V\n",
        sample.battery_voltage_v
    );
    printf(
        "  MPPT temperature:      %.2f C\n",
        sample.mppt_switch_temperature_c
    );
    printf(
        "  ESP32 temperature:     %.2f C (hardware sensor)\n\n",
        sample.esp32_temperature_c
    );
}

static esp_err_t set_single_field(
    const char *field_name,
    float value
)
{
    if (field_name == NULL || !isfinite(value)) {
        return ESP_ERR_INVALID_ARG;
    }

    if (strcmp(field_name, "pv_current") == 0) {
        return sensor_provider_set_solar_panel_current(value);
    }

    if (strcmp(field_name, "battery_voltage") == 0) {
        return sensor_provider_set_battery_voltage(value);
    }

    if (strcmp(field_name, "mppt_temp") == 0) {
        return sensor_provider_set_mppt_temperature(value);
    }

    if (strcmp(field_name, "esp32_temp") == 0) {
        printf(
            "esp32_temp is read-only. It comes from the "
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
    float value = 0.0f;
    char extra_character = '\0';

    /*
     * The final %c detects unexpected trailing arguments.
     * A valid command produces exactly two assignments.
     */
    const int parsed_fields = sscanf(
        line,
        "set %47s %f %c",
        field_name,
        &value,
        &extra_character
    );

    if (parsed_fields != 2) {
        printf(
            "Usage: set <field> <value>\n"
            "Example: set pv_current 0.825\n"
        );

        return;
    }

    if (!isfinite(value)) {
        printf("The supplied value must be a finite number.\n");
        return;
    }

    const esp_err_t err =
        set_single_field(field_name, value);

    if (err == ESP_OK) {
        printf(
            "Updated %s to %.3f\n",
            field_name,
            value
        );

        request_immediate_send();
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

static void process_sample_command(const char *line)
{
    float pv_current = 0.0f;
    float battery_voltage = 0.0f;
    float mppt_temperature = 0.0f;
    char extra_character = '\0';

    /*
     * ESP32 temperature is intentionally not included.
     */
    const int parsed_fields = sscanf(
        line,
        "sample %f %f %f %c",
        &pv_current,
        &battery_voltage,
        &mppt_temperature,
        &extra_character
    );

    if (parsed_fields != 3) {
        printf(
            "Usage: sample <pv_current> "
            "<battery_voltage> <mppt_temp>\n"
            "Example: sample 0.825 16.420 33.5\n"
        );

        return;
    }

    if (
        !isfinite(pv_current) ||
        !isfinite(battery_voltage) ||
        !isfinite(mppt_temperature)
    ) {
        printf("All sample values must be finite numbers.\n");
        return;
    }

    esp_err_t err =
        sensor_provider_set_solar_panel_current(pv_current);

    if (err != ESP_OK) {
        printf(
            "Could not set PV current: %s\n",
            esp_err_to_name(err)
        );

        return;
    }

    err = sensor_provider_set_battery_voltage(
        battery_voltage
    );

    if (err != ESP_OK) {
        printf(
            "Could not set battery voltage: %s\n",
            esp_err_to_name(err)
        );

        return;
    }

    err = sensor_provider_set_mppt_temperature(
        mppt_temperature
    );

    if (err != ESP_OK) {
        printf(
            "Could not set MPPT temperature: %s\n",
            esp_err_to_name(err)
        );

        return;
    }

    printf(
        "Updated sample: "
        "pv=%.3f A, battery=%.3f V, mppt=%.2f C\n",
        pv_current,
        battery_voltage,
        mppt_temperature
    );

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
        /*
         * Print the prompt only once. Without this flag, a
         * temporarily unavailable stdin stream can produce:
         *
         * demo> demo> demo> demo>
         */
        if (!prompt_is_visible) {
            printf("demo> ");
            fflush(stdout);
            prompt_is_visible = true;
        }

        if (fgets(line, sizeof(line), stdin) == NULL) {
            /*
             * Clear EOF/error indicators so the console can recover
             * when another line becomes available.
             */
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

        if (strcmp(line, "send") == 0) {
            printf("Immediate telemetry transmission requested.\n");
            request_immediate_send();
            continue;
        }

        if (strcmp(line, "status") == 0) {
            print_status();
            continue;
        }

        if (strncmp(line, "set ", 4) == 0) {
            process_set_command(line);
            continue;
        }

        if (strncmp(line, "sample ", 7) == 0) {
            process_sample_command(line);
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
    if (telemetry_task_handle == NULL) {
        ESP_LOGE(
            TAG,
            "Cannot start console without a telemetry task handle"
        );

        return;
    }

    s_telemetry_task_handle = telemetry_task_handle;

    const BaseType_t task_result = xTaskCreate(
        console_task,
        "demo_console",
        4096,
        NULL,
        4,
        NULL
    );

    if (task_result != pdPASS) {
        s_telemetry_task_handle = NULL;

        ESP_LOGE(
            TAG,
            "Could not start console task"
        );

        return;
    }

    ESP_LOGI(TAG, "Telemetry console started");
}