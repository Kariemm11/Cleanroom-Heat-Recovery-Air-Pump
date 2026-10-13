// Minimal stand-ins for the Arduino-ESP32 API, only for the host syntax check (test/check_syntax.sh).
#pragma once
#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#define IRAM_ATTR
#define HIGH 1
#define LOW 0
#define OUTPUT 3
#define INPUT_PULLUP 5
#define FALLING 2
#define SERIAL_8N1 0x800001c
#define ESP_ARDUINO_VERSION_MAJOR 2
enum adc_attenuation_t { ADC_0db, ADC_2_5db, ADC_6db, ADC_11db };
class Print {
 public:
  virtual ~Print() {}
  virtual size_t write(uint8_t) { return 1; }
  size_t print(const char*) { return 0; }
  size_t print(char) { return 0; }
  size_t print(int, int = 10) { return 0; }
  size_t print(unsigned, int = 10) { return 0; }
  size_t print(long, int = 10) { return 0; }
  size_t print(double, int = 2) { return 0; }
  size_t println(const char* = "") { return 0; }
  size_t printf(const char*, ...) __attribute__((format(printf, 2, 3))) { return 0; }
};
class Stream : public Print { public: virtual int available() { return 0; } virtual int read() { return -1; } };
class HardwareSerial : public Stream { public: void begin(unsigned long, uint32_t = SERIAL_8N1, int8_t = -1, int8_t = -1) {} };
extern HardwareSerial Serial, Serial1;
uint32_t millis(); uint32_t micros(); void delay(uint32_t); void delayMicroseconds(uint32_t);
void pinMode(uint8_t, uint8_t); void digitalWrite(uint8_t, uint8_t);
uint32_t analogReadMilliVolts(uint8_t); void analogReadResolution(uint8_t); void analogSetPinAttenuation(uint8_t, adc_attenuation_t);
int digitalPinToInterrupt(int); void attachInterrupt(uint8_t, void (*)(void), int);
uint32_t ledcSetup(uint8_t, uint32_t, uint8_t); void ledcAttachPin(uint8_t, uint8_t); void ledcWrite(uint8_t, uint32_t);
// FreeRTOS
typedef void* SemaphoreHandle_t; typedef uint32_t TickType_t; typedef int BaseType_t;
#define portMAX_DELAY 0xffffffffu
#define pdMS_TO_TICKS(x) ((TickType_t)(x))
SemaphoreHandle_t xSemaphoreCreateMutex(); BaseType_t xSemaphoreTake(SemaphoreHandle_t, TickType_t); BaseType_t xSemaphoreGive(SemaphoreHandle_t);
void vTaskDelay(TickType_t); TickType_t xTaskGetTickCount(); void vTaskDelayUntil(TickType_t*, TickType_t);
BaseType_t xTaskCreatePinnedToCore(void (*)(void*), const char*, uint32_t, void*, unsigned, void**, int);
