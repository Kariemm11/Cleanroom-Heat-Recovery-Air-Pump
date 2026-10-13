// Sensor drivers. I²C devices (SHT31, SDP810, SPS30) sit behind a TCA9548A mux and are read by a
// FreeRTOS task every 500 ms; 1-Wire DS18B20 probes are read without blocking; the ADC inputs
// (D6F flow, ACS712 current, bus voltage) are oversampled from the control loop.
#pragma once
#include "control.h"

class Print;   // Arduino Print (global namespace)

namespace sensors {
void begin();                       // buses, sensors, start the background task
void readFast(rig::Measured& m);    // ADC channels + tach (call every 100 ms)
void copySlow(rig::Measured& m);    // latest values from the background task
void zeroCurrents();                // store the ACS712 zero (call with all loads off)
void scan(::Print& out);             // list 1-Wire ROM codes and I²C devices per mux channel
}  // namespace sensors
