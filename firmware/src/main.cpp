// Clean-room heat-recovery air-pump rig: ESP32-S3 controller.
//   core 1 (Arduino loop): 100 ms control step, actuator writes, EEV stepping, commands, telemetry
//   core 0 (sensor task):  I²C sensors behind the TCA9548A, 1-Wire probes, SPS30 particle counters
#include <Arduino.h>

#include "actuators.h"
#include "comms.h"
#include "config.h"
#include "control.h"
#include "sensors.h"

static rig::Controller ctl;
static rig::Measured meas;

void setup() {
  Serial.begin(115200);
  Serial1.begin(115200, SERIAL_8N1, cfg::PIN_HMI_RX, cfg::PIN_HMI_TX);
  delay(300);
  Serial.println("# clean-room rig controller starting");
  actuators::begin();                    // everything off, EEV homed
  comms::loadSettings(ctl);
  sensors::begin();
  delay(1500);                           // sensors settle, loads still off
  sensors::zeroCurrents();
  sensors::scan(Serial);                 // prints the 1-Wire ROM codes and the I²C devices per mux channel
  Serial.println("# ready. HELP for commands");
}

void loop() {
  static uint32_t tCtl = millis(), tTel = 0, tHmi = 0;
  const uint32_t now = millis();
  if (now - tCtl >= cfg::CONTROL_MS) {
    const float dt = fminf((now - tCtl) / 1000.0f, 0.5f);
    tCtl = now;
    sensors::readFast(meas);
    sensors::copySlow(meas);
    ctl.step(meas, dt);
    actuators::apply(ctl.u);
  }
  actuators::service();
  comms::poll(ctl, Serial, Serial1);
  if (now - tTel >= cfg::TELEMETRY_MS) { tTel = now; comms::telemetry(Serial, ctl, meas); }
  if (now - tHmi >= cfg::HMI_MS) { tHmi = now; comms::hmi(Serial1, ctl, meas); }
}
