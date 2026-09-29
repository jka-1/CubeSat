idf_component_register(
    SRCS
        "main.c"
        "ina226.c"
        "ina226_protocol.c"
        "udp_link.c"
        "wifi_station.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        esp_wifi
        esp_event
        esp_netif
        esp_timer
        nvs_flash
        lwip

    PRIV_REQUIRES
        esp_driver_i2c
)
