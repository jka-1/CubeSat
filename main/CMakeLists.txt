idf_component_register(
    SRCS
        "main.c"
        "wifi_station.c"
        "sensor_provider.c"
        "udp_transport.c"
        "console_input.c"
        "../pass/i2c_bus_monitor.c"
        "../pass/telemetry_packet_v3.c"

    INCLUDE_DIRS
        "."
        "../pass"

    REQUIRES
        esp_wifi
        esp_event
        esp_netif
        nvs_flash
        lwip

    PRIV_REQUIRES
        esp_driver_tsens
        esp_driver_i2c
)
