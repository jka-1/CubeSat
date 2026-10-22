#pragma once

#include <stdint.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#define WIFI_CONNECTED_BIT BIT0

esp_err_t wifi_station_init(void);
EventGroupHandle_t wifi_station_event_group(void);
/* Number of STA_DISCONNECTED events since boot. */
uint32_t wifi_station_reconnect_count(void);
/* RSSI of the associated AP (esp_wifi_sta_get_ap_info). */
esp_err_t wifi_station_get_rssi(int8_t *out_rssi);
