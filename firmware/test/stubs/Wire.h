#pragma once
#include "Arduino.h"
class TwoWire : public Stream {
 public:
  bool begin(int sda, int scl, uint32_t freq) { return true; }
  void beginTransmission(uint16_t) {}
  size_t write(uint8_t) override { return 1; }
  uint8_t endTransmission(bool = true) { return 0; }
  uint8_t requestFrom(int, int) { return 0; }
  int read() override { return 0; }
};
extern TwoWire Wire;
