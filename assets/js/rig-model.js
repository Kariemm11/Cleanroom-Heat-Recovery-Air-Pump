/* Clean-room test rig: dynamic plant model + control loops.

   A lumped model of the 1.0 × 0.5 × 0.5 m acrylic rig. The air side follows the
   AHU + heat-recovery air-pump layout of the earlier 3D model:

     fresh-air compressor → header ─┬─ recovery air-pump unit core ─┐
                                    └─ direct branch ───────────────┴→ AHU core → mixing box (servo damper)
     → pre-heat coil → cooling coil → reheat coil → steam humidifier → supply fan → HEPA → clean room
     clean room → AHU extract deck ─┬─ recirculated → mixing box
                                    └─ AHU core → recovery unit core → exhaust-air coil → exhaust fan → outdoors

   One R32 air pump: in winter the pre-heat coil is its condenser and the exhaust-air
   coil its evaporator; in summer the reversing valve swaps them, the cooling coil is
   the evaporator and the reheat coil a desuperheater.

   Seven PI loops run on the simulated sensors, exactly as the rig controller would.
   "Baseline" runs the same rig with recovery bypassed and electric / plain-chiller
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
    sfP: 8, faP: 14, efP: 3,            // W at 100 % speed (two exhaust fans of efP each)
    phQ: 45, ccQ: 60, rhQ: 30,          // coil capacities, W thermal
    humG: 30,                           // steam humidifier, g/h
    humWh: 0.75,                        // Wh per g of steam
    ctrlW: 3.5,                         // ESP32 board + 7" HMI + sensors
    leakK: 0.13,                        // m³/h per √Pa of room leakage (≈0.5 m³/h at 15 Pa)
    croom: 3000,                        // J/K: room air + inner acrylic skin
    mroom: 0.35                         // kg: effective moisture buffer of the room
  };

  function defaults() {
    return {
      flow: 6.0,      // supply airflow set point, m³/h
      oa: 30,         // minimum fresh air, %
      split: 75,      // share of the fresh air sent through the recovery air-pump unit, %
      e1: 50, e2: 50, // recovery-unit core / AHU core effectiveness, %
      rh: 45,         // clean-room RH set point, %
      dp: 15,         // clean-room pressure set point, Pa
      gain: 3,        // clean-room internal heat gain, W
      moist: 1,       // clean-room moisture gain, g/h
      amb: 24,        // lab air around the acrylic box, °C
      ua: 3.0,        // clean-room envelope UA, W/K
      ef: 0.50,       // grid emission factor, kg CO₂/kWh
      cop: 2.8,       // baseline chiller COP (summer, no recovery)
      hours: 8760,    // operating hours per year
      volt: 24,       // DC bus voltage
      winter: { oat: -2, orh: 80, mix: 18, coil: 21, sup: 22 },
      summer: { oat: 35, orh: 40, mix: 18, coil: 12, sup: 16 }
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
    var m = {
      P: P, ROOM: ROOM, HW: HW,
      season: opts.season || "winter",
      recovery: true,            // false = baseline test (recovery bypassed, electric / plain chiller)
      hrv: "plate",              // AHU core type: plate (sensible) or wheel (sensible + latent)
      on: true, t: 0,
      // actuators (0..1) as driven by the loops, after slew limits
      act: { fa: 0, sf: 0, ef: 0, dmp: 0, cmp: 0, rh: 0, hum: 0 },
      // plant states
      x: { Qsup: 0, Qfa: 0, Qex: 0, Qph: 0, Qcc: 0, Qrh: 0, mh: 0, Troom: amb, wroom: w0, R1: amb },
      // air states (true values)
      a: {},
      // sensors (measured, lagged + noise)
      s: { TT101: amb, MT101: 50, FT101: 0, TT102: amb, TT103: amb, TT104: amb, TT105: amb, MT105: 50,
           FT102: 0, PDT101: 0, PDT102: 0, TT106: amb, MT106: 50, TT107: amb, TT108: amb,
           CT101: 0, CT102: 0, CT103: 0, VT101: P.volt },
      loops: {
        L1: PI("Supply airflow → supply fan", 0.8, 1.5, 0, 1),
        L2: PI("Fresh-air flow → fresh-air compressor", 1.0, 1.5, 0, 1),
        L3: PI("Mixed-air temp → mixing damper servo", 3.0, 6, 0, 1),
        L4: PI("Coil leaving temp → air-pump compressor", 1.4, 18, 0, 1),
        L5: PI("Final supply temp → reheat coil", 1.6, 14, 0, 1),
        L6: PI("Clean-room RH → humidifier / dehumidify", 2.0, 120, 0, 1),
        L7: PI("Clean-room pressure → exhaust fans", 0.35, 1.5, 0, 1)
      },
      pw: {}, kpi: {},
      E: { act: 0, base: 0, co2: 0, co2base: 0, t: 0, ab: { hr: { wh: 0, t: 0 }, base: { wh: 0, t: 0 } } },
      alarms: [], alarmLog: [], _alarmT: {},
      trend: [], _trendT: 0
    };
    m.loops.L3.i = P.oa / 100;
    return m;
  }

  /* -------------------------------------------------------- one time step */
  function step(m, dt) {
    var P = m.P, S = P[m.season], x = m.x, A = m.act, s = m.s, L = m.loops, a = m.a;
    var winter = m.season === "winter", rec = m.recovery;
    m.t += dt;

    /* ---- controller (uses the measured values, like the real board) ---- */
    var on = m.on;
    var proving = s.FT102 > 0.25 * P.flow && s.FT102 > 0.5;      // airflow proven → coils allowed
    var fd = 0;                                                    // damper fresh-air fraction
    if (on) {
      runPI(L.L1, (P.flow - s.FT102) / 20, dt);
      // L3 economiser-style mixed-air control; action flips when outdoor air is warmer than return
      var colderOA = s.TT101 < s.TT107;
      var e3 = (s.TT102 - S.mix) / 50 * (colderOA ? 1 : -1);
      L.L3.lo = P.oa / 100;
      runPI(L.L3, e3, dt);
      fd = L.L3.out;
      runPI(L.L2, (fd * s.FT102 - s.FT101) / 20, dt);
      // L6 humidity: winter → steam humidifier, summer → lower the cooling-coil set point
      var e6 = (P.rh - s.MT106) / 100;
      runPI(L.L6, winter ? e6 : -e6, dt);
      var reset = winter ? 0 : 6 * L.L6.out;
      m.coilSP = S.coil - reset;
      var pv4 = winter ? s.TT103 : s.TT104;
      runPI(L.L4, (winter ? 1 : -1) * (m.coilSP - pv4) / 50, dt);
      runPI(L.L5, (S.sup - s.TT105) / 50, dt);
      runPI(L.L7, (s.PDT101 - P.dp) / 100, dt);
      if (!proving) { L.L4.i = Math.min(L.L4.i, 0); L.L5.i = Math.min(L.L5.i, 0); }
    }
    var tgt = on ? {
      sf: L.L1.out, fa: L.L2.out, dmp: L.L3.out, ef: L.L7.out,
      cmp: proving ? L.L4.out : 0, rh: proving ? L.L5.out : 0,
      hum: proving && winter ? L.L6.out : 0
    } : { sf: 0, fa: 0, dmp: 0, ef: 0, cmp: 0, rh: 0, hum: 0 };
    // actuator slew limits (servo 0→90° in ~0.6 s, compressor ramps 10 %/s)
    var slew = { sf: 0.5, fa: 0.5, ef: 0.5, dmp: 1.6, cmp: 0.1, rh: 0.5, hum: 0.5 };
    Object.keys(A).forEach(function (k) {
      var d = tgt[k] - A[k], lim = slew[k] * dt;
      A[k] += d > lim ? lim : (d < -lim ? -lim : d);
    });

    /* ---- air flows ---- */
    x.Qsup = lag(x.Qsup, HW.sfQ * A.sf, dt, 1.2);
    x.Qfa  = lag(x.Qfa,  HW.faQ * A.fa, dt, 1.2);
    x.Qex  = lag(x.Qex,  HW.efQ * A.ef, dt, 1.2);
    var Qsup = x.Qsup, Qfa = Math.min(x.Qfa, Qsup), spill = Math.max(0, x.Qfa - Qsup);
    var Qrec = Math.max(0, Qsup - Qfa), Qexr = Math.max(0, x.Qex - spill);
    var f = Qsup > 1e-3 ? Qfa / Qsup : 0;
    // room pressure: supply in, recirculated + exhaust + leakage out (quasi-static)
    var imb = Qfa - Qexr, dp = Math.sign(imb) * Math.pow(imb / HW.leakK, 2);
    dp = clamp(dp, -150, 150);
    var Qleak = Math.sign(dp) * HW.leakK * Math.sqrt(Math.abs(dp));

    /* ---- air states ---- */
    var C = function (q) { return q * RHO * CP / 3600; };
    var Cs = Math.max(C(Qsup), 1e-3), Cfa = C(Qfa), Cex = C(Qexr);
    var Toa = S.oat, woa = wFromRH(Toa, S.orh), Troom = x.Troom, wroom = x.wroom;
    var sp = P.split / 100, Chr = sp * Cfa, e1 = P.e1 / 100, e2 = P.e2 / 100;
    var T1 = Toa, Tin = Toa, T2 = Toa, R1 = Troom, R2 = Troom, Q1 = 0, Q2 = 0, w2 = woa;
    if (rec && Cfa > 1e-4 && Cex > 1e-4) {
      R1 = x.R1;
      for (var it = 0; it < 4; it++) {
        Q1 = e1 * Math.min(Chr, Cex) * (R1 - Toa);
        T1 = Chr > 1e-5 ? Toa + Q1 / Chr : Toa;
        R2 = R1 - Q1 / Cex;
        Tin = sp * T1 + (1 - sp) * Toa;
        Q2 = e2 * Math.min(Cfa, Cex) * (Troom - Tin);
        T2 = Tin + Q2 / Cfa;
        R1 = Troom - Q2 / Cex;
      }
      x.R1 = R1;
      if (m.hrv === "wheel") w2 = woa + e2 * Math.min(Cfa, Cex) / Cfa * (wroom - woa);
    } else { x.R1 = Troom; }
    var Tmix = f * T2 + (1 - f) * Troom, wmix = f * w2 + (1 - f) * wroom;

    // pre-heat coil (winter): air-pump condenser, or electric in baseline
    x.Qph = lag(x.Qph, winter ? A.cmp * HW.phQ : 0, dt, 8);
    var Tph = Tmix + Math.min(x.Qph / Cs, 45);
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
      if (winter) {
        // the evaporator may not pull the exhaust below −3 °C (frost limit): cap the condenser duty
        var Tc = Tph + 6, Te = R2 - 8;
        cop = clamp(0.5 * (Tc + 273.15) / Math.max(Tc - Te, 8), 1.5, 7);
        var qevMax = Math.max(0, Cx * (R2 + 3)), qMax = qevMax * cop / (cop - 1);
        if (x.Qph > qMax) { x.Qph = qMax; Qhp = qMax; frost = true; }
      } else {
        // the exhaust takes the rejected heat up to 45 °C; the rest goes to the outdoor condenser
        var Te2 = Tsurf - 4, Tc2 = Math.min(45, R2 + 10) + 8;
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
    if (rec && Qhp > 0.01) {
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

    /* ---- electrical power ---- */
    var fan = function (u, pmax, idle) { return u > 0.001 ? idle + pmax * Math.pow(u, 3) : 0; };
    var Pfa = fan(A.fa, HW.faP, 0.5), Pef = 2 * fan(A.ef, HW.efP, 0.2);
    var Pfans = Pfa + Psf + Pef;
    var elecPre = !rec && winter;                  // baseline winter: the pre-heat coil is an electric element
    var Pcmp = elecPre ? 0 : (W > 0.005 ? W + (rec ? 0.8 : 0) : 0);
    var Phum = x.mh * HW.humWh;
    var Pheat = Qptc + Phum + (elecPre ? W : 0);   // CT-103 channel
    var Pctl = on ? HW.ctrlW : 0.6;
    var Pact = Pfans + Pcmp + Pheat + Pctl;

    // baseline twin: same flows and leaving temperatures, no recovery
    var Tmb = f * Toa + (1 - f) * Troom, wmb = f * woa + (1 - f) * wroom, Pb_hc = 0;
    if (winter) Pb_hc = Cs * Math.max(0, Tph - Tmb);
    else Pb_hc = (Cs * Math.max(0, Tmb - Tcc) + msup * HFG * Math.max(0, wmb - wcc)) / P.cop;
    var Pbase = Pb_hc + x.Qrh + Phum + Pfans + Pctl;               // same fans: the rig hardware is the same

    /* ---- sensors ---- */
    var n = function (v) { return noise() * v; };
    s.TT101 = lag(s.TT101, Toa, dt, 5) + n(0.01);
    s.MT101 = lag(s.MT101, S.orh, dt, 8);
    s.FT101 = lag(s.FT101, Qfa, dt, 0.5);
    s.TT102 = lag(s.TT102, Tmix, dt, 3) + n(0.01);
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

    /* ---- bookkeeping ---- */
    Object.assign(a, {
      oa: Toa, woa: woa, t1: T1, tin: Tin, t2: T2, mix: Tmix, ph: Tph, cc: Tcc, rh: Trh, sup: Tsup,
      room: x.Troom, ret: x.Troom, r1: R1, r2: R2, exh: Texh, tsurf: Tsurf,
      wmix: wmix, wsup: wsup, wroom: x.wroom, f: f, Qsup: Qsup, Qfa: Qfa, Qrec: Qrec, Qex: x.Qex,
      Qhr: sp * Qfa, Qdir: (1 - sp) * Qfa, Qleak: Qleak, dp: dp, Q1: Q1, Q2: Q2, Qlat: Qlat,
      dewRoom: dewPoint(x.wroom)
    });
    m.pw = { fa: Pfa, sf: Psf, ef: Pef, fans: Pfans, cmp: Pcmp, ptc: Qptc, hum: Phum, heat: Pheat,
             ctl: Pctl, total: Pact, base: Pbase, W: W, cop: cop, Qhp: Qhp, Qdsh: Math.min(Qdsh, x.Qrh),
             Qrec: Math.abs(Q1) + Math.abs(Q2), Qout: Qout, frost: frost };
    var hrs = dt / 3600;
    m.E.act += Pact * hrs; m.E.base += Pbase * hrs; m.E.t += dt;
    m.E.co2 += Pact * hrs * P.ef; m.E.co2base += Pbase * hrs * P.ef;      // grams (W·h × kg/kWh = g)
    var ab = rec ? m.E.ab.hr : m.E.ab.base; ab.wh += Pact * hrs; ab.t += dt;

    var ach = s.FT102 / ROOM.V;
    m.kpi = {
      ach: ach, achTrue: Qsup / ROOM.V, f: f, red: Pbase > 0.1 ? 1 - Pact / Pbase : 0,
      co2h: Pact * P.ef, co2hBase: Pbase * P.ef,                         // g/h
      annualKWh: Pact * P.hours / 1000, annualBaseKWh: Pbase * P.hours / 1000,
      scale: 5000 / Math.max(P.flow, 0.5)
    };
    alarms(m, dt);
    if (m.t - m._trendT >= 2) { m._trendT = m.t; pushTrend(m); }
  }

  function alarms(m, dt) {
    var s = m.s, P = m.P, S = P[m.season], on = m.on;
    var list = [
      ["A01", "Low supply airflow", on && s.FT102 < 0.8 * P.flow, 20, "serious"],
      ["A02", "Clean-room pressure low", on && s.PDT101 < 5, 25, "serious"],
      ["A03", "Clean-room pressure high", on && s.PDT101 > 40, 15, "warning"],
      ["A04", "Clean-room RH out of band", on && Math.abs(s.MT106 - P.rh) > 10, 120, "warning"],
      ["A05", "Evaporator at frost limit — air pump capped", on && m.recovery && m.season === "winter" && m.pw.frost, 30, "warning"],
      ["A07", "Supply temperature off set point", on && Math.abs(s.TT105 - S.sup) > 2, 90, "warning"],
      ["A08", "ACH below 20 /h (ISO 8 minimum)", on && s.FT102 / ROOM.V < 20, 30, "warning"],
      ["A09", "HEPA ΔP high — check filter", on && s.PDT102 > 450, 10, "warning"]
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

  function pushTrend(m) {
    var s = m.s;
    m.trend.push({ t: m.t, TT101: s.TT101, TT102: s.TT102, TT103: s.TT103, TT105: s.TT105, TT106: s.TT106,
      MT105: s.MT105, MT106: s.MT106, P: m.pw.total, Pb: m.pw.base, ACH: m.kpi.ach, DP: s.PDT101 });
    if (m.trend.length > 450) m.trend.shift();
  }

  function resetEnergy(m) {
    m.E = { act: 0, base: 0, co2: 0, co2base: 0, t: 0, ab: { hr: { wh: 0, t: 0 }, base: { wh: 0, t: 0 } } };
  }

  var RigModel = { create: create, step: step, defaults: defaults, resetEnergy: resetEnergy,
    ROOM: ROOM, HW: HW, wFromRH: wFromRH, rhFromW: rhFromW, dewPoint: dewPoint, clamp: clamp };
  if (typeof module !== "undefined" && module.exports) module.exports = RigModel;
  else root.RigModel = RigModel;
})(this);
