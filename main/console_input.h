#ifndef CONSOLE_INPUT_H
#define CONSOLE_INPUT_H

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

void console_input_start(
    TaskHandle_t telemetry_task_handle
);

#endif