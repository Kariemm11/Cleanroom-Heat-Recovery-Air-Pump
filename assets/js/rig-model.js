/* Clean-room test rig: dynamic plant model + control loops.

   A lumped model of the 1.0 × 0.5 × 0.5 m acrylic rig. The rig handles hazardous material, so the
   air is 100 % fresh air, once through. There is no mixing box and no recirculation, and no exhaust
   air ever enters the AHU:

     fresh-air compressor → header → air-pump unit Cu plate core (fresh lane) → AHU: filters
     → pre-heat coil → cooling coil → reheat coil → steam humidifier → supply fan → HEPA
     → bag-in/bag-out HEPA terminals (3 ceiling + LAF hood) → clean room
     clean room → BIBO HEPA exhaust terminals → PT-102 → DV-101 diverter ─┬─ Cu plate core (exhaust lane) → exhaust-air coil → FAN-103 → outdoors
                                                                          └─ outer BIBO HEPA → FAN-103B → outdoors

   The copper plate core (Ra ≤ 0.8 µm) keeps the two streams apart: the exhaust only pre-cools
   (summer) or pre-heats (winter) the fresh air through the plates. If PT-102 sees particles in the
   exhaust (contamination, or a leaking terminal filter), L3 throws DV-101 and the exhaust bypasses
   the air pump through the outer HEPA. DV-101 is spring return: power off = HEPA bypass (fail-safe).

   One R32 air pump: in winter the pre-heat coil is its condenser and the exhaust-air
   coil its evaporator; in summer the reversing valve swaps them, the cooling coil is
   the evaporator and the reheat coil a desuperheater.

   Seven PI loops run on the simulated sensors, exactly as the rig controller would.
   "Baseline" runs the same rig with the core bypassed (fresh air through the direct branch) and electric / plain-chiller
   duty, which is what the current sensors are compared against. Works in the
   browser (window.RigModel) and in Node (module.exports) for testing. */
(function (root) {
  "use strict";

  var RHO = 1.2, CP = 1006, HFG = 2501e3, PATM = 101325;

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function lag(x, target, dt, tau) { return x + (target - x) * (1 - Math.exp(-dt / Math.max(tau, 1e-6))); }
  function psat(T) { return 610.94 * Math.exp(17.625 * T / (T + 243.04)); }
  function wFromRH(T, rh) { var pv = clamp(rh, 0, 100) / 100 * psat(T); return 0.622 * pv / (PATM - pv); }
  function rhFromW(T, w) { var pv = w * PATM / (0.622 + w); return clamp(100 * pv / psat(T), 0, 100); }
  function dewPoint(w) {
    var pv = Math.max(1, w * PATM / (0.622 + w)), a = Math.log(pv / 610.94);
    return 243.04 * a / (17.625 - a);
  }
  var _seed = 7;
  function noise() { _seed = (_seed * 16807) % 2147483647; return (_seed / 2147483647) * 2 - 1; }

  /* clean room: net inside dimensions in metres (false ceiling at 400 mm) */
  var ROOM = { L: 0.4925, W: 0.490, H: 0.395 };
  ROOM.V = ROOM.L * ROOM.W * ROOM.H;
  ROOM.A = ROOM.L * ROOM.W;

  /* rig hardware ratings (12/24 V DC components) */
  var HW = {
    sfQ: 18, faQ: 12, efQ: 12,          // m³/h at 100 % speed
    sfP: 8, faP: 14, efP: 6,            // W at 100 % speed (one exhaust fan runs: FAN-103, or FAN-103B on the HEPA bypass)
    phQ: 45, ccQ: 90, rhQ: 30,          // coil capacities, W thermal (100 % fresh air: sized for the summer latent load)
    humG: 45,                           // steam humidifier, g/h (100 % fresh air in winter needs ≈ 41 g/h)
    humWh: 0.75,                        // Wh per g of steam
    ctrlW: 3.5,                         // ESP32 board + 7" HMI + sensors
    leakK: 0.13,                        // m³/h per √Pa of room leakage (≈0.5 m³/h at 15 Pa)
    croom: 3000,                        // J/K: room air + inner acrylic skin
    mroom: 0.35                         // kg: effective moisture buffer of the room
  };

  function defaults() {
    return {
      flow: 6.0,      // supply airflow set point, m³/h (100 % fresh air)
      e1: 60,         // Cu plate core effectiveness, %
      pxTrip: 1000,   // PT-102 exhaust particles ≥0.5 µm that divert the exhaust to the outer HEPA, /m³
      pxReset: 300,   // … and the level it must stay below for 60 s before it goes back to the air pump
      rh: 45,         // clean-room RH set point, %
      dp: 15,         // clean-room pressure set point, Pa
      gain: 3,        // clean-room internal heat gain, W
      moist: 1,       // clean-room moisture gain, g/h
      amb: 24,        // lab air around the acrylic box, °C
      ua: 3.0,        // clean-room envelope UA, W/K
      ef: 0.50,       // grid emission factor, kg CO₂/kWh
      cop: 2.8,       // baseline chiller COP (summer, no recovery)
      hours: 8760,    // operating hours per year
      gen: 12000,     // particles ≥0.5 µm shed in the clean room per minute (operator + filling line), rig scale
      coa: 2.0e7,     // outdoor particles ≥0.5 µm per m³
      volt: 24,       // DC bus voltage
      winter: { oat: -2, orh: 80, coil: 21, sup: 22, room: 22 },
      summer: { oat: 35, orh: 40, coil: 12, sup: 16, room: 21 },
      tctl: "room"   // "room": L8 sets the supply set point to hold the room temperature · "supply": fixed supply set point
    };
  }

  /* ------------------------------------------------------------- PI block */
  function PI(name, kp, ti, lo, hi) {
    return { name: name, kp: kp, ti: ti, lo: lo, hi: hi, i: 0, out: 0, man: false, mv: 0, e: 0 };
  }
  function runPI(c, e, dt) {
    c.e = e;
    if (c.man) { c.out = clamp(c.mv, c.lo, c.hi); c.i = c.out - c.kp * e; return c.out; }
    c.i = clamp(c.i + c.kp * e * dt / c.ti, c.lo, c.hi);
    c.out = clamp(c.kp * e + c.i, c.lo, c.hi);
    return c.out;
  }

  function create(opts) {
    opts = opts || {};
    var P = opts.params || defaults();
    var amb = P.amb, w0 = wFromRH(amb, 50);
    var c0 = P.gen * 60 / Math.max(P.flow, 0.5);   // room particle count at steady state, /m³
    var m = {
      P: P, ROOM: ROOM, HW: HW,
      season: opts.season || "winter",
      recovery: true,            // false = baseline test (core bypassed, electric / plain chiller)
      on: true, t: 0,
      // actuators (0..1) as driven by the loops, after slew limits; dv: 0 = exhaust to the air pump, 1 = to the outer HEPA
      act: { fa: 0, sf: 0, ef: 0, dv: 1, cmp: 0, rh: 0, hum: 0 },
      // plant states
      x: { Qsup: 0, Qfa: 0, Qex: 0, Qph: 0, Qcc: 0, Qrh: 0, mh: 0, Troom: amb, wroom: w0, R1: amb, Cp: c0 },
      extGen: 0,                 // extra particles/min from outside the model (e.g. the pass box inner door is open)
      release: 0,                // s left of a test powder release at the filler (1e7 particles/min)
      hepaLeak: false,           // test: an exhaust-terminal HEPA leaks (2 % penetration)
      exContam: false,           // scenario: the exhaust itself is contaminated (hazardous product in the exhaust)
      _tripT: 0, _holdT: 0,
      // air states (true values)
      a: {},
      // sensors (measured, lagged + noise)
      s: { TT101: amb, MT101: 50, FT101: 0, TT109: amb, TT103: amb, TT104: amb, TT105: amb, MT105: 50,
           FT102: 0, PDT101: 0, PDT102: 0, TT106: amb, MT106: 50, TT107: amb, TT108: amb,
           CT101: 0, CT102: 0, CT103: 0, VT101: P.volt, PT101: c0, PT101A: 0.01 * c0 + 250, PT101R5: 0.02 * c0, PT101A5: 6e-5 * c0,
           PT102: 5e-5 * c0 },
      loops: {
        L1: PI("Supply airflow → supply fan", 0.8, 1.5, 0, 1),
        L2: PI("Fresh-air header balance → fresh-air compressor", 1.0, 1.5, 0, 1),
        L3: PI("Exhaust particles → DV-101 diverter (2-position)", 1, 1, 0, 1),
        L4: PI("Coil leaving temp → air-pump compressor", 1.4, 18, 0, 1),
        L5: PI("Final supply temp → reheat coil", 1.6, 14, 0, 1),
        L6: PI("Clean-room RH → humidifier / dehumidify", 2.0, 120, 0, 1),
        L7: PI("Clean-room pressure → exhaust fans", 0.35, 1.5, 0, 1),
        L8: PI("Clean-room temperature → supply set point (cascade)", 1.5, 300, 0, 1)
      },
      pw: {}, kpi: {},
      E: { act: 0, base: 0, co2: 0, co2base: 0, t: 0, ab: { hr: { wh: 0, t: 0 }, base: { wh: 0, t: 0 } } },
      alarms: [], alarmLog: [], _alarmT: {},
      trend: [], _trendT: 0
    };
    m.loops.L3.out = 1;          // starts on the HEPA bypass until the exhaust is proven clean
    m.supSP = m.P[m.season].sup; trackSup(m);
    return m;
  }

  /* L8 output range: the supply set point it may ask for in each season, °C */
  function supRange(winter) { return winter ? [12, 35] : [10, 26]; }
  function trackSup(m) {                                   // bumpless: L8 starts from the fixed supply set point
    var r = supRange(m.season === "winter"), L8 = m.loops.L8;
    L8.i = L8.out = clamp((m.P[m.season].sup - r[0]) / (r[1] - r[0]), 0, 1); m._l8Season = m.season;
  }

  /* -------------------------------------------------------- one time step */
  function step(m, dt) {
    var P = m.P, S = P[m.season], x = m.x, A = m.act, s = m.s, L = m.loops, a = m.a;
    var winter = m.season === "winter", rec = m.recovery;
    m.t += dt;

    /* ---- controller (uses the measured values, like the real board) ---- */
    var on = m.on;
    var proving = s.FT102 > 0.25 * P.flow && s.FT102 > 0.5;      // airflow proven → coils allowed
    if (on) {
      runPI(L.L1, (P.flow - s.FT102) / 20, dt);
      // L2: the fresh-air compressor keeps the header balanced: FT-101 follows FT-102 (100 % fresh air)
      runPI(L.L2, (s.FT102 - s.FT101) / 20, dt);
      // L6 humidity: winter → steam humidifier, summer → lower the cooling-coil set point
      var e6 = (P.rh - s.MT106) / 100;
      runPI(L.L6, winter ? e6 : -e6, dt);
      var reset = winter ? 0 : 6 * L.L6.out;
      // L8 cascade: the room temperature set point resets the supply set point (fixed supply set point in "supply" mode)
      if (m._l8Season !== m.season) trackSup(m);
      var rg = supRange(winter);
      if (P.tctl === "room") { runPI(L.L8, (S.room - s.TT106) / 10, dt); m.supSP = rg[0] + L.L8.out * (rg[1] - rg[0]); }
      else { m.supSP = S.sup; trackSup(m); }
      m.coilSP = Math.min(S.coil - reset, m.supSP - (winter ? 0 : 0.5));   // never condition the air past the supply set point
      var pv4 = winter ? s.TT103 : s.TT104;
      runPI(L.L4, (winter ? 1 : -1) * (m.coilSP - pv4) / 50, dt);
      runPI(L.L5, (m.supSP - s.TT105) / 50, dt);
      runPI(L.L7, (s.PDT101 - P.dp) / 100, dt);
      if (!proving) { L.L4.i = Math.min(L.L4.i, 0); L.L5.i = Math.min(L.L5.i, 0); }
      if (A.dv > 0.5) L.L4.i = Math.min(L.L4.i, 0);                // compressor locked out: no wind-up
    }
    // L3: two-position exhaust diverter. PT-102 above the trip level for 5 s → DV-101 to the outer HEPA;
    // back to the air pump only after 60 s below the reset level. Manual: MAN L3 0 (air pump) / 1 (HEPA).
    var L3 = L.L3;
    L3.e = (s.PT102 - P.pxTrip) / P.pxTrip;
    m._tripT = s.PT102 > P.pxTrip ? m._tripT + dt : 0;
    m._holdT = s.PT102 < P.pxReset ? m._holdT + dt : 0;
    if (L3.man) L3.out = L3.mv >= 0.5 ? 1 : 0;
    else if (L3.out < 0.5 && m._tripT >= 5) L3.out = 1;
    else if (L3.out >= 0.5 && m._holdT >= 60) L3.out = 0;
    var div = A.dv > 0.5;                                         // exhaust is on the HEPA bypass
    var hpOk = !div;                                              // the air pump's exhaust-side coil needs exhaust air: locked out
                                                                  // whenever DV-101 sends the exhaust to the HEPA (both seasons)
    var tgt = on ? {
      sf: L.L1.out, fa: L.L2.out, dv: L3.out, ef: L.L7.out,
      cmp: proving && hpOk ? L.L4.out : 0, rh: proving ? L.L5.out : 0,
      hum: proving && winter ? L.L6.out : 0
    } : { sf: 0, fa: 0, dv: 1, ef: 0, cmp: 0, rh: 0, hum: 0 };    // power off: DV-101 springs to the HEPA bypass
    // actuator slew limits (DV-101 strokes in 10 s, compressor ramps 10 %/s)
    var slew = { sf: 0.5, fa: 0.5, ef: 0.5, dv: 0.1, cmp: 0.1, rh: 0.5, hum: 0.5 };
    Object.keys(A).forEach(function (k) {
      var d = tgt[k] - A[k], lim = slew[k] * dt;
      A[k] += d > lim ? lim : (d < -lim ? -lim : d);
    });
    div = A.dv > 0.5;
    var recx = rec && !div;                                       // the Cu core and the exhaust coil see exhaust air

    /* ---- air flows (100 % fresh air: the supply is all fresh air, nothing is recirculated) ---- */
    x.Qsup = lag(x.Qsup, HW.sfQ * A.sf, dt, 1.2);
    x.Qfa  = lag(x.Qfa,  HW.faQ * A.fa, dt, 1.2);
    x.Qex  = lag(x.Qex,  HW.efQ * A.ef * (div ? 0.85 : 1), dt, 1.2);   // the outer HEPA adds resistance
    var Qsup = x.Qsup, Qfa = Qsup, Qexr = x.Qex, f = 1;
    // room pressure: supply in, exhaust + leakage out (quasi-static)
    var imb = Qsup - Qexr, dp = Math.sign(imb) * Math.pow(imb / HW.leakK, 2);
    dp = clamp(dp, -150, 150);
    var Qleak = Math.sign(dp) * HW.leakK * Math.sqrt(Math.abs(dp));

    /* ---- air states ---- */
    var C = function (q) { return q * RHO * CP / 3600; };
    var Cs = Math.max(C(Qsup), 1e-3), Cfa = C(Qfa), Cex = C(Qexr);
    var Toa = S.oat, woa = wFromRH(Toa, S.orh), Troom = x.Troom, wroom = x.wroom;
    var e1 = P.e1 / 100;
    // Cu plate core: sensible only, the plates keep the streams apart (no moisture, no particle transfer)
    var T1 = Toa, R1 = Troom, R2 = Troom, Q1 = 0;
    if (recx && Cfa > 1e-4 && Cex > 1e-4) {
      Q1 = e1 * Math.min(Cfa, Cex) * (R1 - Toa);
      T1 = Toa + Q1 / Cfa;
      R2 = R1 - Q1 / Cex;
    }
    x.R1 = R1;
    var Tin = T1, T2 = T1, wmix = woa;                           // the coils see fresh air only

    // pre-heat coil (winter): air-pump condenser, or electric in baseline
    x.Qph = lag(x.Qph, winter ? A.cmp * HW.phQ : 0, dt, 8);
    var Tph = T1 + Math.min(x.Qph / Cs, 45);
    // cooling coil (summer): air-pump evaporator with dehumidification (bypass factor 0.15)
    x.Qcc = lag(x.Qcc, winter ? 0 : A.cmp * HW.ccQ, dt, 8);
    var Tcc = Tph, wcc = wmix, Qlat = 0, msup = Qsup * RHO / 3600, Tsurf = Tph;
    if (!winter && x.Qcc > 0.01) {
      // split the coil duty into sensible + latent: Cs·ΔT + latent(ΔT) = Qcc (monotonic → bisection)
      var BF = 0.15, lo = 0, hi = Math.min(x.Qcc / Cs, 40);
      var coilAt = function (dT) {
        var ts = Tph - dT / (1 - BF), ws = wFromRH(ts, 100);
        var wo = wmix > ws ? BF * wmix + (1 - BF) * ws : wmix;
        return { ts: ts, wo: wo, ql: msup * HFG * (wmix - wo) };
      };
      for (var j = 0; j < 24; j++) {
        var mid = (lo + hi) / 2, r = coilAt(mid);
        if (Cs * mid + r.ql > x.Qcc) hi = mid; else lo = mid;
      }
      var rr = coilAt(lo);
      Tsurf = rr.ts; wcc = rr.wo; Qlat = rr.ql; Tcc = Tph - lo;
    }
    // air pump performance
    var W = 0, cop = 0, Qdsh = 0, Qout = 0, frost = false;
    var Qhp = winter ? x.Qph : x.Qcc;
    var Cx = Math.max(Cex, 0.02);
    if (rec) {
      if (winter && !div) {
        // the evaporator may not pull the exhaust below −3 °C (frost limit): cap the condenser duty
        var Tc = Tph + 6, Te = R2 - 8;
        cop = clamp(0.5 * (Tc + 273.15) / Math.max(Tc - Te, 8), 1.5, 7);
        var qevMax = Math.max(0, Cx * (R2 + 3)), qMax = qevMax * cop / (cop - 1);
        if (x.Qph > qMax) { x.Qph = qMax; Qhp = qMax; frost = true; }
      } else if (winter) {
        cop = 3;                                     // run-down only: the compressor is locked out while diverted
      } else {
        // the exhaust takes the rejected heat up to 45 °C; the rest goes to the outdoor condenser.
        // Diverted: no exhaust air on the coil, so the outdoor condenser takes it all.
        var Te2 = Tsurf - 4, Tc2 = div ? Toa + 18 : Math.min(45, R2 + 10) + 8;
        cop = clamp(0.5 * (Te2 + 273.15) / Math.max(Tc2 - Te2, 8), 1.5, 7);
      }
      W = Qhp > 0.01 ? Qhp / cop : 0;
      if (!winter) Qdsh = 0.3 * (x.Qcc + W);
    } else {
      cop = winter ? 1 : P.cop;                      // electric pre-heat / plain chiller
      W = Qhp / cop;
    }
    // reheat coil: desuperheater first (summer + recovery), then the PTC trim element
    var rhCap = HW.rhQ + Qdsh;
    x.Qrh = lag(x.Qrh, A.rh * rhCap, dt, 5);
    var Qptc = Math.max(0, x.Qrh - Qdsh);
    var Trh = Tcc + Math.min(x.Qrh / Cs, 40);
    // steam humidifier (isothermal)
    x.mh = lag(x.mh, A.hum * HW.humG, dt, 6);
    var whum = wcc + (Qsup > 0.05 ? x.mh / 1000 / (Qsup * RHO) : 0);
    // supply fan heat, then HEPA
    var Psf = A.sf > 0.001 ? 0.3 + HW.sfP * Math.pow(A.sf, 3) : 0;
    var Tsup = Trh + Math.min(Psf / Cs, 10), wsup = whum;

    // exhaust-air coil in the recovery unit
    var Texh = R2;
    if (rec && div && Qhp > 0.01) {
      if (!winter) Qout = Math.max(0, x.Qcc + W - Math.min(Qdsh, x.Qrh));
    } else if (rec && Qhp > 0.01) {
      if (winter) Texh = R2 - (Qhp - W) / Cx;
      else {
        var Qrej = Math.max(0, x.Qcc + W - Math.min(Qdsh, x.Qrh)), Qair = Math.max(0, Cx * (45 - R2));
        Qout = Math.max(0, Qrej - Qair);
        Texh = R2 + Math.min(Qrej, Qair) / Cx;
      }
      Texh = clamp(Texh, -30, 70);
    }

    // clean room
    var Qin = Qsup > 1e-3 ? C(Qsup) * (Tsup - Troom) : 0;
    x.Troom += dt * (Qin + P.gain + P.ua * (P.amb - Troom)) / HW.croom;
    x.wroom += dt * (msup * (wsup - wroom) + P.moist / 1000 / 3600) / HW.mroom;
    x.wroom = Math.max(x.wroom, 0.0005);

    /* ---- airborne particles ≥0.5 µm (well-mixed room + first-air zone at the fill point) ---- */
    // fresh air only: outdoor count through the pre-filter, the panel + bag filters, the AHU's H13 HEPA
    // (≈99.995 % at 0.5 µm) and then the H14 bag-in/bag-out terminal HEPA (≈99.995 %). Ingress happens
    // only when the room is not over-pressured.
    var Coa = P.coa * 0.9;
    var Csup = Coa * (1 - 0.64) * (1 - 0.99995) * (1 - 0.99995);
    var Qing = Math.max(0, -Qleak) + 0.08 * Math.exp(-Math.max(dp, 0) / 3);     // m³/h of lab air leaking in
    if (m.release > 0) m.release = Math.max(0, m.release - dt);
    var Clab = 1.0e7, G = (P.gen + m.extGen + (m.release > 0 ? 1e7 : 0)) * 60;  // particles per hour
    var V = ROOM.V, Qoutp = Math.max(Qsup + Qing, 1e-3);
    x.Cp += dt / 3600 * (Qsup * Csup + Qing * Clab + G - Qoutp * x.Cp) / V;
    x.Cp = Math.max(x.Cp, 0);
    var capture = 0.99 * clamp(Qsup / Math.max(0.6 * P.flow, 0.1), 0, 1);      // first-air sweep over the needles
    var CA = Csup + (1 - capture) * x.Cp + 250;                                // + a little from vial handling
    var r5 = 0.02;                                                             // ≥5 µm share of particles shed by people
    // exhaust: through the H14 BIBO exhaust terminals (a leaking one lets 2 % through), then PT-102.
    // On the bypass the outer BIBO HEPA cleans it again before it leaves the building.
    var Cexh = x.Cp * (m.hepaLeak ? 0.02 : 5e-5);
    if (m.exContam) Cexh = Math.max(Cexh, 2e4);                   // contaminated-exhaust scenario: well over the trip level
    var Cdis = div ? Cexh * 5e-5 : Cexh;

    /* ---- electrical power ---- */
    var fan = function (u, pmax, idle) { return u > 0.001 ? idle + pmax * Math.pow(u, 3) : 0; };
    var Pfa = fan(A.fa, HW.faP, 0.5), Pef = fan(A.ef, HW.efP, 0.3);
    var Pfans = Pfa + Psf + Pef;
    var elecPre = !rec && winter;                  // baseline winter: the pre-heat coil is an electric element
    var Pcmp = elecPre ? 0 : (W > 0.005 ? W + (rec ? 0.8 : 0) : 0);
    var Phum = x.mh * HW.humWh;
    var Pheat = Qptc + Phum + (elecPre ? W : 0);   // CT-103 channel
    var Pctl = on ? HW.ctrlW : 0.6;
    var Pact = Pfans + Pcmp + Pheat + Pctl;

    // baseline twin: same flows and leaving temperatures, no recovery (100 % fresh air straight from outdoors)
    var Tmb = Toa, wmb = woa, Pb_hc = 0;
    if (winter) Pb_hc = Cs * Math.max(0, Tph - Tmb);
    else Pb_hc = (Cs * Math.max(0, Tmb - Tcc) + msup * HFG * Math.max(0, wmb - wcc)) / P.cop;
    var Pbase = Pb_hc + x.Qrh + Phum + Pfans + Pctl;               // same fans: the rig hardware is the same

    /* ---- sensors ---- */
    var n = function (v) { return noise() * v; };
    s.TT101 = lag(s.TT101, Toa, dt, 5) + n(0.01);
    s.MT101 = lag(s.MT101, S.orh, dt, 8);
    s.FT101 = lag(s.FT101, x.Qfa, dt, 0.5);                       // what FAN-101 delivers into the header
    s.TT109 = lag(s.TT109, T1, dt, 3) + n(0.01);
    s.TT103 = lag(s.TT103, Tph, dt, 3) + n(0.01);
    s.TT104 = lag(s.TT104, Tcc, dt, 3) + n(0.01);
    s.TT105 = lag(s.TT105, Tsup, dt, 5) + n(0.01);
    s.MT105 = lag(s.MT105, rhFromW(Tsup, wsup), dt, 8);
    s.FT102 = lag(s.FT102, Qsup, dt, 0.5);
    s.PDT101 = lag(s.PDT101, dp, dt, 1.0);
    s.PDT102 = lag(s.PDT102, 140 * Math.pow(Qsup / 6, 1.6) + 5, dt, 1.0);
    s.TT106 = lag(s.TT106, Troom, dt, 5) + n(0.01);
    s.MT106 = lag(s.MT106, rhFromW(Troom, x.wroom), dt, 8);
    s.TT107 = lag(s.TT107, Troom, dt, 3);
    s.TT108 = lag(s.TT108, Texh, dt, 3);
    s.VT101 = P.volt + n(0.02);
    s.CT101 = Math.max(0, Pcmp / P.volt + n(0.008));
    s.CT102 = Math.max(0, Pfans / P.volt + n(0.008));
    s.CT103 = Math.max(0, Pheat / P.volt + n(0.008));
    // laser particle counter (2.83 L/min) on a 2-port manifold: counting noise ≈ √N of the sample
    var pn = function (c) { return c * (1 + n(1) * Math.min(0.5, 1 / Math.sqrt(Math.max(c * 0.00283, 1)))); };
    s.PT101 = Math.max(0, lag(s.PT101, pn(x.Cp), dt, 15));
    s.PT101A = Math.max(0, lag(s.PT101A, pn(CA), dt, 15));
    s.PT101R5 = Math.max(0, lag(s.PT101R5, pn(x.Cp * r5), dt, 15));
    // big particles settle out and are swept away by the first air more readily than 0.5 µm ones
    s.PT101A5 = Math.max(0, lag(s.PT101A5, pn((1 - capture) * x.Cp * r5 * 0.3), dt, 15));
    s.PT102 = Math.max(0, lag(s.PT102, pn(Cexh), dt, 4));

    /* ---- bookkeeping ---- */
    Object.assign(a, {
      oa: Toa, woa: woa, t1: T1, tin: Tin, t2: T2, ph: Tph, cc: Tcc, rh: Trh, sup: Tsup,
      room: x.Troom, ret: x.Troom, r1: R1, r2: R2, exh: Texh, tsurf: Tsurf,
      wsup: wsup, wroom: x.wroom, f: f, Qsup: Qsup, Qfa: Qfa, Qrec: 0, Qex: x.Qex,
      Qhr: rec ? Qfa : 0, Qdir: rec ? 0 : Qfa, Qcore: div ? 0 : Qexr, Qbyp: div ? Qexr : 0, div: A.dv,
      Qleak: Qleak, dp: dp, Q1: Q1, Qlat: Qlat,
      dewRoom: dewPoint(x.wroom), Cp: x.Cp, Csup: Csup, CA: CA, Qing: Qing, capture: capture, Cexh: Cexh, Cdis: Cdis
    });
    m.pw = { fa: Pfa, sf: Psf, ef: Pef, fans: Pfans, cmp: Pcmp, ptc: Qptc, hum: Phum, heat: Pheat,
             ctl: Pctl, total: Pact, base: Pbase, W: W, cop: cop, Qhp: Qhp, Qdsh: Math.min(Qdsh, x.Qrh),
             Qrec: Math.abs(Q1), Qout: Qout, frost: frost };
    var hrs = dt / 3600;
    m.E.act += Pact * hrs; m.E.base += (div ? Pact : Pbase) * hrs; m.E.t += dt;   // no saving is claimed while the exhaust is diverted
    m.E.co2 += Pact * hrs * P.ef; m.E.co2base += Pbase * hrs * P.ef;      // grams (W·h × kg/kWh = g)
    var ab = rec ? m.E.ab.hr : m.E.ab.base; ab.wh += Pact * hrs; ab.t += dt;

    var ach = s.FT102 / ROOM.V;
    m.kpi = {
      ach: ach, achTrue: Qsup / ROOM.V, f: f, red: Pbase > 0.1 && !div ? Math.max(0, 1 - Pact / Pbase) : 0,
      co2h: Pact * P.ef, co2hBase: (div ? Pact : Pbase) * P.ef,                         // g/h
      annualKWh: Pact * P.hours / 1000, annualBaseKWh: (div ? Pact : Pbase) * P.hours / 1000,
      scale: 5000 / Math.max(P.flow, 0.5)
    };
    alarms(m, dt);
    if (m.t - m._trendT >= 2 - 1e-6) { m._trendT += 2; pushTrend(m); }   // exactly every 2 s of simulated time
  }

  function alarms(m, dt) {
    var s = m.s, P = m.P, S = P[m.season], on = m.on;
    var list = [
      ["A01", "Low supply airflow", on && s.FT102 < 0.8 * P.flow, 20, "serious"],
      ["A02", "Clean-room pressure low", on && s.PDT101 < 5, 25, "serious"],
      ["A03", "Clean-room pressure high", on && s.PDT101 > 40, 15, "warning"],
      ["A04", "Clean-room RH out of band", on && Math.abs(s.MT106 - P.rh) > 10, 120, "warning"],
      ["A05", "Evaporator at frost limit — air pump capped", on && m.recovery && m.season === "winter" && m.pw.frost, 30, "warning"],
      ["A06", "Exhaust contaminated (PT-102) — diverted to the outer BIBO HEPA, recovery suspended", s.PT102 > P.pxTrip, 5, "serious"],
      ["A07", "Supply temperature off set point", on && Math.abs(s.TT105 - m.supSP) > 2, 90, "warning"],
      ["A08", "ACH below 20 /h (ISO 8 minimum)", on && s.FT102 / ROOM.V < 20, 30, "warning"],
      ["A09", "HEPA ΔP high — check filter", on && s.PDT102 > 450, 10, "warning"],
      ["A10", "Room particles above alert limit (70 % of Grade B in operation)", s.PT101 > 0.7 * 352000 && s.PT101 <= 352000, 60, "warning"],
      ["A11", "Room particles above action limit (Grade B in operation, 352 000/m³)", s.PT101 > 352000, 30, "serious"],
      ["A12", "Fill point above Grade A limit (3 520/m³ ≥0.5 µm)", s.PT101A > 3520, 30, "serious"]
    ];
    var active = [];
    list.forEach(function (d) {
      var k = d[0], t = m._alarmT[k] || 0;
      t = d[2] ? t + dt : 0; m._alarmT[k] = t;
      var was = m.alarms.some(function (x) { return x.id === k; });
      if (t >= d[3]) {
        active.push({ id: k, text: d[1], sev: d[4] });
        if (!was) m.alarmLog.unshift({ id: k, text: d[1], sev: d[4], t: m.t, kind: "raised" });
      } else if (was) m.alarmLog.unshift({ id: k, text: d[1], sev: d[4], t: m.t, kind: "cleared" });
    });
    if (m.alarmLog.length > 40) m.alarmLog.length = 40;
    m.alarms = active;
  }

  /* trend buffer for the HMI graphs: one sample every 2 s of simulated time, the last 12 h kept */
  var TREND_MAX = 21600;
  function pushTrend(m) {
    var s = m.s, P = m.P, S = P[m.season];
    m.trend.push({ t: m.t, TT101: s.TT101, TT109: s.TT109, TT103: s.TT103, TT104: s.TT104, TT105: s.TT105, TT106: s.TT106,
      TT107: s.TT107, TT108: s.TT108, SUPSP: m.supSP, COILSP: m.coilSP, ROOMSP: P.tctl === "room" ? S.room : NaN,
      MT101: s.MT101, MT105: s.MT105, MT106: s.MT106, RHSP: P.rh, P: m.pw.total, Pb: m.pw.base,
      RED: m.recovery ? m.kpi.red * 100 : NaN, QREC: m.pw.Qrec, COP: m.act.cmp > 0.01 ? m.pw.cop : NaN,
      ACH: m.kpi.ach, DP: s.PDT101, DPSP: P.dp, PR: s.PT101, PA: s.PT101A, PX: s.PT102, TRIP: P.pxTrip, RST: P.pxReset,
      QS: s.FT102, QF: s.FT101, QE: m.a.Qex, QSP: P.flow,
      USF: m.act.sf * 100, UFA: m.act.fa * 100, UEF: m.act.ef * 100, UDV: m.act.dv * 100, UCM: m.act.cmp * 100,
      URH: m.act.rh * 100, UHM: m.act.hum * 100,
      CO: m.kpi.co2h, COB: m.kpi.co2hBase, EA: m.E.act, EB: m.E.base });
    if (m.trend.length > TREND_MAX + 600) m.trend.splice(0, m.trend.length - TREND_MAX);
  }

  function resetEnergy(m) {
    m.E = { act: 0, base: 0, co2: 0, co2base: 0, t: 0, ab: { hr: { wh: 0, t: 0 }, base: { wh: 0, t: 0 } } };
  }

  var RigModel = { create: create, step: step, defaults: defaults, resetEnergy: resetEnergy,
    ROOM: ROOM, HW: HW, wFromRH: wFromRH, rhFromW: rhFromW, dewPoint: dewPoint, clamp: clamp };
  if (typeof module !== "undefined" && module.exports) module.exports = RigModel;
  else root.RigModel = RigModel;
})(this);
