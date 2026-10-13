#pragma once
#include "Arduino.h"
class Preferences {
 public:
  bool begin(const char*, bool = false) { return true; } void end() {}
  float getFloat(const char*, float d = 0) { return d; } size_t putFloat(const char*, float) { return 4; }
  uint8_t getUChar(const char*, uint8_t d = 0) { return d; } size_t putUChar(const char*, uint8_t) { return 1; }
  bool getBool(const char*, bool d = false) { return d; } size_t putBool(const char*, bool) { return 1; }
};
