#include "sensors.h"

#include <Arduino.h>
#include <DallasTemperature.h>
#include <OneWire.h>
#include <Wire.h>
#include <initializer_list>
#include <string.h>

#include "config.h"

using namespace cfg;

namespace {

// ---------------------------------------------------------------- shared state
SemaphoreHandle_t lock;                   // guards `slow`
SemaphoreHandle_t i2c;                    // guards the I²C bus (sensor task vs. the SCAN command)
rig::Measured slow;                       // written by the task, copied by the control loop
volatile uint32_t tachCount[3] = {0, 0, 0};
uint32_t tachLastMs = 0;
float rpm[3] = {NAN, NAN, NAN};
float ctZero[3] = {2.5f, 2.5f, 2.5f};     // ACS712 output at 0 A, volts (before the divider)

OneWire owA(PIN_OW_A), owB(PIN_OW_B);
DallasTemperature dsA(&owA), dsB(&owB);

void IRAM_ATTR tach0() { tachCount[0]++; }
void IRAM_ATTR tach1() { tachCount[1]++; }
void IRAM_ATTR tach2() { tachCount[2]++; }

// ---------------------------------------------------------------- I²C helpers
bool muxSelect(uint8_t ch) {
  Wire.beginTransmission(TCA_ADDR);
  Wire.write((uint8_t)(1u << ch));
  return Wire.endTransmission() == 0;
}
// Sensirion CRC-8: polynomial 0x31, init 0xFF (SHT31, SDP810, SPS30)
uint8_t crc8(const uint8_t* d, int n) {
  uint8_t c = 0xFF;
  for (int i = 0; i < n; i++) {
    c ^= d[i];
    for (int b = 0; b < 8; b++) c = (c & 0x80) ? (uint8_t)((c << 1) ^ 0x31) : (uint8_t)(c << 1);
  }
  return c;
}
bool cmd16(uint8_t addr, uint16_t cmd) {
  Wire.beginTransmission(addr);
  Wire.write((uint8_t)(cmd >> 8));
  Wire.write((uint8_t)(cmd & 0xFF));
  return Wire.endTransmission() == 0;
}
// read n bytes made of (2 data + 1 CRC) words; returns false on a CRC error
bool readWords(uint8_t addr, uint8_t* out, int words) {
  int n = words * 3;
  if (Wire.requestFrom((int)addr, n) != n) return false;
  for (int w = 0; w < words; w++) {
    uint8_t b[3] = {(uint8_t)Wire.read(), (uint8_t)Wire.read(), (uint8_t)Wire.read()};
    if (crc8(b, 2) != b[2]) return false;
    out[2 * w] = b[0];
    out[2 * w + 1] = b[1];
  }
  return true;
}

// ---------------------------------------------------------------- SHT31 (single shot, high repeatability)
bool sht31Read(uint8_t ch, float& T, float& RH) {
  if (!muxSelect(ch) || !cmd16(SHT31_ADDR, 0x2400)) return false;
  vTaskDelay(pdMS_TO_TICKS(16));
  uint8_t d[4];
  if (!readWords(SHT31_ADDR, d, 2)) return false;
  uint16_t st = (d[0] << 8) | d[1], srh = (d[2] << 8) | d[3];
  T = -45.0f + 175.0f * st / 65535.0f;
  RH = 100.0f * srh / 65535.0f;
  return true;
}

// ---------------------------------------------------------------- SDP810 (continuous, dP averaged till read)
bool sdpStart(uint8_t ch) { return muxSelect(ch) && cmd16(SDP810_ADDR, 0x3615); }
bool sdpRead(uint8_t ch, float& dp) {
  if (!muxSelect(ch)) return false;
  uint8_t d[6];
  if (!readWords(SDP810_ADDR, d, 3)) return false;
  int16_t raw = (int16_t)((d[0] << 8) | d[1]);
  int16_t scale = (int16_t)((d[4] << 8) | d[5]);   // 240 /Pa (125 Pa type), 60 /Pa (500 Pa type)
  if (scale <= 0) return false;
  dp = (float)raw / scale;
  return true;
}

// ---------------------------------------------------------------- SPS30 (I²C, IEEE754 float output)
bool spsStart(uint8_t ch) {
  if (!muxSelect(ch)) return false;
  uint8_t arg[2] = {0x03, 0x00};
  Wire.beginTransmission(SPS30_ADDR);
  Wire.write(0x00); Wire.write(0x10);
  Wire.write(arg[0]); Wire.write(arg[1]); Wire.write(crc8(arg, 2));
  return Wire.endTransmission() == 0;
}
// returns number concentrations ≥0.5 µm and ≥5 µm in particles per m³
bool spsRead(uint8_t ch, float& ge05, float& ge5) {
  if (!muxSelect(ch) || !cmd16(SPS30_ADDR, 0x0202)) return false;
  uint8_t r[2];
  if (!readWords(SPS30_ADDR, r, 1) || r[1] != 1) return false;      // data not ready yet
  if (!cmd16(SPS30_ADDR, 0x0300)) return false;
  uint8_t d[40];
  if (!readWords(SPS30_ADDR, d, 20)) return false;                   // 10 floats
  float v[10];
  for (int i = 0; i < 10; i++) {
    uint32_t u = ((uint32_t)d[4 * i] << 24) | ((uint32_t)d[4 * i + 1] << 16) | ((uint32_t)d[4 * i + 2] << 8) | d[4 * i + 3];
    memcpy(&v[i], &u, 4);
  }
  // v[4..8] = NC0.5, NC1.0, NC2.5, NC4.0, NC10 (cumulative from 0.3 µm, particles per cm³)
  ge05 = fmaxf(0, v[8] - v[4]) * 1e6f;
  ge5 = fmaxf(0, v[8] - v[7]) * SPS_GE5_FRACTION * 1e6f;
  return true;
}

// ---------------------------------------------------------------- DS18B20
bool romSet(const uint8_t* r) { for (int i = 0; i < 8; i++) if (r[i]) return true; return false; }
float dsTemp(DallasTemperature& bus, const uint8_t* rom, int index) {
  float t = romSet(rom) ? bus.getTempC(rom) : bus.getTempCByIndex(index);
  return (t == DEVICE_DISCONNECTED_C || t < -55.0f || t > 125.0f) ? NAN : t;
}

// ---------------------------------------------------------------- background task
void sensorTask(void*) {
  xSemaphoreTake(i2c, portMAX_DELAY);
  sdpStart(MUX_SDP_ROOM);
  sdpStart(MUX_SDP_HEPA);
  spsStart(MUX_SPS_ROOM);
  spsStart(MUX_SPS_FILL);
  spsStart(MUX_SPS_EXH);
  xSemaphoreGive(i2c);
  dsA.requestTemperatures();
  dsB.requestTemperatures();
  TickType_t last = xTaskGetTickCount();
  uint32_t dsT = millis();
  for (;;) {
    rig::Measured n;
    float t, rh, dp, a = NAN, b = NAN, a2 = NAN, b2 = NAN, a3 = NAN, b3 = NAN;
    xSemaphoreTake(i2c, portMAX_DELAY);
    if (sht31Read(MUX_SHT_FRESH, t, rh)) { n.TT101 = t; n.MT101 = rh; }
    if (sht31Read(MUX_SHT_SUPPLY, t, rh)) { n.TT105 = t; n.MT105 = rh; }
    if (sht31Read(MUX_SHT_ROOM, t, rh)) { n.TT106 = t; n.MT106 = rh; }
    if (sdpRead(MUX_SDP_ROOM, dp)) n.PDT101 = dp;
    if (sdpRead(MUX_SDP_HEPA, dp)) n.PDT102 = dp;
    // 1-Wire: conversions take 750 ms at 12 bit; read the last result, then start the next one
    if (millis() - dsT >= 800) {
      n.TT109 = dsTemp(dsA, ROM_TT109, 0); n.TT103 = dsTemp(dsA, ROM_TT103, 1); n.TT104 = dsTemp(dsA, ROM_TT104, 2);
      n.TT107 = dsTemp(dsB, ROM_TT107, 0); n.TT108 = dsTemp(dsB, ROM_TT108, 1);
      dsA.requestTemperatures(); dsB.requestTemperatures(); dsT = millis();
    }
    bool room = spsRead(MUX_SPS_ROOM, a, b);
    bool fill = spsRead(MUX_SPS_FILL, a2, b2);
    bool exh = spsRead(MUX_SPS_EXH, a3, b3);
    xSemaphoreGive(i2c);
    xSemaphoreTake(lock, portMAX_DELAY);
    // keep the previous value where this pass had nothing new (1-Wire every other pass, SPS30 once a second)
    auto upd = [](float& dst, float src) { if (!isnan(src)) dst = src; };
    upd(slow.TT101, n.TT101); upd(slow.MT101, n.MT101); upd(slow.TT105, n.TT105); upd(slow.MT105, n.MT105);
    upd(slow.TT106, n.TT106); upd(slow.MT106, n.MT106); upd(slow.PDT101, n.PDT101); upd(slow.PDT102, n.PDT102);
    upd(slow.TT109, n.TT109); upd(slow.TT103, n.TT103); upd(slow.TT104, n.TT104); upd(slow.TT107, n.TT107); upd(slow.TT108, n.TT108);
    if (room) { slow.PT101 = a; slow.PT101R5 = b; }
    if (fill) { slow.PT101A = a2; slow.PT101A5 = b2; }
    if (exh) slow.PT102 = a3;
    xSemaphoreGive(lock);
    vTaskDelayUntil(&last, pdMS_TO_TICKS(SENSOR_MS));
  }
}

// ---------------------------------------------------------------- ADC
float adcV(int pin, int n = 32) {
  uint32_t mv = 0;
  for (int i = 0; i < n; i++) mv += analogReadMilliVolts(pin);
  return mv / 1000.0f / n;
}
float d6fFlow(float v, float dia, float kp) {         // m³/h from the D6F output voltage
  float ms;
  if (v <= D6F_V[0]) ms = 0;
  else if (v >= D6F_V[D6F_N - 1]) ms = D6F_MS[D6F_N - 1];
  else {
    int i = 1;
    while (i < D6F_N - 1 && v > D6F_V[i]) i++;
    ms = D6F_MS[i - 1] + (D6F_MS[i] - D6F_MS[i - 1]) * (v - D6F_V[i - 1]) / (D6F_V[i] - D6F_V[i - 1]);
  }
  return kp * ms * 3.14159265f * dia * dia / 4.0f * 3600.0f;
}
float ctAmps(int pin, int k) { return (adcV(pin) / CT_DIV - ctZero[k]) / CT_SENS_V_PER_A; }

}  // namespace

namespace sensors {

void begin() {
  lock = xSemaphoreCreateMutex();
  i2c = xSemaphoreCreateMutex();
  Wire.begin(PIN_SDA, PIN_SCL, 100000);
  dsA.begin(); dsB.begin();
  dsA.setResolution(12); dsB.setResolution(12);
  dsA.setWaitForConversion(false); dsB.setWaitForConversion(false);
  analogReadResolution(12);
  for (int p : {PIN_FT101, PIN_FT102, PIN_CT101, PIN_CT102, PIN_CT103, PIN_VT101}) analogSetPinAttenuation(p, ADC_11db);
  pinMode(PIN_FAN101_TACH, INPUT_PULLUP); pinMode(PIN_FAN102_TACH, INPUT_PULLUP); pinMode(PIN_FAN103_TACH, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(PIN_FAN101_TACH), tach0, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_FAN102_TACH), tach1, FALLING);
  attachInterrupt(digitalPinToInterrupt(PIN_FAN103_TACH), tach2, FALLING);
  tachLastMs = millis();
  xTaskCreatePinnedToCore(sensorTask, "sensors", 6144, nullptr, 1, nullptr, 0);   // core 0; control runs on core 1
}

void readFast(rig::Measured& m) {
  m.FT101 = d6fFlow(adcV(PIN_FT101), FT101_D_M, FT101_KP);
  m.FT102 = d6fFlow(adcV(PIN_FT102), FT102_D_M, FT102_KP);
  m.CT101 = ctAmps(PIN_CT101, 0);
  m.CT102 = ctAmps(PIN_CT102, 1);
  m.CT103 = ctAmps(PIN_CT103, 2);
  m.VT101 = adcV(PIN_VT101, 8) * VT_RATIO;
  uint32_t now = millis();
  if (now - tachLastMs >= 1000) {                     // 2 pulses per revolution
    float s = (now - tachLastMs) / 1000.0f;
    for (int i = 0; i < 3; i++) { rpm[i] = tachCount[i] / 2.0f / s * 60.0f; tachCount[i] = 0; }
    tachLastMs = now;
  }
  m.rpm101 = rpm[0]; m.rpm102 = rpm[1]; m.rpm103 = rpm[2];
}

void copySlow(rig::Measured& m) {
  xSemaphoreTake(lock, portMAX_DELAY);
  m.TT101 = slow.TT101; m.MT101 = slow.MT101; m.TT109 = slow.TT109; m.TT103 = slow.TT103; m.TT104 = slow.TT104;
  m.TT105 = slow.TT105; m.MT105 = slow.MT105; m.PDT101 = slow.PDT101; m.PDT102 = slow.PDT102;
  m.TT106 = slow.TT106; m.MT106 = slow.MT106; m.TT107 = slow.TT107; m.TT108 = slow.TT108;
  m.PT101 = slow.PT101; m.PT101R5 = slow.PT101R5; m.PT101A = slow.PT101A; m.PT101A5 = slow.PT101A5;
  m.PT102 = slow.PT102;
  xSemaphoreGive(lock);
}

void zeroCurrents() {
  ctZero[0] = adcV(PIN_CT101, 256) / CT_DIV;
  ctZero[1] = adcV(PIN_CT102, 256) / CT_DIV;
  ctZero[2] = adcV(PIN_CT103, 256) / CT_DIV;
}

void scan(Print& out) {
  DeviceAddress a;
  for (int bus = 0; bus < 2; bus++) {
    DallasTemperature& d = bus ? dsB : dsA;
    out.printf("1-Wire %c: %d device(s)\n", bus ? 'B' : 'A', d.getDeviceCount());
    for (int i = 0; i < d.getDeviceCount(); i++) {
      if (!d.getAddress(a, i)) continue;
      out.printf("  [%d] {", i);
      for (int k = 0; k < 8; k++) out.printf("0x%02X%s", a[k], k < 7 ? "," : "}\n");
    }
  }
  xSemaphoreTake(i2c, portMAX_DELAY);
  for (uint8_t ch = 0; ch < 8; ch++) {
    if (!muxSelect(ch)) { out.println("TCA9548A not answering at 0x70"); break; }
    out.printf("mux ch%u:", ch);
    for (uint8_t ad = 0x08; ad < 0x78; ad++) {
      if (ad == TCA_ADDR) continue;
      Wire.beginTransmission(ad);
      if (Wire.endTransmission() == 0) out.printf(" 0x%02X", ad);
    }
    out.println();
  }
  xSemaphoreGive(i2c);
}

}  // namespace sensors
