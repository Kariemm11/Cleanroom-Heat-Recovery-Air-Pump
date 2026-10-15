// Rig controller implementation. Plain C++: no Arduino calls, so it builds and tests on a PC.
#include "control.h"

namespace rig {

const AlarmDef ALARMS[ALARM_COUNT] = {
    {"A01", "Low supply airflow", 20, true},
    {"A02", "Clean-room pressure low", 25, true},
    {"A03", "Clean-room pressure high", 15, false},
    {"A04", "Clean-room RH out of band", 120, false},
    {"A05", "Evaporator at frost limit, air pump capped", 30, false},
    {"A06", "Exhaust contaminated (PT-102): diverted to the outer BIBO HEPA", 5, true},
    {"A07", "Supply temperature off set point", 90, false},
    {"A08", "ACH below 20 /h", 30, false},
    {"A09", "HEPA dP high, check filter", 10, false},
    {"A10", "Room particles above alert limit (70 % of Grade B)", 60, false},
    {"A11", "Room particles above action limit (Grade B, 352 000 /m3)", 30, true},
    {"A12", "Fill point above Grade A limit (3 520 /m3)", 30, true},
    {"A13", "Sensor fault (a control input is missing)", 5, true},
    {"A14", "Fan tach: fan commanded but not turning", 10, true},
};

const char* gradeOf(float c05, float c5) {
  if (!ok(c05)) return "-";
  if (c05 <= 3520 && (!ok(c5) || c5 <= 29)) return "A";
  if (c05 <= 352000 && (!ok(c5) || c5 <= 2930)) return "B";
  if (c05 <= 3520000 && (!ok(c5) || c5 <= 29300)) return "C";
  return ">C";
}

Controller::Controller() {
  L[0].init("L1 supply airflow -> FAN-102", 0.8f, 1.5f, 0, 1);
  L[1].init("L2 fresh-air header balance -> FAN-101", 1.0f, 1.5f, 0, 1);
  L[2].init("L3 exhaust particles -> DV-101 (2-position)", 1.0f, 1.0f, 0, 1);
  L[3].init("L4 coil leaving temp -> CMP-101", 1.4f, 18.0f, 0, 1);
  L[4].init("L5 supply temp -> HTR-101", 1.6f, 14.0f, 0, 1);
  L[5].init("L6 room RH -> HUM-101 / coil reset", 2.0f, 120.0f, 0, 1);
  L[6].init("L7 room pressure -> FAN-103", 0.35f, 1.5f, 0, 1);
  L[2].out = 1.0f;            // the exhaust starts on the HEPA bypass until PT-102 proves it clean
  pendingSeason = season;
}

void Controller::setSeason(Season s) { pendingSeason = s; }

static float slewTo(float cur, float tgt, float ratePerS, float dt) {
  float d = tgt - cur, lim = ratePerS * dt;
  return cur + (d > lim ? lim : (d < -lim ? -lim : d));
}

void Controller::step(const Measured& m, float dt) {
  const bool winter = season == Season::Winter;
  const SeasonSP& S = seasonSP();

  // control inputs: a missing one freezes the loops that need it and raises A13
  const bool flowOk = ok(m.FT102), faOk = ok(m.FT101), pxOk = ok(m.PT102);
  const bool coilOk = winter ? ok(m.TT103) : ok(m.TT104), supOk = ok(m.TT105), rhOk = ok(m.MT106), dpOk = ok(m.PDT101);
  const bool proving = flowOk && m.FT102 > 0.25f * sp.flow && m.FT102 > 0.5f;

  Outputs tgt;
  if (on) {
    if (flowOk) L[0].run((sp.flow - m.FT102) / 20.0f, dt);
    // L2: 100 % fresh air, so the fresh-air compressor keeps the header balanced (FT-101 follows FT-102)
    if (flowOk && faOk) L[1].run((m.FT102 - m.FT101) / 20.0f, dt);
    if (rhOk) { float e6 = (sp.rh - m.MT106) / 100.0f; L[5].run(winter ? e6 : -e6, dt); }
    const float reset = winter ? 0.0f : 6.0f * L[5].out;          // summer: lower the coil set point to dehumidify
    k.coilSP = S.coil - reset;
    if (coilOk) { float pv = winter ? m.TT103 : m.TT104; L[3].run((winter ? 1.0f : -1.0f) * (k.coilSP - pv) / 50.0f, dt); }
    if (supOk) L[4].run((S.sup - m.TT105) / 50.0f, dt);
    if (dpOk) L[6].run((m.PDT101 - sp.dp) / 100.0f, dt);
    if (!proving) { L[3].i = fminf(L[3].i, 0); L[4].i = fminf(L[4].i, 0); }
    // winter: the evaporator lives in the exhaust lane, so no exhaust air (bypass) = no air pump
    const bool hpOk = !diverted && (!winter || recovery);   // no exhaust air on the air pump's coil while diverted
    if (!hpOk) L[3].i = fminf(L[3].i, 0);

    // frost protection (winter): pull the compressor back while the exhaust leaves the coil below −3 °C
    frost = winter && recovery && !diverted && ok(m.TT108) && m.TT108 < -3.0f;

    tgt.sf = L[0].out; tgt.fa = L[1].out; tgt.ef = L[6].out;
    tgt.cmp = (proving && hpOk) ? L[3].out : 0.0f;
    if (frost) tgt.cmp = fminf(tgt.cmp, u.cmp - 0.05f * dt);    // ramp down while frosting
    tgt.rh = proving ? L[4].out : 0.0f;
    tgt.hum = (proving && winter && (!ok(m.MT105) || m.MT105 < 85.0f)) ? L[5].out : 0.0f;
    // PTC only with the supply fan proven turning
    if (ok(m.rpm102) && m.rpm102 < 300.0f) tgt.rh = 0, tgt.hum = 0;
  }

  // L3 exhaust diverter (2-position, runs even with RUN off): PT-102 above the trip level for 5 s →
  // DV-101 to the outer BIBO HEPA; back to the air pump only after 60 s below the reset level.
  // A missing PT-102 reading counts as contaminated (fail-safe). Manual: MAN L3 0 = air pump, ≥50 = HEPA.
  tripS = (!pxOk || m.PT102 > sp.pxTrip) ? tripS + dt : 0;
  holdS = (pxOk && m.PT102 < sp.pxReset) ? holdS + dt : 0;
  L[2].e = pxOk ? (m.PT102 - sp.pxTrip) / sp.pxTrip : 1.0f;
  if (L[2].man) L[2].out = L[2].mv >= 0.5f ? 1.0f : 0.0f;
  else if (L[2].out < 0.5f && tripS >= 5.0f) L[2].out = 1.0f;
  else if (L[2].out >= 0.5f && holdS >= 60.0f) L[2].out = 0.0f;
  tgt.dv = on ? L[2].out : 1.0f;              // RUN off: the actuator is de-energised and springs to the HEPA

  // compressor protection: below the driver's minimum speed it is off; min off / min run times;
  // a season change stops it, waits for the pressures to equalise, then switches the 4-way valve
  float cmpCmd = tgt.cmp;
  if (pendingSeason != season) cmpCmd = 0;
  const bool want = cmpCmd >= 0.30f || (cmpRunning && cmpCmd > 0.25f);   // hysteresis around the minimum speed
  if (cmpRunning) {
    cmpOnS += dt;
    if (!want && cmpOnS >= 120.0f) { cmpRunning = false; cmpOffS = 0; }
    else if (!want && pendingSeason != season) { cmpRunning = false; cmpOffS = 0; }   // season change overrides min-run
  } else {
    cmpOffS += dt;
    if (want && cmpOffS >= 180.0f) { cmpRunning = true; cmpOnS = 0; }
  }
  if (pendingSeason != season && !cmpRunning) {
    rvHoldS += dt;
    if (rvHoldS >= 30.0f) { season = pendingSeason; rvHoldS = 0; }
  } else rvHoldS = 0;
  tgt.cmp = cmpRunning ? fmaxf(cmpCmd, 0.30f) : 0.0f;

  // slew limits per second (same as the simulator)
  u.sf = slewTo(u.sf, tgt.sf, 0.5f, dt);
  u.fa = slewTo(u.fa, tgt.fa, 0.5f, dt);
  u.ef = slewTo(u.ef, tgt.ef, 0.5f, dt);
  u.dv = slewTo(u.dv, tgt.dv, 0.1f, dt);      // 10 s stroke (spring return about the same)
  u.cmp = slewTo(u.cmp, tgt.cmp, 0.1f, dt);
  u.rh = slewTo(u.rh, tgt.rh, 0.5f, dt);
  u.hum = slewTo(u.hum, tgt.hum, 0.5f, dt);
  if (!on) { float dv = u.dv; u = Outputs{}; u.dv = dv; }
  diverted = u.dv > 0.5f;
  u.rvCooling = season == Season::Summer;
  u.eevSteps = u.cmp > 0.01f ? (int)(80 + 400 * u.cmp) : 0;

  // KPIs
  k.ach = flowOk ? m.FT102 / (0.4925f * 0.490f * 0.395f) : NAN;
  k.f = 1.0f;                                 // 100 % fresh air
  k.roomGrade = gradeOf(m.PT101, m.PT101R5);
  k.fillGrade = gradeOf(m.PT101A, m.PT101A5);
  energy(m, dt);
  alarms(m, dt);
}

// Measured power and the baseline twin (same flows, no recovery), from measured values only.
void Controller::energy(const Measured& m, float dt) {
  const bool winter = season == Season::Winter;
  float V = ok(m.VT101) ? m.VT101 : 24.0f;
  float Pcmp = ok(m.CT101) ? V * fmaxf(m.CT101, 0) : 0, Pfans = ok(m.CT102) ? V * fmaxf(m.CT102, 0) : 0;
  float Pheat = ok(m.CT103) ? V * fmaxf(m.CT103, 0) : 0;
  float Pctl = on ? sp.ctrlW : 0.6f;
  k.P = Pcmp + Pfans + Pheat + Pctl;

  float Pb = NAN;
  if (ok(m.FT102) && ok(m.TT101) && ok(m.TT105)) {
    const float Q = fmaxf(m.FT102, 0), Cs = capRate(Q);
    const float Tmb = m.TT101;                                  // 100 % fresh air straight from outdoors
    const float Phum = u.hum * sp.humRatedW;
    float Phc = 0, Preheat = 0;
    if (winter && ok(m.TT103)) {
      Phc = Cs * fmaxf(0, m.TT103 - Tmb);                       // electric pre-heat
      Preheat = Cs * fmaxf(0, m.TT105 - m.TT103 - 0.15f);       // electric reheat (less fan heat)
    } else if (!winter && ok(m.TT104)) {
      float wmb = NAN, wcc = NAN;
      if (ok(m.MT101)) wmb = wFromRH(m.TT101, m.MT101);
      if (ok(m.MT105)) wcc = wFromRH(m.TT105, m.MT105);
      float lat = (ok(wmb) && ok(wcc)) ? (Q * RHO / 3600.0f) * HFG * fmaxf(0, wmb - wcc) : 0;
      Phc = (Cs * fmaxf(0, Tmb - m.TT104) + lat) / sp.copBase;  // plain chiller
      Preheat = Cs * fmaxf(0, m.TT105 - m.TT104 - 0.15f);
    }
    Pb = Phc + Preheat + Phum + Pfans + Pctl;
  }
  k.Pbase = ok(Pb) ? Pb : k.P;
  k.saving = k.Pbase > 0.1f ? 1.0f - k.P / k.Pbase : 0;
  k.co2h = k.P * sp.ef;            // g/h  (W × kg/kWh = g/h)
  k.co2hBase = k.Pbase * sp.ef;
  const double h = dt / 3600.0;
  Ewh += k.P * h; EwhBase += k.Pbase * h; co2g += k.P * h * sp.ef; co2gBase += k.Pbase * h * sp.ef; runS += dt;
}

void Controller::alarms(const Measured& m, float dt) {
  const SeasonSP& S = seasonSP();
  bool c[ALARM_COUNT] = {};
  c[A01] = on && ok(m.FT102) && m.FT102 < 0.8f * sp.flow;
  c[A02] = on && ok(m.PDT101) && m.PDT101 < 5.0f;
  c[A03] = on && ok(m.PDT101) && m.PDT101 > 40.0f;
  c[A04] = on && ok(m.MT106) && fabsf(m.MT106 - sp.rh) > 10.0f;
  c[A05] = on && frost;
  c[A06] = !ok(m.PT102) || m.PT102 > sp.pxTrip;
  c[A07] = on && ok(m.TT105) && fabsf(m.TT105 - S.sup) > 2.0f;
  c[A08] = on && ok(k.ach) && k.ach < 20.0f;
  c[A09] = on && ok(m.PDT102) && m.PDT102 > 450.0f;
  c[A10] = ok(m.PT101) && m.PT101 > 0.7f * 352000.0f && m.PT101 <= 352000.0f;
  c[A11] = ok(m.PT101) && m.PT101 > 352000.0f;
  c[A12] = ok(m.PT101A) && m.PT101A > 3520.0f;
  c[A13] = on && (!ok(m.FT102) || !ok(m.FT101) || !ok(m.PT102) || !ok(m.TT105) || !ok(m.PDT101) || !ok(m.MT106) ||
                  !(season == Season::Winter ? ok(m.TT103) : ok(m.TT104)));
  c[A14] = on && ((u.sf > 0.2f && ok(m.rpm102) && m.rpm102 < 100.0f) || (u.fa > 0.2f && ok(m.rpm101) && m.rpm101 < 100.0f) ||
                  (u.ef > 0.2f && ok(m.rpm103) && m.rpm103 < 100.0f));
  for (int i = 0; i < ALARM_COUNT; i++) {
    alarmT[i] = c[i] ? alarmT[i] + dt : 0;
    alarm[i] = alarmT[i] >= ALARMS[i].delay;
  }
}

}  // namespace rig
