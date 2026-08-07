#ifndef BOARD_LED_H
#define BOARD_LED_H

#include <stdbool.h>

#include "esp_err.h"

#ifdef __cplusplus
extern "C" {
#endif

esp_err_t board_led_init(void);
esp_err_t board_led_set_enabled(bool enabled);
esp_err_t board_led_get_enabled(bool *out_enabled);

#ifdef __cplusplus
}
#endif

#endif
