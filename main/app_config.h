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
 * Demo timing and retry behavior.
 */
#define DEMO_STREAM_PERIOD_MS        1000u
#define DEMO_ACK_TIMEOUT_MS          250u
#define DEMO_COMMAND_POLL_SLICE_MS   100u
#define DEMO_MAX_CONSECUTIVE_ERRORS  5u

#endif
