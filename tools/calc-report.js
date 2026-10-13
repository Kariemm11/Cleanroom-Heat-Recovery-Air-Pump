/* Engineering calculation report for the clean-room heat-recovery air-pump rig.

   Runs the simulator's own plant model (assets/js/rig-model.js) at the design and extreme
   seasons, reads the duct geometry exported from the 3D model (cad/rig-geometry.json),
   and writes build-pack/07-engineering-calculations.md with every equation and number.

   Usage:  node tools/calc-report.js            (from the repository root)              */
"use strict";
const fs = require("fs");
const path = require("path");
const R = require("../assets/js/rig-model.js");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "build-pack", "07-engineering-calculations.md");
const geo = JSON.parse(fs.readFileSync(path.join(ROOT, "cad", "rig-geometry.json"), "utf8"));

/* ------------------------------------------------------------------ constants */
const RHO = 1.2, CP = 1006, HFG = 2501e3, MU = 1.81e-5, EPS = 1.5e-6, PATM = 101325;
const f0 = (v) => (Math.round(v)).toLocaleString("en-US").replace(/,/g, " ");
const f1 = (v) => v.toFixed(1), f2 = (v) => v.toFixed(2), f3 = (v) => v.toFixed(3);
const sig = (v, n = 3) => (v === 0 ? "0" : Number(v.toPrecision(n)).toString());

/* ------------------------------------------------------- run the plant model */
function run(season, over = {}) {
  const m = R.create({ season });
  if (over.S) Object.assign(m.P[season], over.S);
  if (over.P) Object.assign(m.P, over.P);
  if (over.rec === false) m.recovery = false;
  if (over.damper !== undefined) { m.loops.L3.man = true; m.loops.L3.mv = over.damper; }   // fixed fresh-air fraction
  for (let i = 0; i < 36000; i++) R.step(m, 0.05);          // 30 simulated minutes, 50 ms steps
  return { m, a: { ...m.a }, pw: { ...m.pw }, kpi: { ...m.kpi }, s: { ...m.s }, act: { ...m.act },
    mh: m.x.mh, Qrh: m.x.Qrh, Qph: m.x.Qph, Qcc: m.x.Qcc, coilSP: m.coilSP, alarms: m.alarms.map((x) => x.id) };
}
const CASES = {
  win: run("winter"),
  sum: run("summer"),
  winBase: run("winter", { rec: false }),
  sumBase: run("summer", { rec: false }),
  winX: run("winter", { S: { oat: -10, orh: 80 } }),
  sumX: run("summer", { S: { oat: 42, orh: 35 } }),
  // fair A/B comparison: the same fresh-air fraction in both runs (damper L3 in manual)
  win30: run("winter", { damper: 0.3 }), win30b: run("winter", { damper: 0.3, rec: false }),
  win50: run("winter", { damper: 0.5 }), win50b: run("winter", { damper: 0.5, rec: false }),
  sum30: run("summer", { damper: 0.3 }), sum30b: run("summer", { damper: 0.3, rec: false }),
};
const D = CASES.win.a;                                         // design flows (winter, recovery on)

/* -------------------------------------------------------------- duct geometry */
function polyLen(p) { let L = 0; for (let i = 0; i < p.length - 1; i++) L += Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]); return L; }
function bends(p) {                                           // deflection angle at every interior vertex, degrees
  const out = [];
  for (let i = 1; i < p.length - 1; i++) {
    const a = [0, 1, 2].map((k) => p[i][k] - p[i - 1][k]), b = [0, 1, 2].map((k) => p[i + 1][k] - p[i][k]);
    const la = Math.hypot(...a), lb = Math.hypot(...b);
    const c = Math.max(-1, Math.min(1, (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (la * lb)));
    out.push(Math.acos(c) * 180 / Math.PI);
  }
  return out;
}
const ductRec = {};
geo.forEach((x) => { const c = x.geo.cad; if (c && c.type === "duct") ductRec[x.part] = c; });
function rectRec(name) { return geo.find((x) => x.part === name); }

function friction(Re, Dm) {
  const lam = (r) => 64 / r;
  const turb = (r) => 0.25 / Math.pow(Math.log10(EPS / (3.7 * Dm) + 5.74 / Math.pow(r, 0.9)), 2);
  if (Re < 2300) return { f: lam(Math.max(Re, 1)), regime: "laminar" };
  if (Re > 4000) return { f: turb(Re), regime: "turbulent" };
  const t = (Re - 2300) / 1700;
  return { f: lam(2300) * (1 - t) + turb(4000) * t, regime: "transitional" };
}
const K90 = 0.35;                                             // smooth bend, R/D ≈ 0.8 (rig bends are swept at 1.6 r)
function ductCalc(name, Q, Dm, L, angles, kExtra, note, rect) {
  const A = rect ? rect.a * rect.b : Math.PI * Dm * Dm / 4;
  const v = Q / 3600 / A, Re = RHO * v * Dm / MU, fr = friction(Re, Dm);
  const pd = RHO * v * v / 2;
  const kb = angles.reduce((s, a) => s + K90 * a / 90, 0);
  const dpf = fr.f * L / Dm * pd, dpk = (kb + kExtra) * pd;
  const Dfor3 = Math.sqrt(4 * Q / 3600 / (Math.PI * 3.0));    // diameter that would give 3 m/s
  return { name, Q, Dm, A, v, Re, f: fr.f, regime: fr.regime, L, nb: angles.length, kb, kExtra, pd, dpf, dpk, dp: dpf + dpk, Dfor3, note, rect };
}
const Qret = D.Qsup - D.Qleak;
const ducts = [];
function addTube(part, Q, kExtra, note) {
  const c = ductRec[part]; if (!c) throw new Error("no duct " + part);
  ducts.push(ductCalc(part, Q, 2 * c.r / 100, polyLen(c.pts) / 100, bends(c.pts), kExtra, note));
}
// louvre → compressor intake (open cylinder in the compressor group: Ø38 mm, ≈5 cm)
ducts.push(ductCalc("Intake: louvre → fresh-air compressor", D.Qfa, 0.038, 0.05, [], 0.5, "entry K 0.5"));
addTube("Compressor discharge", D.Qfa, 0.2, "outlet transition");
addTube("Fresh-air header", D.Qfa, 0.0, "full fresh-air flow");
addTube("Header → recovery unit (fresh lane)", D.Qhr, 1.0, "branch take-off K 1.0");
addTube("Header → AHU outdoor-air intake", D.Qdir, 1.0, "branch take-off K 1.0");
addTube("Tempered-air duct: recovery unit → AHU", D.Qhr, 0.2, "");
addTube("Extract transfer duct: AHU → recovery unit", D.Qex, 0.2, "");
addTube("Exhaust duct: recovery unit → louvre", D.Qex, 1.0, "exit to louvre K 1.0");
(function () {
  const b = rectRec("Supply boot").geo.p;                       // flow along z: section width × height
  const a = b.width / 100, h = b.height / 100, Dh = 2 * a * h / (a + h);
  ducts.push(ductCalc("Supply boot (rectangular " + f0(b.width * 10) + " × " + f1(b.height * 10) + " mm)", D.Qsup, Dh, b.depth / 100, [90], 0.3, "Dh = 2ab/(a+b)", { a, b: h }));
  const r = rectRec("Return duct").geo.p;                       // flow along x: section depth × height
  const a2 = r.depth / 100, h2 = r.height / 100, Dh2 = 2 * a2 * h2 / (a2 + h2);
  ducts.push(ductCalc("Return duct (rectangular " + f0(r.depth * 10) + " × " + f1(r.height * 10) + " mm)", Qret, Dh2, r.width / 100, [], 0.5, "Dh = 2ab/(a+b); entry from grille 1", { a: a2, b: h2 }));
})();
(function () {                                                  // the riser carries the full flow to the diffuser-1 tee, half after it
  const c = ductRec["Supply riser"], p = c.pts, Dm = 2 * c.r / 100;
  let L1 = 0, i = 0;
  for (; i < p.length - 1; i++) {
    const seg = Math.hypot(p[i + 1][0] - p[i][0], p[i + 1][1] - p[i][1], p[i + 1][2] - p[i][2]);
    if (p[i][2] === 0 && p[i + 1][2] === 0 && p[i][0] <= 14 && p[i + 1][0] >= 14) { L1 += 14 - p[i][0]; break; }
    L1 += seg;
  }
  const Lall = polyLen(p), ang = bends(p);
  ducts.push(ductCalc("Supply riser, up to the diffuser-1 tee", D.Qsup, Dm, L1 / 100, ang.slice(0, i), 0.3, "full supply flow"));
  ducts.push(ductCalc("Supply riser, tee → diffuser 2", D.Qsup / 2, Dm, (Lall - L1) / 100, ang.slice(i), 0.4, "half the flow; tee run K 0.4"));
})();
addTube("Diffuser drop 1", D.Qsup / 2, 1.0, "tee branch K 1.0");
addTube("Return branch (grille 2)", Qret / 2, 0.5, "entry from grille 2");
const DK = Object.fromEntries(ducts.map((d) => [d.name, d]));
const dpOf = (prefix) => ducts.filter((d) => d.name.startsWith(prefix)).reduce((s, d) => s + d.dp, 0);

/* ----------------------------------------------- component pressure drops */
// Face areas from the CAD (AHU section ≈ 22.6 × 32.5 mm, coils 19.3 × 32 mm)
const Aface = 0.0226 * 0.0325, vface = D.Qsup / 3600 / Aface;
const kv = (dp0, v0, v, n = 1.8) => dp0 * Math.pow(v / v0, n);
// clean / final values for filters (manufacturer-style ratings scaled to the face velocity)
const COMP = {
  louvre: { clean: kv(8, 2.0, D.Qfa / 3600 / 1.6e-4 / 4, 2) + 4 },
  oaPre: { clean: 40, final: 150, note: "ISO Coarse 60 % panel" },
  hrFilter: { clean: 40, final: 150, note: "air-pump unit fresh-air filter" },
  hrCore: { clean: 30, note: "crossflow core, each stream" },
  ahuCore: { clean: 30, note: "plate core, each stream" },
  damper: { clean: 5, note: "open blade, ≈2.6 m/s" },
  panel: { clean: 40, final: 150, note: "ePM10 50 % panel" },
  bag: { clean: 80, final: 250, note: "ePM1 55 % bag" },
  pre: { clean: kv(25, 2.5, vface), note: "dry, 2-row micro coil" },
  cool: { clean: kv(25, 2.5, vface) * 1.3, note: "wet in summer (+30 %)" },
  reheat: { clean: 10, note: "finned PTC element" },
  elim: { clean: 8, note: "droplet eliminator" },
  steam: { clean: 3, note: "steam lance" },
  hepa: { clean: CASES.win.s.PDT102, final: 450, note: "H13; PDT-102 alarm at 450 Pa" },
  atten: { clean: 8, note: "attenuator" },
  diff: { clean: 3.0 * RHO * Math.pow(D.Qsup / 2 / 3600 / (Math.PI * 0.025 * 0.025 / 4), 2) / 2, note: "neck Ø25 mm, K 3.0" },
  grille: { clean: 2.5 * RHO * Math.pow(Qret / 2 / 3600 / 7.5e-4, 2) / 2, note: "free area ≈7.5 cm², K 2.5" },
  exPre: { clean: 40, final: 150, note: "extract pre-filter" },
  exBag: { clean: 80, final: 250, note: "extract bag filter" },
  hrExFilter: { clean: 40, final: 150, note: "air-pump unit exhaust filter" },
  exCoil: { clean: 20, note: "exhaust-air coil (evaporator)" },
  passive: { clean: 5, note: "unpowered tempered-air fan" },
};
const mid = (c) => (c.final ? (c.clean + c.final) / 2 : c.clean);
const fin = (c) => (c.final ? c.final : c.clean);
function budget(items) {
  let a = 0, b = 0, c = 0;
  items.forEach((it) => { const v = typeof it[1] === "number" ? { clean: it[1] } : it[1]; it.v = v; a += v.clean; b += mid(v); c += fin(v); });
  return { items, clean: a, mid: b, final: c };
}
const pRoom = CASES.win.m.P.dp;
// supply fan: recirculating loop (room pressure cancels around the loop)
const supLoop = budget([
  ["Mixing damper (recirculation side)", COMP.damper], ["Panel filter", COMP.panel], ["Bag filter", COMP.bag],
  ["Pre-heat coil", COMP.pre], ["Cooling coil (wet)", COMP.cool], ["Reheat coil", COMP.reheat],
  ["Droplet eliminator", COMP.elim], ["Steam lance", COMP.steam], ["H13 HEPA", COMP.hepa], ["Attenuator", COMP.atten],
  ["Supply boot (duct)", dpOf("Supply boot")], ["Supply riser (duct)", dpOf("Supply riser")],
  ["Ceiling diffuser", COMP.diff], ["Return grilles", COMP.grille], ["Return duct (duct)", dpOf("Return duct")],
  ["Extract pre-filter (recirculated air)", COMP.exPre],
]);
// fresh-air compressor: lab (0 Pa) → mixing box, which sits at room pressure − return losses
const pMix = pRoom - COMP.grille.clean - dpOf("Return duct") - COMP.exPre.clean;
const hrLane = budget([
  ["Header → recovery unit lane (duct)", dpOf("Header → recovery unit")], ["Recovery-unit fresh-air filter", COMP.hrFilter],
  ["Crossflow core, fresh side", COMP.hrCore], ["Tempered-air fan (unpowered)", COMP.passive], ["Tempered-air duct", dpOf("Tempered-air duct")],
]);
const dirLane = budget([["Header → AHU intake (duct)", dpOf("Header → AHU outdoor-air intake")]]);
const balDP = hrLane.clean - dirLane.clean;                      // the direct branch must waste this to hold the split
const Qdir = D.Qdir / 3600, Aor = Qdir / (0.61 * Math.sqrt(2 * Math.max(balDP, 0.1) / RHO)), Dor = Math.sqrt(4 * Aor / Math.PI);
const faPath = budget([
  ["Louvre + bird mesh", COMP.louvre.clean], ["Intake (duct)", dpOf("Intake")], ["Compressor discharge (duct)", dpOf("Compressor discharge")],
  ["Fresh-air header (duct)", dpOf("Fresh-air header")], ["Recovery-unit lane (filter, core, ducts; the direct branch is balanced to it)", hrLane.clean],
  ["AHU outdoor-air pre-filter", COMP.oaPre], ["AHU plate core, fresh side", COMP.ahuCore], ["Outdoor-air damper", COMP.damper],
  ["Back-pressure of the mixing box (gauge)", pMix],
]);
// exhaust fans in series: extract deck (room − grille − return duct) → outdoors (0 Pa)
const exPath = budget([
  ["Extract pre-filter", COMP.exPre], ["Extract bag filter", COMP.exBag], ["AHU plate core, exhaust side", COMP.ahuCore],
  ["Extract transfer duct", dpOf("Extract transfer duct")], ["Recovery-unit exhaust filter", COMP.hrExFilter],
  ["Crossflow core, exhaust side", COMP.hrCore], ["Exhaust-air coil", COMP.exCoil], ["Exhaust duct", dpOf("Exhaust duct")],
  ["Exhaust louvre", COMP.louvre.clean], ["Less: pressure available in the extract deck", -(pRoom - COMP.grille.clean - dpOf("Return duct"))],
]);

/* --------------------------------------------------------- electrical sizing */
const loads = [
  ["FAN-101 fresh-air compressor", 24, 0.5 + R.HW.faP, "max speed"],
  ["FAN-102 supply fan", 24, 0.3 + R.HW.sfP, "max speed"],
  ["FAN-103 2 × exhaust fans", 24, 2 * (0.2 + R.HW.efP), "max speed"],
  ["CMP-101 compressor + driver", 24, 25, "≈ 60 W cooling ÷ COP 3 + driver 5 W; start current limited by the driver"],
  ["HTR-101 PTC reheat", 24, R.HW.rhQ, "self-limiting PTC"],
  ["HUM-101 steam humidifier", 24, R.HW.humG * R.HW.humWh, f0(R.HW.humG) + " g/h × " + R.HW.humWh + " Wh/g"],
  ["EEV-101 stepper (DRV8825, current-limited)", 24, 2, "holding current reduced after a move"],
  ["RV-101 4-way valve coil", 24, 5, "energised in one season only"],
  ["D6F flow sensors ×2", 24, 0.6, ""],
  ["5 V rail: servo (stall 2.5 A peak), HMI 7\" (≈2 W), ACS712 ×3, SPS30 ×2 (≈0.4 W each)", 24, 15, "via the 24 → 5 V 3 A buck, 90 % efficient"],
  ["3.3 V: ESP32-S3, TCA9548A, SHT31 ×3, SDP810 ×2, DS18B20 ×5", 24, 1.5, "from the 5 V rail"],
];
const Ptotal = loads.reduce((s, l) => s + l[2], 0);
function ipcWidth(I, dT = 10, oz = 1, external = true) {     // IPC-2221: I = k·ΔT^0.44·A^0.725, A in mil²
  const k = external ? 0.048 : 0.024, A = Math.pow(I / (k * Math.pow(dT, 0.44)), 1 / 0.725);
  return A / (oz * 1.378) * 0.0254;                            // mm
}

/* -------------------------------------------------------------- write markdown */
const L = [];
const P = (s = "") => L.push(s);
const tbl = (head, rows) => { P("| " + head.join(" | ") + " |"); P("|" + head.map(() => "---").join("|") + "|"); rows.forEach((r) => P("| " + r.join(" | ") + " |")); P(); };
const W = CASES.win, S = CASES.sum, WB = CASES.winBase, SB = CASES.sumBase, WX = CASES.winX, SX = CASES.sumX;

P("# Engineering calculations: clean-room heat-recovery air-pump rig");
P();
P("This document has every equation the simulator and the firmware use, and the sizing calculations for building the rig: ducts, fans, actuators, refrigerant circuit and electrics. **Every number is generated** by `tools/calc-report.js`. That script runs the simulator's plant model (`assets/js/rig-model.js`) and reads the duct geometry from the 3D model (`cad/rig-geometry.json`). Rerun it after any change, so the document never drifts from the model:");
P();
P("```bash\nnode tools/calc-report.js\n```");
P();
P("Notation: Q = volume flow (m³/h unless stated), ṁ = mass flow (kg/s), T = temperature (°C), w = humidity ratio (kg/kg dry air), C = heat-capacity rate (W/K), ΔP = pressure difference (Pa), u = actuator output (0 … 1).");
P();
P("## Contents");
["1. Constants and the rig", "2. Psychrometrics", "3. Air-side model", "4. Heat-recovery cores", "5. Coils, humidifier and fan heat", "6. Air pump (heat pump) model",
 "7. Clean-room balances: heat, moisture, pressure, particles, ACH", "8. Control: PI loops, sequencing, interlocks, alarms", "9. Energy, baseline twin and carbon",
 "10. Operating points (computed)", "11. Duct sizing", "12. Fan selection: system pressure budgets", "13. Actuator sizing", "14. Refrigerant circuit sizing",
 "15. Electrical sizing: power budget, supply, currents, fuses, PCB traces", "16. Sensor scaling and ranges", "17. Fit check: what fits inside the scaled AHU", "18. Assumptions to verify on the real rig"].forEach((t) => P("- " + t));
P();

/* 1 */
P("## 1. Constants and the rig");
P();
tbl(["Symbol", "Value", "Meaning"], [
  ["ρ", RHO + " kg/m³", "air density (20 °C, sea level)"], ["c_p", CP + " J/(kg·K)", "specific heat of dry air"],
  ["h_fg", "2 501 kJ/kg", "latent heat of water at 0 °C (enthalpy reference)"], ["μ", "1.81 × 10⁻⁵ Pa·s", "dynamic viscosity of air"],
  ["P_atm", "101 325 Pa", "barometric pressure"], ["ε", "0.0015 mm", "roughness of PVC / PETG duct"],
  ["V_room", f3(R.ROOM.V * 1000) + " L = " + f3(R.ROOM.V) + " m³", "clean room, net " + R.ROOM.L * 1000 + " × " + R.ROOM.W * 1000 + " × " + R.ROOM.H * 1000 + " mm"],
  ["A_floor", f3(R.ROOM.A) + " m²", "clean-room floor"],
  ["C_room", R.HW.croom + " J/K", "room air + inner acrylic skin (thermal mass)"], ["m_room", R.HW.mroom + " kg", "effective moisture buffer"],
  ["k_leak", R.HW.leakK + " m³/(h·√Pa)", "room leakage coefficient"],
]);
P("Fan and actuator ratings used by the model (rig hardware at 100 % output):");
P();
tbl(["Item", "Rating"], [
  ["FAN-102 supply fan", R.HW.sfQ + " m³/h free air, " + R.HW.sfP + " W shaft-equivalent electrical"],
  ["FAN-101 fresh-air compressor", R.HW.faQ + " m³/h, " + R.HW.faP + " W"], ["FAN-103 exhaust fans", R.HW.efQ + " m³/h, 2 × " + R.HW.efP + " W"],
  ["Pre-heat coil (air-pump condenser, winter)", R.HW.phQ + " W"], ["Cooling coil (air-pump evaporator, summer)", R.HW.ccQ + " W"],
  ["Reheat (PTC + desuperheater)", R.HW.rhQ + " W PTC"], ["Steam humidifier", R.HW.humG + " g/h, " + R.HW.humWh + " Wh per g of steam"],
  ["Controls (ESP32-S3 + 7\" HMI + sensors)", R.HW.ctrlW + " W"],
]);

/* 2 */
P("## 2. Psychrometrics");
P();
P("Saturation vapour pressure (Magnus form, Alduchov–Eskridge coefficients, −40 … 50 °C):");
P("```\np_ws(T) = 610.94 · exp( 17.625·T / (T + 243.04) )            [Pa, T in °C]\n```");
P("Humidity ratio, relative humidity, dew point and enthalpy:");
P("```\nw   = 0.622 · p_w / (P_atm − p_w),        p_w = RH/100 · p_ws(T)\nRH  = 100 · p_w / p_ws(T),               p_w = w · P_atm / (0.622 + w)\nT_dp = 243.04 · a / (17.625 − a),          a = ln(p_w / 610.94)\nh   = 1.006·T + w·(2501 + 1.86·T)          [kJ/kg dry air]\n```");
P("Check at the winter design point: outdoor " + W.m.P.winter.oat + " °C / " + W.m.P.winter.orh + " % gives w = " + f2(R.wFromRH(W.m.P.winter.oat, W.m.P.winter.orh) * 1000) + " g/kg. The room at " + f1(W.a.room) + " °C / " + f1(W.s.MT106) + " % gives w = " + f2(W.a.wroom * 1000) + " g/kg, with a dew point of " + f1(W.a.dewRoom) + " °C.");
P();

/* 3 */
P("## 3. Air-side model");
P();
P("Fan flow follows speed, with a first-order lag (τ = 1.2 s). Fan power follows the cube law (affinity laws), plus an idle term:");
P("```\nQ_fan = Q_max · u          P_fan = P_idle + P_max · u³          (Q ∝ n, ΔP ∝ n², P ∝ n³)\n```");
P("Flow bookkeeping, where Q_sup is the supply, Q_fa the fresh air and Q_ex the exhaust:");
P("```\nQ_fa,eff = min(Q_fa, Q_sup)          spill = max(0, Q_fa − Q_sup)\nQ_rec = Q_sup − Q_fa,eff             f = Q_fa,eff / Q_sup     (fresh-air fraction)\nQ_hr = s · Q_fa,eff                  Q_dir = (1 − s) · Q_fa,eff     s = split to the air-pump unit\n```");
P("Mixing box, by mass and energy balance with equal densities:");
P("```\nT_mix = f · T_2 + (1 − f) · T_room          w_mix = f · w_2 + (1 − f) · w_room\n```");
P("Heat-capacity rate of an air stream: `C = Q · ρ · c_p / 3600` [W/K], with Q in m³/h. At the " + f1(D.Qsup) + " m³/h design supply, C_sup = " + f3(D.Qsup * RHO * CP / 3600) + " W/K.");
P();

/* 4 */
P("## 4. Heat-recovery cores (two-core cascade)");
P();
P("Each core uses the effectiveness definition, ε = actual heat transferred ÷ the maximum possible. The fresh air passes the air-pump unit's crossflow core (ε₁) and then the AHU's plate core (ε₂). The exhaust passes them in the opposite order (AHU core first, then the air-pump unit core), so the two equations are coupled. The model iterates them four times:");
P("```\nQ₁ = ε₁ · min(C_hr, C_ex) · (R₁ − T_oa)        T₁ = T_oa + Q₁ / C_hr          R₂ = R₁ − Q₁ / C_ex\nT_in = s · T₁ + (1 − s) · T_oa                 (the air-pump lane meets the direct branch)\nQ₂ = ε₂ · min(C_fa, C_ex) · (T_room − T_in)     T₂ = T_in + Q₂ / C_fa         R₁ = T_room − Q₂ / C_ex\n```");
P("With a rotary wheel instead of the plate core, moisture is also recovered: `w₂ = w_oa + ε₂ · min(C_fa,C_ex)/C_fa · (w_room − w_oa)`.");
P();
P("Winter design result: T_oa = " + f1(W.a.oa) + " °C → T₁ = " + f1(W.a.t1) + " °C (air-pump core), T_in = " + f1(W.a.tin) + " °C, T₂ = " + f1(W.a.t2) + " °C (after the AHU core). Exhaust: " + f1(W.a.r1) + " → " + f1(W.a.r2) + " °C. Recovered: Q₁ + Q₂ = " + f1(W.pw.Qrec) + " W.");
P();

/* 5 */
P("## 5. Coils, humidifier and fan heat");
P();
P("Pre-heat coil (winter; the air-pump condenser, or an electric element in the baseline):");
P("```\nT_ph = T_mix + Q_ph / C_sup          Q_ph = u_cmp · Q_ph,max   (lag τ = 8 s)\n```");
P("Cooling coil (summer; the air-pump evaporator) uses the **bypass-factor** method (BF = 0.15). A fraction BF of the air passes untouched and the rest leaves at the coil surface (apparatus dew point) temperature T_s. The coil duty Q_cc is split into sensible and latent parts by bisection:");
P("```\nΔT = T_ph − T_cc            T_s = T_ph − ΔT / (1 − BF)            w_s = w_sat(T_s)\nw_cc = BF · w_mix + (1 − BF) · w_s   (only if w_mix > w_s, i.e. the coil is wet)\nQ_lat = ṁ · h_fg · (w_mix − w_cc)        C_sup · ΔT + Q_lat = Q_cc\n```");
P("Reheat (desuperheater first, then the PTC trim): `T_rh = T_cc + Q_rh / C_sup`. The steam humidifier is isothermal: `w_sup = w_cc + ṁ_steam / (ρ · Q_sup)`. Supply-fan heat: `T_sup = T_rh + P_sf / C_sup`.");
P();

/* 6 */
P("## 6. Air pump (heat pump) model");
P();
P("The COP is taken as half the Carnot COP between condensing and evaporating temperatures. That is a realistic second-law efficiency for small vapour-compression units:");
P("```\nWinter (heating):  T_c = T_ph + 6 K,  T_e = R₂ − 8 K,   COP_h = 0.5 · (T_c + 273.15) / (T_c − T_e)     clamp 1.5 … 7\nSummer (cooling):  T_e = T_s − 4 K,   T_c = min(45, R₂ + 10) + 8 K,   EER = 0.5 · (T_e + 273.15) / (T_c − T_e)\nCompressor power:  W = Q_coil / COP\n```");
P("**Frost limit (winter).** The evaporator may not cool the exhaust below −3 °C. That caps the heat it can absorb, and so the condenser duty:");
P("```\nQ_ev,max = C_ex · (R₂ + 3)          Q_cond,max = Q_ev,max · COP / (COP − 1)          (alarm A05 when capped)\n```");
P("**Summer heat rejection.** The exhaust stream takes the rejected heat until it reaches 45 °C, and an outdoor condenser takes the rest. 30 % of (Q_cc + W) is available as free desuperheater reheat:");
P("```\nQ_rej = Q_cc + W − Q_dsh,used          Q_air,max = C_ex · (45 − R₂)          Q_out = max(0, Q_rej − Q_air,max)\n```");
P();

/* 7 */
P("## 7. Clean-room balances");
P();
P("**Heat** (lumped room air + inner acrylic skin):");
P("```\nC_room · dT_room/dt = C_sup · (T_sup − T_room) + Q_gain + UA · (T_lab − T_room)\n```");
P("**Moisture:**");
P("```\nm_room · dw_room/dt = ṁ_sup · (w_sup − w_room) + G_w          (G_w = moisture gain, kg/s)\n```");
P("**Pressure and leakage.** This is an orifice law, so the leak flow grows with the square root of the pressure:");
P("```\nQ_leak = k · √ΔP       ΔP = ((Q_fa − Q_ex) / k)²       (the imbalance fresh − exhaust leaves through the leaks)\nequivalent leakage area:  A_L = Q_leak / (C_d · √(2·ΔP/ρ))      C_d = 0.61\n```");
const Ql15 = R.HW.leakK * Math.sqrt(15), AL = Ql15 / 3600 / (0.61 * Math.sqrt(2 * 15 / RHO));
P("At +15 Pa: Q_leak = " + R.HW.leakK + " × √15 = " + f2(Ql15) + " m³/h, so A_L = " + f1(AL * 1e6) + " mm². That is the door gaps, the pass-box seals and the cable glands together. The exhaust fans hold the room **" + f2(Ql15) + " m³/h below the fresh air**. More exhaust lowers the pressure; less raises it.");
P();
P("**Air changes per hour.** ACH divides by the room *volume*. A rate per hour needs volume; dividing by floor area would give a velocity (m/h), not air changes:");
P("```\nACH = Q_sup / V_room = " + f1(D.Qsup) + " / " + f3(R.ROOM.V) + " = " + f1(D.Qsup / R.ROOM.V) + " /h\n```");
P("**Airborne particles** (≥0.5 µm, well-mixed room):");
P("```\nV · dC/dt = Q_sup·C_sup + Q_in·C_lab + G − Q_out·C          Q_out = Q_sup + Q_in\nC_sup = C_mix · (1 − η_bag) · (1 − η_HEPA)      η_bag = 0.64,  η_HEPA = 0.99995 at 0.5 µm (H13 is ≥ 99.95 % at MPPS)\nC_mix = f · 0.9·C_oa + (1 − f) · C         Q_in = max(0, −Q_leak) + 0.08·exp(−ΔP/3 Pa)\nsteady state:  C* = (Q_sup·C_sup + Q_in·C_lab + G) / Q_out\nfill point (first air under the RABS):  C_A = C_sup + (1 − κ)·C + 250,   κ = 0.99 · min(1, Q_sup / (0.6·Q_set))\nrecovery to 1 % (100:1):  t = ln(100) / ACH = 4.6 / ACH  [h]\n```");
const G = W.m.P.gen * 60;
P("Default shedding G = " + f0(W.m.P.gen) + " /min = " + f0(G) + " /h. So C* ≈ G / Q_sup = " + f0(G / D.Qsup) + " /m³ (Grade B in operation, limit 352 000). The model gives " + f0(W.a.Cp) + " /m³ in the room and " + f0(W.a.CA) + " /m³ at the fill point (Grade A limit 3 520). Recovery 100:1 takes " + f1(4.6 / (D.Qsup / R.ROOM.V) * 60) + " min. EU GMP Annex 1 guides 15–20 min.");
P();

/* 8 */
P("## 8. Control");
P();
P("Every loop is a PI controller with clamping anti-windup, run every Δt (the firmware uses 100 ms). The error is normalised so that the gains are dimensionless:");
P("```\ne_k = (SP − PV) / span                     (sign flipped for reverse-acting loops)\nI_k = clamp( I_{k−1} + K_p · e_k · Δt / T_i ,  u_min, u_max )\nu_k = clamp( K_p · e_k + I_k ,  u_min, u_max )\nmanual: u_k = MV,  I_k = MV − K_p·e_k   (bumpless return to auto)\n```");
const LP = W.m.loops;
tbl(["Loop", "PV → MV", "Error (normalised)", "K_p", "T_i (s)", "Output limits"], [
  ["L1", "FT-102 → FAN-102", "(Q_set − FT102) / 20", LP.L1.kp, LP.L1.ti, "0 … 1"],
  ["L2", "FT-101 → FAN-101", "(u_dmp·FT102 − FT101) / 20", LP.L2.kp, LP.L2.ti, "0 … 1"],
  ["L3", "TT-102 → SV-101", "(TT102 − T_mix,set) / 50 · (+1 if TT101 < TT107 else −1)", LP.L3.kp, LP.L3.ti, "min fresh air … 1"],
  ["L4", "TT-103 (winter) / TT-104 (summer) → CMP-101", "±(T_coil,set − PV) / 50", LP.L4.kp, LP.L4.ti, "0 … 1"],
  ["L5", "TT-105 → HTR-101", "(T_sup,set − TT105) / 50", LP.L5.kp, LP.L5.ti, "0 … 1"],
  ["L6", "MT-106 → HUM-101 (winter) / coil reset (summer)", "±(RH_set − MT106) / 100", LP.L6.kp, LP.L6.ti, "0 … 1"],
  ["L7", "PDT-101 → FAN-103", "(PDT101 − ΔP_set) / 100", LP.L7.kp, LP.L7.ti, "0 … 1"],
]);
P("**Sequencing and interlocks:**");
P("- Airflow proving: `FT102 > 0.25·Q_set and FT102 > 0.5 m³/h`. Without it the compressor, PTC and humidifier stay off, and the integrators of L4 and L5 are held at ≤ 0.");
P("- L3 is economiser-style: when the outdoor air is warmer than the return (TT101 ≥ TT107), the damper action reverses. Its low limit is the minimum fresh air (" + W.m.P.oa + " %).");
P("- Summer dehumidification: `T_coil,set = T_coil,set,0 − 6 K · u_L6` (cooling-coil reset).");
P("- Slew limits per second: fans 0.5, servo 1.6 (0 → 90° in ≈0.6 s), compressor 0.1 (10 %/s ramp), PTC and humidifier 0.5.");
P("- Firmware only (real hardware protection): compressor minimum off-time 180 s and minimum run 120 s. The reversing valve switches only after the compressor has been off 30 s. The humidifier is blocked when MT-105 > 85 %. The PTC is blocked if FAN-102's tach shows < 300 rpm.");
P();
tbl(["Alarm", "Condition", "Delay (s)", "Severity"], [
  ["A01", "FT-102 < 0.8 · Q_set", 20, "serious"], ["A02", "PDT-101 < 5 Pa", 25, "serious"], ["A03", "PDT-101 > 40 Pa", 15, "warning"],
  ["A04", "|MT-106 − RH_set| > 10 %", 120, "warning"], ["A05", "evaporator at the frost limit (winter, recovery on)", 30, "warning"],
  ["A07", "|TT-105 − T_sup,set| > 2 K", 90, "warning"], ["A08", "ACH < 20 /h", 30, "warning"], ["A09", "PDT-102 > 450 Pa (HEPA loaded)", 10, "warning"],
  ["A10", "room ≥0.5 µm > 70 % of 352 000 /m³", 60, "warning"], ["A11", "room ≥0.5 µm > 352 000 /m³", 30, "serious"], ["A12", "fill point ≥0.5 µm > 3 520 /m³", 30, "serious"],
]);

/* 9 */
P("## 9. Energy, baseline twin and carbon");
P();
P("Measured electrical power, from the current sensors and the DC bus voltage:");
P("```\nP = V_bus · (I_CT101 + I_CT102 + I_CT103) + P_ctrl          E = ∫ P dt  [Wh]\n```");
P("The **baseline twin** is the same rig, the same flows and the same leaving temperatures, with no recovery. It is computed from measured values only, so the firmware can run it too:");
P("```\nT_mb = f·TT101 + (1 − f)·TT107         w_mb = f·w(TT101,MT101) + (1 − f)·w(TT106,MT106)         f = FT101 / FT102\nwinter:  P_hc,base = C_sup · max(0, TT103 − T_mb)                                   (electric pre-heat)\nsummer:  P_hc,base = [C_sup · max(0, T_mb − TT104) + ṁ·h_fg · max(0, w_mb − w_cc)] / COP_base   (plain chiller, COP " + W.m.P.cop + ")\nP_base = P_hc,base + P_reheat + P_hum + P_fans + P_ctrl\nsaving = 1 − P / P_base           CO₂ [g] = E [Wh] × EF [kg/kWh]    (EF = " + W.m.P.ef + " kg/kWh, editable)\nannual = P × h_year / 1000 [kWh]        scale-up to a 5 000 m³/h AHU:  × 5000 / Q_sup  (indicative)\n```");
P();

/* 10 */
P("## 10. Operating points (computed by the model, after 30 simulated minutes)");
P();
const op = (c) => c;
tbl(["Quantity", "Winter design", "Summer design", "Winter −10 °C", "Summer 42 °C"], [
  ["Outdoor °C / RH %", f1(W.a.oa) + " / " + W.m.P.winter.orh, f1(S.a.oa) + " / " + S.m.P.summer.orh, f1(WX.a.oa) + " / 80", f1(SX.a.oa) + " / 35"],
  ["Supply Q_sup (m³/h)", f2(W.a.Qsup), f2(S.a.Qsup), f2(WX.a.Qsup), f2(SX.a.Qsup)],
  ["Fresh air Q_fa (m³/h), fraction f", f2(W.a.Qfa) + ", " + f2(W.a.f), f2(S.a.Qfa) + ", " + f2(S.a.f), f2(WX.a.Qfa) + ", " + f2(WX.a.f), f2(SX.a.Qfa) + ", " + f2(SX.a.f)],
  ["Exhaust Q_ex (m³/h)", f2(W.a.Qex), f2(S.a.Qex), f2(WX.a.Qex), f2(SX.a.Qex)],
  ["After air-pump core T₁ (°C)", f1(W.a.t1), f1(S.a.t1), f1(WX.a.t1), f1(SX.a.t1)],
  ["After AHU core T₂ (°C)", f1(W.a.t2), f1(S.a.t2), f1(WX.a.t2), f1(SX.a.t2)],
  ["Mixed T_mix (°C)", f1(W.a.mix), f1(S.a.mix), f1(WX.a.mix), f1(SX.a.mix)],
  ["After pre-heat / cooling coil (°C)", f1(W.a.ph) + " / " + f1(W.a.cc), f1(S.a.ph) + " / " + f1(S.a.cc), f1(WX.a.ph) + " / " + f1(WX.a.cc), f1(SX.a.ph) + " / " + f1(SX.a.cc)],
  ["Supply T_sup (°C)", f1(W.a.sup), f1(S.a.sup), f1(WX.a.sup), f1(SX.a.sup)],
  ["Room T (°C) / RH (%)", f1(W.a.room) + " / " + f0(W.s.MT106), f1(S.a.room) + " / " + f0(S.s.MT106), f1(WX.a.room) + " / " + f0(WX.s.MT106), f1(SX.a.room) + " / " + f0(SX.s.MT106)],
  ["Exhaust after the air-pump coil (°C)", f1(W.a.exh), f1(S.a.exh), f1(WX.a.exh), f1(SX.a.exh)],
  ["Heat recovered by the cores (W)", f1(W.pw.Qrec), f1(S.pw.Qrec), f1(WX.pw.Qrec), f1(SX.pw.Qrec)],
  ["Coil duty Q_coil (W)", f1(W.pw.Qhp), f1(S.pw.Qhp), f1(WX.pw.Qhp), f1(SX.pw.Qhp)],
  ["COP / EER", f2(W.pw.cop), f2(S.pw.cop), f2(WX.pw.cop), f2(SX.pw.cop)],
  ["Compressor input W (W)", f1(W.pw.W), f1(S.pw.W), f1(WX.pw.W), f1(SX.pw.W)],
  ["Reheat (W) / of which desuperheater (W)", f1(W.Qrh) + " / " + f1(W.pw.Qdsh), f1(S.Qrh) + " / " + f1(S.pw.Qdsh), f1(WX.Qrh) + " / " + f1(WX.pw.Qdsh), f1(SX.Qrh) + " / " + f1(SX.pw.Qdsh)],
  ["Steam (g/h)", f1(W.mh), f1(S.mh), f1(WX.mh), f1(SX.mh)],
  ["Electrical power, rig (W)", f1(W.pw.total), f1(S.pw.total), f1(WX.pw.total), f1(SX.pw.total)],
  ["Electrical power, baseline twin (W)", f1(W.pw.base), f1(S.pw.base), f1(WX.pw.base), f1(SX.pw.base)],
  ["Saving", f0(W.kpi.red * 100) + " %", f0(S.kpi.red * 100) + " %", f0(WX.kpi.red * 100) + " %", f0(SX.kpi.red * 100) + " %"],
  ["CO₂ (g/h) rig / baseline", f1(W.kpi.co2h) + " / " + f1(W.kpi.co2hBase), f1(S.kpi.co2h) + " / " + f1(S.kpi.co2hBase), f1(WX.kpi.co2h) + " / " + f1(WX.kpi.co2hBase), f1(SX.kpi.co2h) + " / " + f1(SX.kpi.co2hBase)],
  ["Compressor output u_cmp", f2(W.act.cmp), f2(S.act.cmp), f2(WX.act.cmp), f2(SX.act.cmp)],
  ["Active alarms", W.alarms.join(", ") || "none", S.alarms.join(", ") || "none", WX.alarms.join(", ") || "none", SX.alarms.join(", ") || "none"],
]);
const C_ = CASES, sv = (a, b) => f0(100 * (1 - a.pw.total / b.pw.total)) + " %";
P("**Fair A/B comparison.** The economiser loop L3 picks the damper position. With recovery on in winter, the recovered air is warm, so L3 admits **" + f0(W.a.f * 100) + " % fresh air**. In the baseline test (recovery bypassed) the outdoor air is cold, so it falls back to the **" + f0(WB.a.f * 100) + " % minimum**. Comparing those two runs directly compares *different ventilation rates*: winter " + f1(W.pw.total) + " W against " + f1(WB.pw.total) + " W. The live twin always compares at the *same* fresh air as the rig. For a fair measured A/B test, **put L3 in Manual at the same damper position in both runs**:");
P();
tbl(["Season, fixed fresh-air fraction", "Recovery on (W)", "Baseline test (W)", "Measured saving", "Twin's baseline (W)"], [
  ["Winter, 30 %", f1(C_.win30.pw.total), f1(C_.win30b.pw.total), sv(C_.win30, C_.win30b), f1(C_.win30.pw.base)],
  ["Winter, 50 %", f1(C_.win50.pw.total), f1(C_.win50b.pw.total), sv(C_.win50, C_.win50b), f1(C_.win50.pw.base)],
  ["Summer, 30 %", f1(C_.sum30.pw.total), f1(C_.sum30b.pw.total), sv(C_.sum30, C_.sum30b), f1(C_.sum30.pw.base)],
]);
P("At equal ventilation the twin matches the baseline test within " + f1(Math.max(Math.abs(C_.win30.pw.base - C_.win30b.pw.total), Math.abs(C_.win50.pw.base - C_.win50b.pw.total), Math.abs(C_.sum30.pw.base - C_.sum30b.pw.total))) + " W, and the saving is " + sv(C_.win30, C_.win30b) + " to " + sv(C_.win50, C_.win50b) + " in winter and " + sv(C_.sum30, C_.sum30b) + " in summer. Note too that with recovery the rig gives **" + f0(W.a.f * 100) + " % fresh air for " + f1(W.pw.total) + " W**, less than the baseline needs for only " + f0(WB.a.f * 100) + " % (" + f1(WB.pw.total) + " W).");
P();
P("At −10 °C the evaporator reaches the frost limit (alarm A05). The air pump is capped, the coil leaves at " + f1(WX.a.ph) + " °C instead of " + f1(WX.m.P.winter.coil) + " °C, and the PTC reheat makes up the difference (" + f1(WX.Qrh) + " W). For colder climates add a defrost cycle (reverse the 4-way valve for 2–3 min when TT-108 < −3 °C) or electric pre-heat of the exhaust.");
P();
P("Yearly at the winter design point and " + W.m.P.hours + " h: rig " + f0(W.kpi.annualKWh) + " kWh vs baseline " + f0(W.kpi.annualBaseKWh) + " kWh. At " + W.m.P.ef + " kg/kWh that is " + f1(W.kpi.annualKWh * W.m.P.ef) + " vs " + f1(W.kpi.annualBaseKWh * W.m.P.ef) + " kg CO₂ per year.");
P();

/* 11 */
P("## 11. Duct sizing");
P();
P("Method: **velocity method** with a friction check. The flows are the winter design flows above. The diameters and lengths are read from the 3D model, so they are the built geometry.");
P("```\ncontinuity:   v = Q / A          D_needed = √(4·Q / (π·v_target))            rectangular: D_h = 2ab / (a + b)\nReynolds:     Re = ρ·v·D / μ\nfriction:     Re < 2 300: f = 64/Re      Re > 4 000: Swamee–Jain  f = 0.25 / [log₁₀(ε/(3.7·D) + 5.74/Re^0.9)]²\n              (linear blend in between)\nDarcy–Weisbach + fittings:   ΔP = (f·L/D + ΣK) · ρ·v²/2          bends: K = 0.35 · θ/90°  (swept, R/D ≈ 0.8)\n```");
P("Targets for a rig this size: ≤ 3 m/s in the supply main (quiet, small ΔP); ≤ 5 m/s anywhere, and the friction rate kept low.");
P();
tbl(["Duct", "Q (m³/h)", "D or D_h (mm)", "L (m)", "v (m/s)", "Re", "Regime", "f", "Bends", "ΣK", "ΔP (Pa)", "D for 3 m/s (mm)"],
  ducts.map((d) => [d.name, f2(d.Q), f1(d.Dm * 1000), f2(d.L), f2(d.v), f0(d.Re), d.regime, f3(d.f), d.nb, f2(d.kb + d.kExtra), f1(d.dp), f1(d.Dfor3 * 1000)]));
const vmax = ducts.reduce((a, d) => (d.v > a.v ? d : a));
const over5 = ducts.filter((d) => d.v > 5), supMain = ducts.filter((d) => d.name.startsWith("Supply"));
P("Result: the highest velocity is " + f2(vmax.v) + " m/s in *" + vmax.name + "*. " + (over5.length ? "Over 5 m/s: " + over5.map((d) => d.name + " (" + f2(d.v) + " m/s; Ø" + f1(Math.sqrt(4 * d.Q / 3600 / (Math.PI * 4.5)) * 1000) + " mm would give 4.5 m/s)").join(", ") + ". It is short, so its pressure drop stays small; enlarge it if it is noisy. " : "Every run is ≤ 5 m/s. ") + "The supply main runs at " + supMain.map((d) => f2(d.v)).join(" / ") + " m/s. Duct friction is small next to the filters and coils (sections 12–13), so the duct sizes in the model are adequate. The 13–15 mm air-pump lanes are the tightest, and that is acceptable at their short lengths.");
P();
P("**Branch balancing (fresh-air split).** The " + W.m.P.split + " / " + (100 - W.m.P.split) + " split between the air-pump lane and the direct branch is set by their resistances. The air-pump lane loses " + f1(hrLane.clean) + " Pa (filter, core, ducts) and the direct branch " + f1(dirLane.clean) + " Pa. So the direct branch needs a **balancing orifice** that drops " + f1(balDP) + " Pa at " + f2(D.Qdir) + " m³/h:");
P("```\nA_o = Q / (C_d · √(2·ΔP/ρ)) = " + sig(Qdir) + " / (0.61 · √(2·" + f1(balDP) + "/1.2)) = " + f1(Aor * 1e6) + " mm²   →   orifice Ø ≈ " + f1(Dor * 1000) + " mm (adjust ±20 % on site to set FT-101 split)\n```");
P();

/* 12 */
P("## 12. Fan selection: system pressure budgets");
P();
P("Filters are rated **clean**, at **mid-life** (halfway to final) and at **final** pressure. Select each fan so that its curve passes the mid-life point at the design flow at about 70–80 % speed, and still reaches the final point at full speed. Component pressure drops are typical values for these components at the face velocities in the CAD (AHU face " + f1(Aface * 1e4) + " cm², " + f2(vface) + " m/s at " + f1(D.Qsup) + " m³/h). Confirm them with the parts you buy. Coil drops scale as ΔP ∝ v^1.8 from 25 Pa at 2.5 m/s.");
P();
function budTable(title, b, Q) {
  P("**" + title + "** at Q = " + f2(Q) + " m³/h");
  P();
  tbl(["Component", "Clean (Pa)", "Mid-life (Pa)", "Final (Pa)", "Note"], b.items.map((it) => [it[0], f1(it.v.clean), f1(mid(it.v)), f1(fin(it.v)), it.v.note || ""])
    .concat([["**Total**", "**" + f1(b.clean) + "**", "**" + f1(b.mid) + "**", "**" + f1(b.final) + "**", ""]]));
}
budTable("FAN-102 supply fan: recirculating loop (the room pressure cancels around the loop)", supLoop, D.Qsup);
budTable("FAN-101 fresh-air compressor: lab → mixing box", faPath, D.Qfa);
budTable("FAN-103 exhaust fans (two in series): extract deck → outdoors", exPath, D.Qex);
tbl(["Fan", "Duty point (mid-life)", "Must also reach (final, full speed)", "Selection"], [
  ["FAN-102 supply", f2(D.Qsup) + " m³/h at " + f0(supLoop.mid) + " Pa", f2(D.Qsup) + " m³/h at " + f0(supLoop.final) + " Pa", "24 V DC centrifugal (radial) blower, PWM + tach. Shut-off pressure ≥ " + f0(supLoop.final * 1.25) + " Pa, free air ≥ " + R.HW.sfQ + " m³/h"],
  ["FAN-101 fresh-air compressor", f2(D.Qfa) + " m³/h at " + f0(faPath.mid) + " Pa", f2(D.Qfa) + " m³/h at " + f0(faPath.final) + " Pa", "24 V DC centrifugal blower, PWM + tach. Shut-off ≥ " + f0(faPath.final * 1.25) + " Pa, free air ≥ " + R.HW.faQ + " m³/h"],
  ["FAN-103 exhaust (×2 in series)", f2(D.Qex) + " m³/h at " + f0(exPath.mid) + " Pa total", f2(D.Qex) + " m³/h at " + f0(exPath.final) + " Pa", "two 24 V DC blowers, each ≥ " + f0(exPath.final / 2 * 1.25) + " Pa shut-off, PWM in parallel, tach from one"],
]);
const lowFinal = supLoop.final - (COMP.panel.final - 100) - (COMP.bag.final - 160) - (COMP.hepa.final - 300) - (COMP.exPre.final - 100);
P("The supply loop is the hardest duty, because four filter stages are in series. If the blower you find cannot reach " + f0(supLoop.final) + " Pa, change the filters earlier: panel at 100 Pa, bag at 160 Pa and HEPA at 300 Pa (set the A09 limit to 300). That brings the final point down to **" + f0(lowFinal) + " Pa**, which 75–97 mm high-pressure 24 V blowers can reach.");
P();
P("Fan affinity for retuning: `Q₂/Q₁ = n₂/n₁`, `ΔP₂/ΔP₁ = (n₂/n₁)²`, `P₂/P₁ = (n₂/n₁)³`. Air power: `P_air = Q·ΔP`. At the supply duty point this is " + f2(D.Qsup / 3600 * supLoop.mid) + " W; with a small-blower total efficiency of about 15–25 % that needs " + f1(D.Qsup / 3600 * supLoop.mid / 0.2) + " W electrical, which matches the " + R.HW.sfP + " W rating.");
P();

/* 13 */
P("## 13. Actuator sizing");
P();
const dampA = 0.022 * 0.032, chord = 0.0029, dpDamp = 30;
const Taero = dpDamp * dampA * chord / 4, Tseal = 5 * 2 * dampA, Tlink = 0.02, Treq = Taero + Tseal + Tlink;
P("**SV-101 mixing-damper servo.** There are two linked dampers (outdoor air and recirculation), each with a face of about 22 × 32 mm and blade chord 2.9 mm (CAD).");
P("```\naerodynamic torque   T_a ≈ ΔP · A_face · c / 4 = " + dpDamp + " · " + sig(dampA) + " · " + chord + " / 4 = " + sig(Taero) + " N·m\nseal / bearing torque T_s ≈ 5 N·m per m² of face × 2 dampers = " + sig(Tseal) + " N·m      linkage friction ≈ " + Tlink + " N·m\nrequired              T = " + sig(Treq) + " N·m   → with ×3 margin " + sig(Treq * 3) + " N·m\n```");
P("The MG996R gives about 0.94 N·m at 4.8 V, so it has far more torque than needed (" + f0(0.94 / Treq) + "×); metal gears and good holding are why it was chosen. An SG90-class servo (0.18 N·m) would also work. It travels 60° in 0.17–0.2 s, which meets the model's 0 → 90° in about 0.6 s. Control is a 50 Hz pulse, 500 µs = 0° and 2 500 µs = 180°; the damper uses 0 … 90°.");
P();
const QccMax = Math.max(S.pw.Qhp, SX.pw.Qhp), QphMax = Math.max(W.pw.Qhp, WX.pw.Qhp);
P("**CMP-101 compressor.** The largest coil duties found are cooling " + f1(QccMax) + " W (summer 42 °C) and heating " + f1(QphMax) + " W (winter −10 °C). With 30 % margin the compressor needs **≥ " + f0(QccMax * 1.3) + " W cooling at T_e ≈ 5 °C / T_c ≈ 50 °C** and an inverter speed range of about 3 : 1. The model's capacity limits are " + R.HW.ccQ + " W cooling and " + R.HW.phQ + " W heating. At the worst summer point u_cmp = " + f2(SX.act.cmp) + ", so the compressor is " + (SX.act.cmp > 0.97 ? "**at its limit**: choose one with more capacity" : "within its range") + ".");
P();
P("> **Reality check.** The smallest commercial DC compressors (24 V miniature rotary compressors) give roughly 100–300 W of cooling at minimum speed. That is several times this rig's need, so the real compressor will cycle on and off at minimum speed. The firmware enforces a 180 s minimum off time and a 120 s minimum run time, and the receiver absorbs the charge swings. A capillary tube plus an EEV trim, or a hot-gas bypass, gives finer control. These miniature compressors are mostly made for R134a or R290. R32 versions exist but are rare, so confirm the refrigerant with the supplier and change the charge and the safety notes if you use another refrigerant.");
P();
P("**HTR-101 PTC reheat.** Its sizing condition is summer, reheating from the coil leaving temperature to the supply set point. Model: " + f1(S.Qrh) + " W at design, " + f1(SX.Qrh) + " W at 42 °C, less the desuperheater share. Rating " + R.HW.rhQ + " W, giving " + f1(R.HW.rhQ / Math.max(SX.Qrh, 1)) + "× margin. At 24 V that is " + f2(R.HW.rhQ / 24) + " A, so use a self-regulating finned PTC (Curie point ≈ 120 °C) with a 130 °C thermal fuse in series.");
P();
const wOa = R.wFromRH(-10, 80), wR = R.wFromRH(22, 45), fMin = WX.a.f;
const needG = (fMin * (wR - wOa) * RHO * D.Qsup - W.m.P.moist / 1000) * 1000;
P("**HUM-101 steam humidifier.** The sizing condition is the coldest, driest winter: outdoor −10 °C / 80 % (w = " + f2(wOa * 1000) + " g/kg) and room 22 °C / 45 % (w = " + f2(wR * 1000) + " g/kg), with fresh-air fraction f = " + f2(fMin) + ":");
P("```\nṁ_steam = f · (w_room − w_oa) · ρ · Q_sup − G_w = " + f2(fMin) + " · " + sig((wR - wOa) * 1000) + "e−3 · 1.2 · " + f1(D.Qsup) + " − " + W.m.P.moist / 1000 + " = " + f1(needG) + " g/h      model: " + f1(WX.mh) + " g/h\npower ≈ ṁ · (h_fg,100°C + c_w·ΔT) = " + f1(needG) + " · (2257 + 4.19·90) / 3600 = " + f1(needG * (2257 + 4.19 * 90) / 3600) + " W\n```");
P("Rating " + R.HW.humG + " g/h (" + f1(R.HW.humG / Math.max(needG, 1)) + "× margin), " + f1(R.HW.humG * R.HW.humWh) + " W. Use a **steam** (boiling) humidifier, not an ultrasonic one: ultrasonic mist carries the dissolved minerals into a clean room as particles.");
P();
P("**RV-101 reversing valve:** a miniature 4-way valve with a 24 V DC coil (about 5 W), switched by a logic MOSFET with a flyback diode. Switch it only with the compressor stopped and the pressures equalised (firmware: 30 s).");
P();
P("**EEV-101:** a miniature stepper EEV (bipolar drive, about 500 steps from fully closed to fully open), driven by a DRV8825 at 24 V with current limiting set to the coil rating (V_ref = I_coil × 0.5 Ω). The firmware homes it by over-driving 560 steps closed at start-up. The refrigerant mass flow it must pass is in section 14.");
P();

/* 14 */
P("## 14. Refrigerant circuit sizing (R32)");
P();
const hL = 290, hV = 517, sh = 6, dh = hV + sh - hL;
const mref = QccMax / 1000 / dh;
P("R32 property values are approximate saturation values (from IIR-reference tables): h_liquid(45 °C) ≈ " + hL + " kJ/kg, h_vapour(5 °C) ≈ " + hV + " kJ/kg, plus 5 K superheat (≈ +" + sh + " kJ/kg).");
P("```\nrefrigerating effect   Δh_evap = " + hV + " + " + sh + " − " + hL + " = " + dh + " kJ/kg\nmass flow              ṁ_ref = Q_evap / Δh_evap = " + f1(QccMax) + " W / " + dh + " kJ/kg = " + sig(mref * 1000) + " g/s = " + f1(mref * 3600) + " kg/h\ncondenser duty         Q_cond = Q_evap + W ≈ " + f1(QccMax + SX.pw.W) + " W   (summer worst case)\n```");
P("Line sizing: keep the liquid line at 0.3–1 m/s and the suction line at ≥ 4 m/s for oil return. At about " + f1(mref * 3600) + " kg/h, 1/8\" (3.2 mm OD, 1.8 mm ID) tube gives a liquid velocity of " + f2(mref / 950 / (Math.PI * 0.0009 * 0.0009)) + " m/s. On the suction side, 3/16\" (4.8 mm OD, 3.2 mm ID) gives " + f1(mref / 25 / (Math.PI * 0.0016 * 0.0016)) + " m/s at a vapour density of about 25 kg/m³.");
P();
P("**Charge estimate (design ≈ 40 g; the final charge is weighed in):**");
tbl(["Part", "Estimate"], [
  ["Liquid line 0.6 m, 1.8 mm ID (full of liquid)", f1(0.6 * Math.PI * 0.0009 * 0.0009 * 950 * 1000) + " g"],
  ["Condenser coil (≈30 % liquid), 0.8 m × 3 mm ID", f1(0.8 * Math.PI * 0.0015 * 0.0015 * 950 * 0.3 * 1000) + " g"],
  ["Evaporator + suction (vapour)", "≈ 1 g"],
  ["Dissolved in the compressor oil + shell", "≈ 15–25 g (depends on the compressor; ask the supplier)"],
  ["Receiver working reserve", "≈ 10 g → **receiver internal volume ≥ 15 cm³** (e.g. Ø20 × 60 mm)"],
  ["Suction accumulator", "**≥ 50 % of the charge as liquid ≈ 20 cm³** (e.g. Ø25 × 60 mm)"],
]);
P("R32 is class A2L, mildly flammable, with a GWP of 675. At 40 g it is " + f1(0.04 * 675) + " kg CO₂e. The IEC 60335-2-40 room limit for A2L, m₁ = 4 m³ × LFL (0.307 kg/m³) ≈ 1.2 kg, is far above this charge, so there are no special room requirements. Leak-test with nitrogen and evacuate to < 500 µm Hg before charging. Charging must be done by a certified technician (EU F-gas Regulation 2024/573).");
P();

/* 15 */
P("## 15. Electrical sizing");
P();
tbl(["Load", "Supply", "Max power (W)", "Note"], loads.map((l) => [l[0], l[1] + " V", f1(l[2]), l[3]]).concat([["**Connected total**", "", "**" + f1(Ptotal) + "**", ""]]));
const Pcoinc = Ptotal - R.HW.rhQ * 0 - 5;                      // RV only one season; keep conservative
P("**Power supply.** Connected load " + f1(Ptotal) + " W. The PTC and humidifier run in winter and the PTC is light in summer, but size for all of it plus 25 %: **24 V DC, ≥ " + f0(Math.ceil(Ptotal * 1.25 / 10) * 10) + " W (" + f1(Math.ceil(Ptotal * 1.25 / 10) * 10 / 24) + " A)**, e.g. a 150 W enclosed DIN or chassis supply. The 5 V rail comes from a 24 → 5 V 3 A buck (servo stall 2.5 A is the peak). The ESP32-S3 makes its own 3.3 V.");
P();
tbl(["Current channel", "Loads", "Max current (A)", "ACS712-05B range ±5 A", "Fuse"], [
  ["CT-101", "compressor driver", f2(25 / 24) + " (start ≈ 3 A, limited by the driver)", "OK", "3 A slow-blow"],
  ["CT-102", "all fans", f2((R.HW.faP + R.HW.sfP + 2 * R.HW.efP + 1) / 24), "OK", "2 A"],
  ["CT-103", "PTC + humidifier", f2((R.HW.rhQ + R.HW.humG * R.HW.humWh) / 24), "OK", "3.15 A"],
  ["Main", "everything", f1(Ptotal / 24), "—", "8 A at the PSU output"],
]);
P("**ACS712 scaling:** sensitivity 185 mV/A at V_cc = 5 V, zero at V_cc/2. A 10 k / 20 k divider brings it to the ESP32 ADC range (×0.667):");
P("```\nV_adc = 0.667 · (2.5 + 0.185 · I)      →      I = (V_adc / 0.667 − V_zero) / 0.185      (V_zero measured at start-up, outputs off)\nresolution ≈ 0.8 mV / (0.185 · 0.667 V/A) ≈ 6.5 mA per count (oversample 64× → ≈1 mA)\n```");
P("**Bus voltage:** `V_bus = V_adc · (100 k + 10 k) / 10 k = 11 · V_adc` (24 V → 2.18 V).");
P();
P("**PCB traces (IPC-2221, external layer, 1 oz copper, 10 °C rise):** `I = 0.048 · ΔT^0.44 · A^0.725`, with A in mil².");
tbl(["Current (A)", "Minimum width (mm)", "Use"], [[0.1, "signals, sensors"], [0.6, "one fan"], [1.3, "PTC heater"], [2.2, "PTC + humidifier (CT-103)"], [3.0, "compressor (CT-101)"], [6.5, "main 24 V bus"]]
  .map((r) => [r[0], f2(Math.max(ipcWidth(r[0]), 0.2)), r[1]]));
P("The flat FR4 harness strips carry signals on 0.25 mm tracks, plus 24 V and 0 V on 1.0 mm tracks for loads up to 1.3 A. The PTC and the compressor get 2.5 mm tracks or a wire pair.");
P();
P("**Wire:** PSU to board 1.0 mm² (18 AWG). Compressor, PTC and humidifier 0.5 mm². Fans and sensors 0.14–0.25 mm² (or the FR4 strips).");
P();

/* 16 */
P("## 16. Sensor scaling and ranges");
P();
const vFT102 = D.Qsup / 3600 / (Math.PI * 0.028 * 0.028 / 4), vFT101 = D.Qfa / 3600 / (Math.PI * 0.023 * 0.023 / 4);
tbl(["Tag", "Sensor", "Scaling", "Range vs design"], [
  ["TT/MT-101, -105, -106", "SHT31 (I²C 0x44)", "T = −45 + 175·S_T/65535 °C;  RH = 100·S_RH/65535 %", "−40 … 125 °C, 0 … 100 %; ±0.2 K, ±2 % RH"],
  ["TT-102 … 104, 107, 108", "DS18B20 (1-Wire)", "T = raw / 16 °C (12-bit, 750 ms)", "−55 … 125 °C, ±0.5 K"],
  ["FT-101", "Omron D6F-W04A1 in the Ø23 mm header", "v = table(V_out); Q = k_p · v · A · 3600", "0 … 4 m/s; design " + f2(vFT101) + " m/s"],
  ["FT-102", "Omron D6F-W04A1 in the Ø28 mm riser", "same; k_p ≈ 0.82 (centre-line → mean, turbulent)", "design " + f2(vFT102) + " m/s"],
  ["PDT-101", "Sensirion SDP810-125Pa (I²C 0x25)", "ΔP = raw / scale (scale read from the sensor, 240 /Pa)", "±125 Pa; set point 15 Pa"],
  ["PDT-102", "Sensirion SDP810-500Pa (I²C 0x25)", "ΔP = raw / scale (60 /Pa)", "±500 Pa; clean " + f0(W.s.PDT102) + " Pa, alarm 450"],
  ["PT-101 (room), PT-101A (fill point)", "Sensirion SPS30 ×2 (I²C 0x69)", "N(≥0.5 µm) = (NC10 − NC0.5) · 10⁶ /m³;  N(≥5 µm) ≈ 0.57 · (NC10 − NC4.0) · 10⁶", "0 … 3 000 /cm³; indicative only (see §18)"],
  ["CT-101 … 103", "ACS712-05B + 10 k/20 k divider", "see §15", "±5 A"],
  ["VT-101", "100 k / 10 k divider", "V = 11 · V_adc", "0 … 30 V"],
]);
P("The D6F-W output is **not linear**. The firmware uses a 6-point lookup table: 0.50 V at 0 m/s up to about 2.50 V at 4 m/s. Fill it from the curve in the datasheet, then **calibrate in place** against a reference anemometer or a bag-and-stopwatch flow test, and set k_p so that FT-102 reads the reference flow.");
P();

/* 17 */
P("## 17. Fit check: what fits inside the scaled AHU");
P();
P("The AHU and air-pump unit are Model C's units at 1.1 cm per model unit, as required. The AHU casing is about **220 × 50 × 37 mm** and the air-pump unit about 180 × 29 × 35 mm. The 3D model keeps their shape and layout. Some real parts are bigger than the space drawn for them:");
tbl(["Part", "Drawn in the CAD", "Typical real minimum", "Build"], [
  ["Coils (pre-heat, cooling, reheat, exhaust)", "≈ 19 × 32 mm face", "micro coils from 3 mm copper tube + fins", "fit: hand-made or ordered as custom micro coils"],
  ["PTC reheat element", "inside the AHU", "PTC plates from 20 × 30 mm", "fits"],
  ["Filters, HEPA", "≈ 23 × 33 mm face", "cut from filter media; H13 media in a 3D-printed frame", "fits; scan-test the HEPA frame"],
  ["Supply / transfer / exhaust fans", "Ø6–8 mm (symbolic)", "24 V blowers from 40 × 40 mm (usually 50–75 mm)", "**mount outside the casings**, in line with the supply boot, extract and exhaust ducts"],
  ["R32 compressor + driver", "inside the AHU base (symbolic)", "Ø80–100 × 130–160 mm", "**mount on the plant-room floor** beside the AHU; the refrigerant lines run to the coils"],
  ["Liquid receiver, accumulator", "Ø7 × 15 mm, Ø7.5 × 17 mm", "≥ 15 cm³ and ≥ 20 cm³ (§14)", "**mount on the plant-room floor**, next to the compressor"],
  ["Steam humidifier boiler", "lance only", "small boiler ≈ 40 × 40 × 60 mm", "mount outside; steam hose to the lance in the AHU"],
  ["EEV, filter-drier, sight glass", "on the AHU base", "EEV body ≈ Ø25 × 60 mm", "plant-room floor, in the liquid line"],
  ["Sensors (SHT31, DS18B20 probes, SDP810, D6F)", "as drawn", "fit (DS18B20 in Ø3–4 mm probes)", "fit"],
  ["PT-101 particle counter", "32 × 42 × 16 mm", "two SPS30 (41 × 41 × 12 mm each)", "enclosure ≈ 45 × 90 mm on the back wall"],
]);
P("The plant room is about 490 × 490 × 490 mm and the AHU fills only part of it, so all of these fit beside it without changing the AHU's shape.");
P();

/* 18 */
P("## 18. Assumptions to verify on the real rig");
P();
[
  "Component pressure drops in §12 are typical values. Measure the real ones with PDT-102 and a handheld manometer, then rerun the fan check.",
  "Core effectivenesses ε₁ and ε₂ (50 % each by default). Measure T₁ and T₂ with probes and correct them on the HMI.",
  "Room leakage k_leak: measure Q_leak at 15 Pa (fresh minus exhaust flow at steady state) and update `HW.leakK`.",
  "Thermal mass C_room and envelope UA: run a step test (heater on, log TT-106) and fit the time constant τ = C/(UA + C_sup).",
  "Particle sensors: the SPS30 is a low-cost optical sensor, good for trends and demonstrations. GMP classification needs an ISO 21501-4 counter at 28.3 L/min through the isokinetic probe.",
  "COP model (half of Carnot): compare with the measured CT-101 power and coil duty (C_sup·ΔT across the coil).",
  "Compressor size: see the reality check in §13.",
].forEach((t) => P("- " + t));
P();
P("_Generated by `tools/calc-report.js` from the simulator model and the 3D geometry._");

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, L.join("\n") + "\n");
console.log("wrote " + path.relative(ROOT, OUT) + " · " + L.length + " lines");
console.log("supply loop clean/mid/final", f0(supLoop.clean), f0(supLoop.mid), f0(supLoop.final), "| fresh", f0(faPath.clean), f0(faPath.mid), f0(faPath.final), "| exhaust", f0(exPath.clean), f0(exPath.mid), f0(exPath.final));
console.log("vmax", vmax.name, f2(vmax.v), "| balance dP", f1(balDP), "orifice", f1(Dor * 1000), "mm | Qcc max", f1(QccMax), "Qph max", f1(QphMax), "| steam need", f1(needG), "| Ptotal", f1(Ptotal));
