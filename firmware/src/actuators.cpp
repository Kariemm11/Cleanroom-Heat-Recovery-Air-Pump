#include "actuators.h"

#include <Arduino.h>

#include <initializer_list>

#include "config.h"

using namespace cfg;

namespace {

// LEDC wrapper for Arduino-ESP32 core 2.x (channel API) and 3.x (pin API)
struct Pwm { int pin, ch; uint32_t hz; uint8_t bits; };
const Pwm FAN101{PIN_FAN101_PWM, 0, FAN_PWM_HZ, FAN_PWM_BITS};
const Pwm FAN102{PIN_FAN102_PWM, 1, FAN_PWM_HZ, FAN_PWM_BITS};
const Pwm FAN103{PIN_FAN103_PWM, 2, FAN_PWM_HZ, FAN_PWM_BITS};
const Pwm SERVO{PIN_SV101, 3, SERVO_HZ, SERVO_BITS};
const Pwm CMP{PIN_CMP101, 4, CMP_PWM_HZ, CMP_PWM_BITS};
const Pwm HTR{PIN_HTR101, 5, HEAT_PWM_HZ, HEAT_PWM_BITS};
const Pwm HUM{PIN_HUM101, 6, HEAT_PWM_HZ, HEAT_PWM_BITS};

void pwmSetup(const Pwm& p) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(p.pin, p.hz, p.bits);
#else
  ledcSetup(p.ch, p.hz, p.bits);
  ledcAttachPin(p.pin, p.ch);
#endif
}
void pwmWrite(const Pwm& p, float duty01) {
  uint32_t top = (1u << p.bits) - 1, d = (uint32_t)lroundf(rig::clampf(duty01, 0, 1) * top);
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(p.pin, d);
#else
  ledcWrite(p.ch, d);
#endif
}
void fanWrite(const Pwm& p, float u) { pwmWrite(p, FAN_PWM_INVERTED ? 1.0f - u : u); }
void servoWrite(float u) {                          // u: 0 = recirculation, 1 = full fresh air
  float deg = rig::clampf(u, 0, 1) * DAMPER_DEG_FULL;
  float us = SERVO_US_0 + (SERVO_US_180 - SERVO_US_0) * deg / 180.0f;
  pwmWrite(SERVO, us / (1e6f / SERVO_HZ));
}

// EEV: non-blocking stepping toward a target position
volatile int eevPos = 0;
int eevTarget = 0;
uint32_t eevLastUs = 0;
bool eevHomed = false;

}  // namespace

namespace actuators {

void begin() {
  for (const Pwm* p : {&FAN101, &FAN102, &FAN103, &SERVO, &CMP, &HTR, &HUM}) pwmSetup(*p);
  pinMode(PIN_RV101, OUTPUT);
  pinMode(PIN_EEV_STEP, OUTPUT);
  pinMode(PIN_EEV_DIR, OUTPUT);
  allOff();
  // home the EEV: over-drive closed so the position counter starts at a known 0
  digitalWrite(PIN_EEV_DIR, LOW);
  for (int i = 0; i < EEV_HOME_OVERDRIVE; i++) {
    digitalWrite(PIN_EEV_STEP, HIGH); delayMicroseconds(20);
    digitalWrite(PIN_EEV_STEP, LOW); delayMicroseconds(EEV_STEP_US - 20);
  }
  eevPos = 0; eevTarget = 0; eevHomed = true;
}

void allOff() {
  fanWrite(FAN101, 0); fanWrite(FAN102, 0); fanWrite(FAN103, 0);
  servoWrite(0);
  pwmWrite(CMP, 0); pwmWrite(HTR, 0); pwmWrite(HUM, 0);
  digitalWrite(PIN_RV101, LOW);
  eevTarget = 0;
}

void apply(const rig::Outputs& u) {
  fanWrite(FAN101, u.fa);
  fanWrite(FAN102, u.sf);
  fanWrite(FAN103, u.ef);
  servoWrite(u.dmp);
  // 0–3.3 V PWM → RC filter → LM358 gain 1.5 → 0–5 V speed input; 0 = compressor off
  pwmWrite(CMP, u.cmp >= CMP_MIN_U ? u.cmp : 0.0f);
  pwmWrite(HTR, u.rh);
  pwmWrite(HUM, u.hum);
  digitalWrite(PIN_RV101, u.rvCooling ? HIGH : LOW);
  eevTarget = u.eevSteps < 0 ? 0 : (u.eevSteps > EEV_STEPS_FULL ? EEV_STEPS_FULL : u.eevSteps);
}

void service() {
  if (!eevHomed || eevPos == eevTarget) return;
  uint32_t now = micros();
  if (now - eevLastUs < EEV_STEP_US) return;
  eevLastUs = now;
  bool open = eevTarget > eevPos;
  digitalWrite(PIN_EEV_DIR, open ? HIGH : LOW);
  delayMicroseconds(1);                             // DIR set-up time ≥ 650 ns
  digitalWrite(PIN_EEV_STEP, HIGH);
  delayMicroseconds(4);                             // DRV8825 needs ≥ 1.9 µs high
  digitalWrite(PIN_EEV_STEP, LOW);
  eevPos += open ? 1 : -1;
}

}  // namespace actuators
