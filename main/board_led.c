#include "board_led.h"

#include "app_config.h"
#include "esp_log.h"
#include "led_strip.h"
#include "led_strip_rmt.h"

static const char *TAG = "board_led";

static led_strip_handle_t s_led_strip;
static bool s_initialized;
static bool s_enabled;

esp_err_t board_led_init(void)
{
    if (s_initialized) {
        return ESP_OK;
    }

    const led_strip_config_t strip_config = {
        .strip_gpio_num = DEMO_RGB_LED_GPIO,
        .max_leds = 1,
        .led_model = LED_MODEL_WS2812,
        .color_component_format = LED_STRIP_COLOR_COMPONENT_FMT_GRB,
        .flags = {
            .invert_out = false,
        },
    };

    const led_strip_rmt_config_t rmt_config = {
        .clk_src = RMT_CLK_SRC_DEFAULT,
        .resolution_hz = 10u * 1000u * 1000u,
        .mem_block_symbols = 64u,
        .flags = {
            .with_dma = false,
        },
    };

    esp_err_t status = led_strip_new_rmt_device(
        &strip_config,
        &rmt_config,
        &s_led_strip);

    if (status != ESP_OK) {
        ESP_LOGE(
            TAG,
            "Could not initialize RGB LED on GPIO %d: %s",
            DEMO_RGB_LED_GPIO,
            esp_err_to_name(status));
        return status;
    }

    status = led_strip_clear(s_led_strip);
    if (status != ESP_OK) {
        led_strip_del(s_led_strip);
        s_led_strip = NULL;
        return status;
    }

    s_enabled = false;
    s_initialized = true;

    ESP_LOGI(
        TAG,
        "Addressable RGB LED ready on GPIO %d (boot state: off)",
        DEMO_RGB_LED_GPIO);

    return ESP_OK;
}

esp_err_t board_led_set_enabled(bool enabled)
{
    if (!s_initialized || s_led_strip == NULL) {
        return ESP_ERR_INVALID_STATE;
    }

    esp_err_t status;

    if (enabled) {
        status = led_strip_set_pixel(
            s_led_strip,
            0,
            DEMO_RGB_LED_RED,
            DEMO_RGB_LED_GREEN,
            DEMO_RGB_LED_BLUE);

        if (status == ESP_OK) {
            status = led_strip_refresh(s_led_strip);
        }
    } else {
        status = led_strip_clear(s_led_strip);
    }

    if (status == ESP_OK) {
        s_enabled = enabled;
        ESP_LOGI(TAG, "RGB LED %s", enabled ? "on" : "off");
    }

    return status;
}

esp_err_t board_led_get_enabled(bool *out_enabled)
{
    if (out_enabled == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    if (!s_initialized) {
        return ESP_ERR_INVALID_STATE;
    }

    *out_enabled = s_enabled;
    return ESP_OK;
}
