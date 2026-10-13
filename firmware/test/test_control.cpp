// Host unit tests for the controller (no hardware). Build and run:
//   g++ -std=c++17 -O1 -Wall -Iinclude test/test_control.cpp src/control.cpp -o /tmp/test_control && /tmp/test_control
// A small first-order plant closes the loops, so the tests check the real control code end to end.
#include <math.h>
#include <stdio.h>
#include <string.h>

#include "control.h"

static int fails = 0, checks = 0;
#define CHECK(cond, ...)                                  \
  do {                                                    \
    checks++;                                             \
    if (!(cond)) { fails++; printf("FAIL: "); printf(__VA_ARGS__); printf("\n"); } \
  } while (0)

// a crude rig plant, enough to close every loop
struct Plant {
  float Qsup = 0, Qfa = 0, Qex = 0, Troom = 22, Toa = -2, RHoa = 80, wroom = 0.0075f, Tph = 22, Tcc = 22, Trh = 22;
  bool flowSensorStuck = false;
  void step(const rig::Outputs& u, rig::Measured& m, float dt, bool winter) {
    auto lag = [dt](float x, float t, float tau) { return x + (t - x) * (1 - expf(-dt / tau)); };
    Qsup = lag(Qsup, 18 * u.sf, 1.2f); Qfa = lag(Qfa, 12 * u.fa, 1.2f); Qex = lag(Qex, 12 * u.ef, 1.2f);
    float qfa = fminf(Qfa, Qsup), f = Qsup > 0.01f ? qfa / Qsup : 0;
    float imb = qfa - Qex, dp = (imb > 0 ? 1 : -1) * powf(imb / 0.13f, 2);
    dp = rig::clampf(dp, -150, 150);
    float T2 = Toa + 0.5f * (Troom - Toa);               // recovery cores, ε ≈ 0.5 overall
    float Tmix = f * T2 + (1 - f) * Troom, Cs = fmaxf(rig::capRate(Qsup), 1e-3f);
    Tph = lag(Tph, Tmix + (winter ? 45 * u.cmp : 0) / Cs, 3);
    Tcc = lag(Tcc, Tph - (winter ? 0 : 60 * u.cmp) / Cs, 3);
    Trh = lag(Trh, Tcc + 30 * u.rh / Cs + 0.15f, 3);
    Troom += dt * (Cs * (Trh - Troom) + 3 + 3 * (24 - Troom)) / 3000;
    float wsup = f * rig::wFromRH(Toa, RHoa) + (1 - f) * wroom + (Qsup > 0.05f ? 30 * u.hum / 1000 / (Qsup * 1.2f) : 0);
    wroom += dt * (Qsup * 1.2f / 3600 * (wsup - wroom) + 1.0f / 1000 / 3600) / 0.35f;
    m.FT102 = flowSensorStuck ? 0.2f : Qsup; m.FT101 = qfa; m.PDT101 = dp; m.PDT102 = 140 * powf(Qsup / 6, 1.6f) + 5;
    m.TT101 = Toa; m.MT101 = RHoa; m.TT102 = Tmix; m.TT103 = Tph; m.TT104 = Tcc; m.TT105 = Trh; m.MT105 = rig::rhFromW(Trh, wsup);
    m.TT106 = Troom; m.MT106 = rig::rhFromW(Troom, wroom); m.TT107 = Troom; m.TT108 = 2;
    m.VT101 = 24; m.CT101 = u.cmp * 0.5f; m.CT102 = 0.05f + u.sf * 0.3f + u.fa * 0.5f + u.ef * 0.2f; m.CT103 = u.rh * 1.25f + u.hum * 0.94f;
    m.PT101 = 120000; m.PT101R5 = 2400; m.PT101A = 1600; m.PT101A5 = 7;
    m.rpm101 = u.fa * 4000; m.rpm102 = u.sf * 4000; m.rpm103 = u.ef * 4000;
  }
};

static void runFor(rig::Controller& c, Plant& p, rig::Measured& m, float seconds, bool winter) {
  for (float t = 0; t < seconds; t += 0.1f) { p.step(c.u, m, 0.1f, winter); c.step(m, 0.1f); }
}

int main() {
  // --- psychrometrics against reference values
  CHECK(fabsf(rig::psat(20) - 2337) < 15, "psat(20 °C) = %.0f Pa, expected ≈2339", rig::psat(20));
  float w = rig::wFromRH(22, 45);
  CHECK(fabsf(w * 1000 - 7.47f) < 0.15f, "w(22 °C, 45 %%) = %.2f g/kg, expected ≈7.5", w * 1000);
  CHECK(fabsf(rig::rhFromW(22, w) - 45) < 0.01f, "RH round trip");
  CHECK(fabsf(rig::dewPoint(w) - 9.5f) < 0.3f, "dew point = %.2f °C, expected ≈9.5", rig::dewPoint(w));
  CHECK(!strcmp(rig::gradeOf(1600, 7), "A") && !strcmp(rig::gradeOf(122000, 2400), "B") && !strcmp(rig::gradeOf(5e5f, 4000), "C"), "grades");

  // --- winter: all loops settle
  {
    rig::Controller c; Plant p; rig::Measured m;
    runFor(c, p, m, 900, true);
    CHECK(fabsf(m.FT102 - 6) < 0.15f, "L1 supply flow %.2f m3/h, expected 6", m.FT102);
    CHECK(fabsf(m.PDT101 - 15) < 1.5f, "L7 room pressure %.1f Pa, expected 15", m.PDT101);
    CHECK(fabsf(m.TT105 - 22) < 0.6f, "L5 supply temp %.2f, expected 22", m.TT105);
    CHECK(fabsf(m.TT102 - 18) < 0.8f || c.u.dmp <= 0.301f, "L3 mixed air %.2f (damper %.2f)", m.TT102, c.u.dmp);
    CHECK(c.u.dmp >= 0.299f, "damper never below minimum fresh air: %.3f", c.u.dmp);
    CHECK(c.activeAlarms() == 0, "no alarms at steady state (%d active)", c.activeAlarms());
    CHECK(c.k.Pbase >= c.k.P * 0.5f && c.k.P > 0, "power %.1f W, baseline twin %.1f W", c.k.P, c.k.Pbase);
    CHECK(fabsf(c.k.ach - 6 / 0.0953f) < 2, "ACH %.1f", c.k.ach);
    printf("winter: Q %.2f, dP %.1f, Tsup %.2f, Tmix %.2f, dmp %.2f, cmp %.2f, rh %.2f, hum %.2f, P %.1f W, Pb %.1f W\n",
           m.FT102, m.PDT101, m.TT105, m.TT102, c.u.dmp, c.u.cmp, c.u.rh, c.u.hum, c.k.P, c.k.Pbase);
  }

  // --- no airflow proven: compressor, PTC and humidifier stay off; alarm A01 after 20 s
  {
    rig::Controller c; Plant p; rig::Measured m; p.flowSensorStuck = true;
    runFor(c, p, m, 60, true);
    CHECK(c.u.cmp == 0 && c.u.rh == 0 && c.u.hum == 0, "heat sources locked out without airflow (cmp %.2f rh %.2f hum %.2f)", c.u.cmp, c.u.rh, c.u.hum);
    CHECK(c.alarm[rig::A01], "A01 low airflow raised");
  }

  // --- sensor fault: A13 and the PTC loop holds
  {
    rig::Controller c; Plant p; rig::Measured m;
    runFor(c, p, m, 300, true);
    float hold = c.L[4].out;
    for (float t = 0; t < 10; t += 0.1f) { p.step(c.u, m, 0.1f, true); m.TT105 = NAN; c.step(m, 0.1f); }
    CHECK(c.alarm[rig::A13], "A13 sensor fault raised");
    CHECK(fabsf(c.L[4].out - hold) < 1e-6f, "L5 output held on a missing TT-105");
  }

  // --- season change is sequenced: compressor stops, valve waits 30 s, then switches
  {
    rig::Controller c; Plant p; rig::Measured m;
    runFor(c, p, m, 600, true);
    c.setSeason(rig::Season::Summer);
    p.Toa = 35; p.RHoa = 40;
    bool sawStoppedBeforeSwitch = false;
    for (float t = 0; t < 120; t += 0.1f) {
      p.step(c.u, m, 0.1f, c.season == rig::Season::Winter);
      c.step(m, 0.1f);
      if (c.season == rig::Season::Winter && c.u.cmp == 0) sawStoppedBeforeSwitch = true;
      if (c.season == rig::Season::Summer) break;
    }
    CHECK(c.season == rig::Season::Summer, "season switched to summer");
    CHECK(sawStoppedBeforeSwitch, "compressor stopped before the 4-way valve switched");
    CHECK(c.u.rvCooling, "4-way valve energised for cooling");
    runFor(c, p, m, 900, false);
    CHECK(fabsf(m.TT105 - 16) < 1.0f, "summer supply temp %.2f, expected 16", m.TT105);
    printf("summer: Q %.2f, Tcc %.2f, Tsup %.2f, cmp %.2f, rh %.2f, P %.1f W, Pb %.1f W, saving %.0f %%\n",
           m.FT102, m.TT104, m.TT105, c.u.cmp, c.u.rh, c.k.P, c.k.Pbase, c.k.saving * 100);
  }

  // --- compressor protection while it cycles at minimum speed (winter: the duty is below the minimum)
  {
    rig::Controller c; Plant p; rig::Measured m;
    float lastChange = -1, minOff = 1e9f, minOn = 1e9f; bool was = false; int changes = 0;
    for (float t = 0; t < 7200; t += 0.1f) {
      p.step(c.u, m, 0.1f, true); c.step(m, 0.1f);
      bool is = c.u.cmp > 0;
      if (is != was) {
        if (lastChange >= 0) { if (was) minOn = fminf(minOn, t - lastChange); else minOff = fminf(minOff, t - lastChange); }
        lastChange = t; was = is; changes++;
      }
    }
    printf("compressor (winter): %d on/off changes in 2 h, shortest off %.0f s, shortest on %.0f s\n", changes, minOff, minOn);
    CHECK(changes >= 4, "compressor cycles at minimum speed (%d changes)", changes);
    CHECK(minOff >= 175, "shortest compressor off-time %.0f s (min 180 s, less the slew to zero)", minOff);
    CHECK(minOn >= 115, "shortest compressor run %.0f s (min 120 s)", minOn);
  }

  // --- manual mode is bumpless
  {
    rig::Controller c; Plant p; rig::Measured m;
    runFor(c, p, m, 300, true);
    c.L[0].mv = c.L[0].out; c.L[0].man = true;
    runFor(c, p, m, 5, true);
    c.L[0].man = false;
    float before = c.L[0].out;
    runFor(c, p, m, 0.2f, true);
    CHECK(fabsf(c.L[0].out - before) < 0.02f, "bumpless return to auto (%.3f → %.3f)", before, c.L[0].out);
  }

  // --- energy integrates
  {
    rig::Controller c; Plant p; rig::Measured m;
    runFor(c, p, m, 3600, true);
    CHECK(c.Ewh > 1 && c.EwhBase > c.Ewh * 0.5, "energy %.2f Wh, baseline %.2f Wh", c.Ewh, c.EwhBase);
    CHECK(fabs(c.co2g - c.Ewh * 0.5) < 1e-3, "CO2 = E x EF");
  }

  printf("%d checks, %d failed\n", checks, fails);
  return fails ? 1 : 0;
}
