#pragma once

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/event_groups.h"

#define WIFI_CONNECTED_BIT BIT0

esp_err_t wifi_station_init(void);
EventGroupHandle_t wifi_station_event_group(void);
