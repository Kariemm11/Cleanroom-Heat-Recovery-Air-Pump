// Actuator drivers: PWM fans, DV-101 diverter, compressor speed (0–5 V), 4-way valve, EEV stepper,
// PTC reheat and steam humidifier.
#pragma once
#include "control.h"

namespace actuators {
void begin();                          // outputs to a safe state, home the EEV
void apply(const rig::Outputs& u);     // write the commands (0…1) to the hardware
void service();                        // call as often as possible: steps the EEV
void allOff();
}  // namespace actuators
