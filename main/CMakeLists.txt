idf_component_register(
    SRCS
        "main.c"
        "wifi_station.c"
        "sensor_provider.c"
        "udp_transport.c"
        "console_input.c"

    INCLUDE_DIRS
        "."

    REQUIRES
        esp_wifi
        esp_event
        esp_netif
        nvs_flash
        lwip

    PRIV_REQUIRES
        esp_driver_tsens
)