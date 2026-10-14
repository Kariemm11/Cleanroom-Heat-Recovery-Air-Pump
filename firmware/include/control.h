// Rig controller: plain C++ (no Arduino dependencies), so it can be unit-tested on a PC.
// The loops, sequencing and alarms mirror the simulator's model (assets/js/rig-model.js);
// the equations are in build-pack/07-engineering-calculations.md §8–9.
#pragma once
#include <math.h>
#include <stdint.h>

namespace rig {

constexpr float RHO = 1.2f, CP = 1006.0f, HFG = 2501e3f, PATM = 101325.0f;

// ------------------------------------------------------------ psychrometrics
inline float clampf(float v, float lo, float hi) { return v < lo ? lo : (v > hi ? hi : v); }
inline float psat(float T) { return 610.94f * expf(17.625f * T / (T + 243.04f)); }
inline float wFromRH(float T, float rh) { float pv = clampf(rh, 0, 100) / 100.0f * psat(T); return 0.622f * pv / (PATM - pv); }
inline float rhFromW(float T, float w) { float pv = w * PATM / (0.622f + w); return clampf(100.0f * pv / psat(T), 0, 100); }
inline float dewPoint(float w) { float pv = fmaxf(1.0f, w * PATM / (0.622f + w)), a = logf(pv / 610.94f); return 243.04f * a / (17.625f - a); }
inline float capRate(float qM3h) { return qM3h * RHO * CP / 3600.0f; }   // W/K
inline bool ok(float v) { return !isnan(v); }

// ------------------------------------------------------------ PI with clamping anti-windup
struct PI {
  const char* name = "";
  float kp = 1, ti = 10, lo = 0, hi = 1;
  float i = 0, out = 0, e = 0, mv = 0;
  bool man = false;
  void init(const char* n, float Kp, float Ti, float Lo, float Hi) { name = n; kp = Kp; ti = Ti; lo = Lo; hi = Hi; }
  float run(float err, float dt) {
    e = err;
    if (man) { out = clampf(mv, lo, hi); i = out - kp * err; return out; }   // bumpless back to auto
    i = clampf(i + kp * err * dt / ti, lo, hi);
    out = clampf(kp * err + i, lo, hi);
    return out;
  }
  void hold() {}   // keep the last output (sensor fault)
};

enum class Season : uint8_t { Winter = 0, Summer = 1 };

struct SeasonSP { float coil, sup; };
struct Setpoints {
  float flow = 6.0f;          // supply airflow, m³/h (100 % fresh air, once through)
  float rh = 45.0f;           // room RH, %
  float dp = 15.0f;           // room pressure, Pa
  float pxTrip = 1000.0f;     // PT-102 exhaust particles ≥0.5 µm that throw DV-101 to the outer HEPA, /m³
  float pxReset = 300.0f;     // … and the level it must stay below for 60 s before it goes back to the air pump
  SeasonSP winter{21, 22};
  SeasonSP summer{12, 16};
  float ef = 0.50f;           // grid emission factor, kg CO₂/kWh
  float copBase = 2.8f;       // baseline chiller COP
  float ctrlW = 3.5f;         // controller + HMI not on a CT channel, W
  float humRatedW = 33.75f;   // humidifier heater at 100 %, W (45 g/h × 0.75 Wh/g)
};

// measured values in engineering units; NaN = sensor missing or faulty
struct Measured {
  float TT101 = NAN, MT101 = NAN, FT101 = NAN, TT109 = NAN, TT103 = NAN, TT104 = NAN, TT105 = NAN, MT105 = NAN;
  float FT102 = NAN, PDT101 = NAN, PDT102 = NAN, TT106 = NAN, MT106 = NAN, TT107 = NAN, TT108 = NAN;
  float CT101 = NAN, CT102 = NAN, CT103 = NAN, VT101 = NAN;
  float PT101 = NAN, PT101R5 = NAN, PT101A = NAN, PT101A5 = NAN;   // particles /m³ (≥0.5, ≥5 µm)
  float PT102 = NAN;                                                // exhaust particles ≥0.5 µm before DV-101, /m³
  float rpm101 = NAN, rpm102 = NAN, rpm103 = NAN;
};

// actuator commands, 0…1 (after slew limits and interlocks)
// dv: DV-101 exhaust diverter, 0 = to the air pump (actuator energised), 1 = to the outer BIBO HEPA (spring return)
struct Outputs {
  float fa = 0, sf = 0, ef = 0, dv = 1, cmp = 0, rh = 0, hum = 0;
  bool rvCooling = false;     // 4-way valve energised = cooling mode
  int eevSteps = 0;           // EEV target position
};

enum AlarmId { A01, A02, A03, A04, A05, A06, A07, A08, A09, A10, A11, A12, A13, A14, ALARM_COUNT };
struct AlarmDef { const char* id; const char* text; float delay; bool serious; };
extern const AlarmDef ALARMS[ALARM_COUNT];

struct Kpi {
  float ach = 0, P = 0, Pbase = 0, saving = 0, co2h = 0, co2hBase = 0, f = 0;
  float coilSP = 0;
  const char* roomGrade = "-";
  const char* fillGrade = "-";
};

class Controller {
 public:
  Setpoints sp;
  Season season = Season::Winter;
  bool on = true, recovery = true;
  PI L[7];                    // L1 … L7 (index 0 … 6)
  Outputs u;                  // commands after slew + interlocks
  Kpi k;
  double Ewh = 0, EwhBase = 0, co2g = 0, co2gBase = 0, runS = 0;
  bool alarm[ALARM_COUNT] = {};
  float alarmT[ALARM_COUNT] = {};
  bool frost = false;
  bool diverted = true;       // DV-101 on the HEPA bypass (starts there until the exhaust is proven clean)

  Controller();
  void setSeason(Season s);                 // sequenced: compressor off, wait, then switch the valve
  void step(const Measured& m, float dt);   // call every 100 ms
  void resetEnergy() { Ewh = EwhBase = co2g = co2gBase = runS = 0; }
  const SeasonSP& seasonSP() const { return season == Season::Winter ? sp.winter : sp.summer; }
  int activeAlarms() const { int n = 0; for (bool a : alarm) n += a; return n; }

 private:
  Season pendingSeason = Season::Winter;
  float cmpOffS = 1e9f, cmpOnS = 0, rvHoldS = 0;
  bool cmpRunning = false;
  float tripS = 0, holdS = 0; // PT-102 time above the trip level / below the reset level
  void alarms(const Measured& m, float dt);
  void energy(const Measured& m, float dt);
};

const char* gradeOf(float c05, float c5);

}  // namespace rig
