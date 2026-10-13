#pragma once
#include "OneWire.h"
typedef uint8_t DeviceAddress[8];
#define DEVICE_DISCONNECTED_C -127
class DallasTemperature {
 public:
  explicit DallasTemperature(OneWire*) {}
  void begin() {} void setResolution(uint8_t) {} void setWaitForConversion(bool) {}
  void requestTemperatures() {} float getTempC(const uint8_t*, uint8_t = 0) { return 0; } float getTempCByIndex(uint8_t) { return 0; }
  uint8_t getDeviceCount() { return 0; } bool getAddress(uint8_t*, uint8_t) { return false; }
};
