#include "wifi_station.h"

#include <string.h>

#include "app_config.h"
#include "esp_check.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "esp_wifi.h"
#include "nvs_flash.h"

static const char *TAG = "wifi_station";
static EventGroupHandle_t s_wifi_event_group;
static int s_retry_count;
static volatile uint32_t s_disconnect_count;
static esp_timer_handle_t s_reconnect_timer;

static void reconnect_timer_callback(void *arg)
{
    (void)arg;
    ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_connect());
}

/* Exponential back-off: 1 s, 2 s, 4 s ... capped at DEMO_WIFI_BACKOFF_MAX_MS, retried forever. */
static uint32_t reconnect_delay_ms(int attempt)
{
    uint32_t delay = DEMO_WIFI_BACKOFF_MIN_MS;
    for (int i = 1; i < attempt && delay < DEMO_WIFI_BACKOFF_MAX_MS; i++) {
        delay *= 2u;
    }
    return delay > DEMO_WIFI_BACKOFF_MAX_MS ? DEMO_WIFI_BACKOFF_MAX_MS : delay;
}

static void wifi_event_handler(
    void *arg,
    esp_event_base_t event_base,
    int32_t event_id,
    void *event_data)
{
    (void)arg;
    (void)event_data;

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_connect());
        return;
    }

    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        xEventGroupClearBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
        ++s_disconnect_count;
        ++s_retry_count;

        const uint32_t delay_ms = reconnect_delay_ms(s_retry_count);
        ESP_LOGW(TAG, "Wi-Fi disconnected; reconnect attempt %d in %u ms",
                 s_retry_count, (unsigned)delay_ms);

        if (s_reconnect_timer != NULL) {
            esp_timer_stop(s_reconnect_timer);
            ESP_ERROR_CHECK_WITHOUT_ABORT(
                esp_timer_start_once(s_reconnect_timer, (uint64_t)delay_ms * 1000u));
        } else {
            ESP_ERROR_CHECK_WITHOUT_ABORT(esp_wifi_connect());
        }
        return;
    }

    if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        const ip_event_got_ip_t *event = (const ip_event_got_ip_t *)event_data;
        ESP_LOGI(TAG, "IPv4 address: " IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_count = 0;
        xEventGroupSetBits(s_wifi_event_group, WIFI_CONNECTED_BIT);
    }
}

esp_err_t wifi_station_init(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES ||
        err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_RETURN_ON_ERROR(err, TAG, "NVS initialization failed");

    ESP_RETURN_ON_ERROR(esp_netif_init(), TAG, "esp_netif_init failed");
    ESP_RETURN_ON_ERROR(
        esp_event_loop_create_default(),
        TAG,
        "event loop creation failed");

    s_wifi_event_group = xEventGroupCreate();
    if (s_wifi_event_group == NULL) {
        return ESP_ERR_NO_MEM;
    }

    esp_netif_create_default_wifi_sta();

    const esp_timer_create_args_t reconnect_timer_args = {
        .callback = reconnect_timer_callback,
        .name = "wifi_reconnect",
    };
    ESP_RETURN_ON_ERROR(
        esp_timer_create(&reconnect_timer_args, &s_reconnect_timer),
        TAG,
        "reconnect timer creation failed");

    wifi_init_config_t wifi_init_config = WIFI_INIT_CONFIG_DEFAULT();
    ESP_RETURN_ON_ERROR(
        esp_wifi_init(&wifi_init_config),
        TAG,
        "esp_wifi_init failed");

    esp_event_handler_instance_t wifi_instance;
    esp_event_handler_instance_t ip_instance;

    ESP_RETURN_ON_ERROR(
        esp_event_handler_instance_register(
            WIFI_EVENT,
            ESP_EVENT_ANY_ID,
            &wifi_event_handler,
            NULL,
            &wifi_instance),
        TAG,
        "Wi-Fi handler registration failed");

    ESP_RETURN_ON_ERROR(
        esp_event_handler_instance_register(
            IP_EVENT,
            IP_EVENT_STA_GOT_IP,
            &wifi_event_handler,
            NULL,
            &ip_instance),
        TAG,
        "IP handler registration failed");

    wifi_config_t wifi_config = {0};

    strlcpy(
        (char *)wifi_config.sta.ssid,
        DEMO_WIFI_SSID,
        sizeof(wifi_config.sta.ssid));

    strlcpy(
        (char *)wifi_config.sta.password,
        DEMO_WIFI_PASSWORD,
        sizeof(wifi_config.sta.password));

    wifi_config.sta.threshold.authmode = WIFI_AUTH_WPA2_PSK;
    wifi_config.sta.pmf_cfg.capable = true;
    wifi_config.sta.pmf_cfg.required = false;

    ESP_RETURN_ON_ERROR(
        esp_wifi_set_mode(WIFI_MODE_STA),
        TAG,
        "setting station mode failed");

    ESP_RETURN_ON_ERROR(
        esp_wifi_set_config(WIFI_IF_STA, &wifi_config),
        TAG,
        "setting Wi-Fi configuration failed");

    ESP_RETURN_ON_ERROR(esp_wifi_start(), TAG, "starting Wi-Fi failed");

    ESP_LOGI(TAG, "Wi-Fi station started");
    return ESP_OK;
}

EventGroupHandle_t wifi_station_event_group(void)
{
    return s_wifi_event_group;
}

uint32_t wifi_station_reconnect_count(void)
{
    return s_disconnect_count;
}

esp_err_t wifi_station_get_rssi(int8_t *out_rssi)
{
    if (out_rssi == NULL) {
        return ESP_ERR_INVALID_ARG;
    }

    wifi_ap_record_t ap_info = {0};
    const esp_err_t status = esp_wifi_sta_get_ap_info(&ap_info);
    if (status == ESP_OK) {
        *out_rssi = ap_info.rssi;
    }
    return status;
}
