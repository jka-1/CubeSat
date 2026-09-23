#ifndef APP_CONFIG_H
#define APP_CONFIG_H

/*
 * Fill these in for the active lab network before flashing.
 */
#define DEMO_WIFI_SSID               "REPLACE_WITH_WIFI_SSID"
#define DEMO_WIFI_PASSWORD           "REPLACE_WITH_WIFI_PASSWORD"

/*
 * Droplet target for the live telemetry bridge.
 */
#define DEMO_SERVER_HOST             "45.55.77.215"
#define DEMO_SERVER_UDP_PORT         3333u
#define DEMO_DEVICE_ID               "esp32-telemetry"

/*
 * Peripheral analog sensor inputs.
 *
 * Leave these at -1 until the board GPIO assignments are confirmed. When
 * assigned, both pins must resolve to distinct ESP32-S3 ADC1 channels and
 * must not conflict with the I2C pins (GPIO4/GPIO5) or another board signal.
 */
#define DEMO_TEMP_OUT_GPIO            (-1)
#define DEMO_LIGHT_OUT_GPIO           (-1)

/*
 * ESP32-S3-DevKitC-1 v1.1 uses GPIO38 for its addressable RGB LED.
 * The initial board revision uses GPIO48 instead.
 */
#define DEMO_RGB_LED_GPIO            38
#define DEMO_RGB_LED_RED             0u
#define DEMO_RGB_LED_GREEN           24u
#define DEMO_RGB_LED_BLUE            0u

/*
 * Demo timing and retry behavior.
 */
#define DEMO_STREAM_PERIOD_MS        1000u
#define DEMO_ACK_TIMEOUT_MS          250u
#define DEMO_COMMAND_POLL_SLICE_MS   100u
#define DEMO_MAX_CONSECUTIVE_ERRORS  5u

#endif
