idf_component_register(
    SRCS
        "main.c"
        "board_led.c"
        "wifi_station.c"
        "sensor_provider.c"
        "peripheral_sensor_math.c"
        "peripheral_sensors.c"
        "udp_transport.c"
        "console_input.c"
        "../pass/i2c_bus_monitor.c"
        "../pass/telemetry_packet_v3.c"
        "../pass/telemetry_packet_v4.c"

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
        esp_adc
        led_strip
)
