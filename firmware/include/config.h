// Clean-room heat-recovery air-pump rig: hardware map and calibration.
// Pins match the HMI's Sensors screen, the wiring diagram and build-pack/02-io-list.csv.
#pragma once
#include <stdint.h>

namespace cfg {

// ---------------------------------------------------------------- buses
constexpr int PIN_SDA = 8, PIN_SCL = 9;            // I²C to the TCA9548A mux (0x70), 100 kHz
constexpr uint8_t TCA_ADDR = 0x70;
constexpr int PIN_OW_A = 15;                       // 1-Wire A: TT-102, TT-103, TT-104 (4.7 k pull-up to 3.3 V)
constexpr int PIN_OW_B = 16;                       // 1-Wire B: TT-107, TT-108
constexpr int PIN_HMI_TX = 17, PIN_HMI_RX = 18;    // UART1 to HMI-101 (7" serial HMI), 115200 8N1

// I²C mux channels (every channel has its own SDA/SCL pair on the PCB)
constexpr uint8_t MUX_SHT_FRESH = 0;   // TT-101 / MT-101  SHT31 0x44
constexpr uint8_t MUX_SHT_SUPPLY = 1;  // TT-105 / MT-105  SHT31 0x44
constexpr uint8_t MUX_SDP_ROOM = 2;    // PDT-101          SDP810-125Pa 0x25
constexpr uint8_t MUX_SDP_HEPA = 3;    // PDT-102          SDP810-500Pa 0x25
constexpr uint8_t MUX_SHT_ROOM = 4;    // TT-106 / MT-106  SHT31 0x44
constexpr uint8_t MUX_SPS_ROOM = 5;    // PT-101  room     SPS30 0x69
constexpr uint8_t MUX_SPS_FILL = 6;    // PT-101A fill pt  SPS30 0x69
constexpr uint8_t SHT31_ADDR = 0x44, SDP810_ADDR = 0x25, SPS30_ADDR = 0x69;

// ---------------------------------------------------------------- analogue inputs (ADC1)
constexpr int PIN_FT101 = 1;    // D6F-W04A1 fresh-air header (0.5–2.5 V)
constexpr int PIN_FT102 = 2;    // D6F-W04A1 supply riser
constexpr int PIN_CT101 = 4;    // ACS712-05B compressor (through 10 k / 20 k divider)
constexpr int PIN_CT102 = 5;    // ACS712-05B fans
constexpr int PIN_CT103 = 6;    // ACS712-05B PTC + humidifier
constexpr int PIN_VT101 = 7;    // 24 V bus through 100 k / 10 k

// ---------------------------------------------------------------- outputs
constexpr int PIN_FAN101_PWM = 38, PIN_FAN101_TACH = 10;   // fresh-air compressor (blower)
constexpr int PIN_FAN102_PWM = 39, PIN_FAN102_TACH = 11;   // supply fan
constexpr int PIN_FAN103_PWM = 40, PIN_FAN103_TACH = 12;   // exhaust fans (2, PWM in parallel)
constexpr int PIN_SV101 = 21;                              // mixing-damper servo, 50 Hz
constexpr int PIN_CMP101 = 41;                             // compressor speed: PWM → RC → LM358 ×1.5 → 0–5 V
constexpr int PIN_RV101 = 42;                              // 4-way valve coil MOSFET (high = cooling)
constexpr int PIN_EEV_STEP = 13, PIN_EEV_DIR = 14;         // DRV8825 (EN tied low, SLEEP/RESET high)
constexpr int PIN_HTR101 = 47;                             // PTC reheat MOSFET
constexpr int PIN_HUM101 = 48;                             // steam humidifier heater MOSFET
// Note: on ESP32-S3-DevKitC-1 v1.1 the on-board RGB LED is on GPIO38; it will flicker with FAN-101's PWM. Harmless.

// PWM settings
constexpr uint32_t FAN_PWM_HZ = 25000;   // 4-wire fan standard
constexpr uint8_t FAN_PWM_BITS = 10;
constexpr bool FAN_PWM_INVERTED = true;  // the PCB drives the fans' PWM inputs through open-drain N-MOSFETs
constexpr uint32_t CMP_PWM_HZ = 20000;
constexpr uint8_t CMP_PWM_BITS = 10;
constexpr uint32_t HEAT_PWM_HZ = 1000;   // PTC and humidifier heater
constexpr uint8_t HEAT_PWM_BITS = 10;
constexpr uint32_t SERVO_HZ = 50;
constexpr uint8_t SERVO_BITS = 14;
constexpr float SERVO_US_0 = 500.0f, SERVO_US_180 = 2500.0f;   // MG996R
constexpr float DAMPER_DEG_FULL = 90.0f;                       // 0 = recirculation, 90° = full fresh air
constexpr float CMP_MIN_U = 0.30f;       // compressor driver minimum speed (below this the compressor is off)

// EEV
constexpr int EEV_STEPS_FULL = 500, EEV_HOME_OVERDRIVE = 560;
constexpr uint32_t EEV_STEP_US = 5000;   // 200 steps/s
constexpr int EEV_BASE_STEPS = 80, EEV_SPAN_STEPS = 400;      // feed-forward: steps = base + span · u_cmp

// ---------------------------------------------------------------- calibration
// D6F-W04A1: output voltage → air velocity. Fill from the datasheet curve, then calibrate in place
// against a reference (see build-pack/08-build-and-commissioning.md §5).
constexpr int D6F_N = 6;
constexpr float D6F_V[D6F_N] = {0.50f, 1.00f, 1.40f, 1.80f, 2.15f, 2.50f};   // V   (TO CALIBRATE)
constexpr float D6F_MS[D6F_N] = {0.00f, 0.50f, 1.10f, 2.00f, 3.00f, 4.00f};  // m/s (TO CALIBRATE)
constexpr float FT101_D_M = 0.023f, FT102_D_M = 0.028f;     // duct diameters at the sensors
constexpr float FT101_KP = 0.82f, FT102_KP = 0.82f;         // centre-line → mean velocity (calibrate)

// ACS712-05B: 185 mV/A at 5 V, through a 10 k (top) / 20 k (bottom) divider
constexpr float CT_DIV = 20.0f / 30.0f, CT_SENS_V_PER_A = 0.185f;
constexpr float VT_RATIO = 11.0f;                           // 100 k / 10 k

// 1-Wire ROM codes. Leave all zero to map by bus order; the firmware prints the found codes at boot
// ("SCAN" command) so they can be pasted here, which makes the mapping independent of bus order.
constexpr uint8_t ROM_TT102[8] = {0}, ROM_TT103[8] = {0}, ROM_TT104[8] = {0};
constexpr uint8_t ROM_TT107[8] = {0}, ROM_TT108[8] = {0};

// SPS30 conversion: ≥5 µm share of the 4–10 µm bin for a D⁻³ size distribution
constexpr float SPS_GE5_FRACTION = 0.57f;

// ---------------------------------------------------------------- rig constants
constexpr float ROOM_V = 0.4925f * 0.490f * 0.395f;   // m³ (0.0953)
constexpr float HUM_W_RATED = 22.5f;                   // W at 100 % (30 g/h × 0.75 Wh/g)
constexpr float CTRL_W = 3.5f;                         // controller + HMI + sensors (not on a CT channel)

// timing
constexpr uint32_t CONTROL_MS = 100;      // PI loops
constexpr uint32_t SENSOR_MS = 500;       // I²C / 1-Wire / SPS30 task period
constexpr uint32_t TELEMETRY_MS = 1000;   // JSON on USB
constexpr uint32_t HMI_MS = 500;          // values to the HMI

// compressor protection
constexpr float CMP_MIN_OFF_S = 180.0f, CMP_MIN_ON_S = 120.0f, RV_SETTLE_S = 30.0f;

}  // namespace cfg
