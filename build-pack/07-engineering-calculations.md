# Engineering calculations: clean-room heat-recovery air-pump rig

This document has every equation the simulator and the firmware use, and the sizing calculations for building the rig: ducts, fans, actuators, refrigerant circuit and electrics. **Every number is generated** by `tools/calc-report.js`. That script runs the simulator's plant model (`assets/js/rig-model.js`) and reads the duct geometry from the 3D model (`cad/rig-geometry.json`). Rerun it after any change, so the document never drifts from the model:

```bash
node tools/calc-report.js
```

Notation: Q = volume flow (m³/h unless stated), ṁ = mass flow (kg/s), T = temperature (°C), w = humidity ratio (kg/kg dry air), C = heat-capacity rate (W/K), ΔP = pressure difference (Pa), u = actuator output (0 … 1).

## Contents
- 1. Constants and the rig
- 2. Psychrometrics
- 3. Air-side model
- 4. Heat-recovery cores
- 5. Coils, humidifier and fan heat
- 6. Air pump (heat pump) model
- 7. Clean-room balances: heat, moisture, pressure, particles, ACH
- 8. Control: PI loops, sequencing, interlocks, alarms
- 9. Energy, baseline twin and carbon
- 10. Operating points (computed)
- 11. Duct sizing
- 12. Fan selection: system pressure budgets
- 13. Actuator sizing
- 14. Refrigerant circuit sizing
- 15. Electrical sizing: power budget, supply, currents, fuses, PCB traces
- 16. Sensor scaling and ranges
- 17. Fit check: what fits inside the scaled AHU
- 18. Assumptions to verify on the real rig

## 1. Constants and the rig

| Symbol | Value | Meaning |
|---|---|---|
| ρ | 1.2 kg/m³ | air density (20 °C, sea level) |
| c_p | 1006 J/(kg·K) | specific heat of dry air |
| h_fg | 2 501 kJ/kg | latent heat of water at 0 °C (enthalpy reference) |
| μ | 1.81 × 10⁻⁵ Pa·s | dynamic viscosity of air |
| P_atm | 101 325 Pa | barometric pressure |
| ε | 0.0015 mm | roughness of PVC / PETG duct |
| V_room | 95.323 L = 0.095 m³ | clean room, net 492.5 × 490 × 395 mm |
| A_floor | 0.241 m² | clean-room floor |
| C_room | 3000 J/K | room air + inner acrylic skin (thermal mass) |
| m_room | 0.35 kg | effective moisture buffer |
| k_leak | 0.13 m³/(h·√Pa) | room leakage coefficient |

Fan and actuator ratings used by the model (rig hardware at 100 % output):

| Item | Rating |
|---|---|
| FAN-102 supply fan | 18 m³/h free air, 8 W shaft-equivalent electrical |
| FAN-101 fresh-air compressor | 12 m³/h, 14 W |
| FAN-103 / FAN-103B exhaust fan (one runs at a time) | 12 m³/h, 6 W |
| Pre-heat coil (air-pump condenser, winter) | 45 W |
| Cooling coil (air-pump evaporator, summer) | 90 W |
| Reheat (PTC + desuperheater) | 30 W PTC |
| Steam humidifier | 45 g/h, 0.75 Wh per g of steam |
| Controls (ESP32-S3 + 7" HMI + sensors) | 3.5 W |

## 2. Psychrometrics

Saturation vapour pressure (Magnus form, Alduchov–Eskridge coefficients, −40 … 50 °C):
```
p_ws(T) = 610.94 · exp( 17.625·T / (T + 243.04) )            [Pa, T in °C]
```
Humidity ratio, relative humidity, dew point and enthalpy:
```
w   = 0.622 · p_w / (P_atm − p_w),        p_w = RH/100 · p_ws(T)
RH  = 100 · p_w / p_ws(T),               p_w = w · P_atm / (0.622 + w)
T_dp = 243.04 · a / (17.625 − a),          a = ln(p_w / 610.94)
h   = 1.006·T + w·(2501 + 1.86·T)          [kJ/kg dry air]
```
Check at the winter design point: outdoor -2 °C / 80 % gives w = 2.60 g/kg. The room at 23.8 °C / 45.0 % gives w = 8.24 g/kg, with a dew point of 11.2 °C.

## 3. Air-side model

Fan flow follows speed, with a first-order lag (τ = 1.2 s). Fan power follows the cube law (affinity laws), plus an idle term:
```
Q_fan = Q_max · u          P_fan = P_idle + P_max · u³          (Q ∝ n, ΔP ∝ n², P ∝ n³)
```
**100 % fresh air, once through.** The rig handles hazardous material, so nothing is recirculated: there is no mixing box, no recirculation damper and no exhaust air inside the AHU. Every m³ supplied is fresh air, and every m³ exhausted leaves through the air-pump unit's Cu plate core (or, when contaminated, through the outer HEPA):
```
Q_fa = Q_sup              f = Q_fa / Q_sup = 1              Q_rec = 0
Q_ex = Q_sup − Q_leak      (the room pressure set point decides Q_leak)
Q_core = Q_ex (DV-101 to the air pump)      Q_bypass = Q_ex (DV-101 to the outer HEPA)
```
FAN-101 and FAN-102 are in series. FAN-102 (L1) sets the supply flow; FAN-101 (L2) keeps the fresh-air header balanced, i.e. it makes FT-101 equal FT-102, so the supply fan does not have to pull the fresh air through the Cu core and filters on its own.
Heat-capacity rate of an air stream: `C = Q · ρ · c_p / 3600` [W/K], with Q in m³/h. At the 6.0 m³/h design supply, C_sup = 2.012 W/K.

## 4. Heat recovery: the Cu plate core (non-contact)

The only heat-recovery device is the air-pump unit's **crossflow plate core**. All the fresh air passes one set of channels and all the exhaust the other. The plates are **copper** (Cu-ETP, C11000), polished to a surface roughness **Ra ≤ 0.8 µm**; the plate edges are folded and sealed, so the two streams never touch. The exhaust only pre-cools the fresh air in summer and pre-heats it in winter, through the plates. The AHU has no core of its own, and no thermal wheel (a wheel carries some exhaust into the supply).
```
Q₁ = ε · min(C_fa, C_ex) · (T_room − T_oa)        T₁ = T_oa + Q₁ / C_fa        R₂ = T_room − Q₁ / C_ex
(core active only with recovery on and DV-101 to the air pump; otherwise T₁ = T_oa)
```
**Sizing the core** (ε-NTU, crossflow with both streams unmixed):
```
ε = 1 − exp[ NTU^0.22 / C_r · ( exp(−C_r · NTU^0.78) − 1 ) ]      C_r = C_min / C_max = 0.92
for ε = 0.60:  NTU = 1.69      UA = NTU · C_min = 1.69 · 1.84 = 3.11 W/K
laminar flow between plates, gap 2 mm:  Nu = 7.54,  D_h = 2·gap  →  h = 7.54 · 0.026 / 0.004 = 49.0 W/(m²·K)
U = 1 / (1/h + 1/h + t_Cu / k_Cu) = 1 / (2/49.0 + 0.0003/390) = 24.5 W/(m²·K)
plate area A = UA / U = 0.127 m²   →   cube core of side s with (s / pitch) plates of s²:  s = ∛(A · pitch) = 66 mm  (pitch 2.3 mm)
```
Copper's conductivity (≈ 390 W/(m·K)) makes the plate resistance t/k ≈ 7.69e-7 m²·K/W, thousands of times smaller than the air films (1/h ≈ 0.0204), so the plate material hardly changes ε. Copper is chosen because it is non-porous and corrosion-resistant, it is naturally antimicrobial, and at **Ra ≤ 0.8 µm** (the hygienic-design limit used for cleanable surfaces, e.g. EHEDG / ASME BPE) dust and product residues do not stick and the core can be washed and decontaminated. Specify Ra ≤ 0.8 µm (cut-off 0.8 mm) on both faces of every plate, check it with a stylus profilometer, and seal the plate edges by folding and soldering or with a food-grade silicone.

Winter design result: T_oa = -2.0 °C → T₁ = 12.2 °C off the Cu core; the exhaust goes 23.8 → 8.3 °C. Recovered: Q₁ = 28.5 W. Summer: 35.0 °C → 27.6 °C (non-contact pre-cooling, 14.9 W).

## 5. Coils, humidifier and fan heat

Pre-heat coil (winter; the air-pump condenser, or an electric element in the baseline):
```
T_ph = T₁ + Q_ph / C_sup          Q_ph = u_cmp · Q_ph,max   (lag τ = 8 s)
```
Cooling coil (summer; the air-pump evaporator) uses the **bypass-factor** method (BF = 0.15). A fraction BF of the air passes untouched and the rest leaves at the coil surface (apparatus dew point) temperature T_s. The coil duty Q_cc is split into sensible and latent parts by bisection:
```
ΔT = T_ph − T_cc            T_s = T_ph − ΔT / (1 − BF)            w_s = w_sat(T_s)
w_cc = BF · w_oa + (1 − BF) · w_s   (only if w_oa > w_s, i.e. the coil is wet; the core passes no moisture)
Q_lat = ṁ · h_fg · (w_oa − w_cc)        C_sup · ΔT + Q_lat = Q_cc
```
Reheat (desuperheater first, then the PTC trim): `T_rh = T_cc + Q_rh / C_sup`. The steam humidifier is isothermal: `w_sup = w_cc + ṁ_steam / (ρ · Q_sup)`. Supply-fan heat: `T_sup = T_rh + P_sf / C_sup`.

## 6. Air pump (heat pump) model

The COP is taken as half the Carnot COP between condensing and evaporating temperatures. That is a realistic second-law efficiency for small vapour-compression units:
```
Winter (heating):  T_c = T_ph + 6 K,  T_e = R₂ − 8 K,   COP_h = 0.5 · (T_c + 273.15) / (T_c − T_e)     clamp 1.5 … 7
Summer (cooling):  T_e = T_s − 4 K,   T_c = min(45, R₂ + 10) + 8 K,   EER = 0.5 · (T_e + 273.15) / (T_c − T_e)
Compressor power:  W = Q_coil / COP
```
**Frost limit (winter).** The evaporator may not cool the exhaust below −3 °C. That caps the heat it can absorb, and so the condenser duty:
```
Q_ev,max = C_ex · (R₂ + 3)          Q_cond,max = Q_ev,max · COP / (COP − 1)          (alarm A05 when capped)
```
**Summer heat rejection.** The exhaust stream takes the rejected heat until it reaches 45 °C, and an outdoor condenser takes the rest. 30 % of (Q_cc + W) is available as free desuperheater reheat:
```
Q_rej = Q_cc + W − Q_dsh,used          Q_air,max = C_ex · (45 − R₂)          Q_out = max(0, Q_rej − Q_air,max)
```
**Exhaust on the HEPA bypass (DV-101 thrown).** No exhaust air reaches the core or the exhaust-air coil. In winter the evaporator has no heat source, so the compressor is **locked out** and only the PTC reheat heats. In summer the air pump keeps cooling, with the outdoor condenser taking all the rejected heat (T_c = T_oa + 18 K).

## 7. Clean-room balances

**Heat** (lumped room air + inner acrylic skin):
```
C_room · dT_room/dt = C_sup · (T_sup − T_room) + Q_gain + UA · (T_lab − T_room)
```
**Moisture:**
```
m_room · dw_room/dt = ṁ_sup · (w_sup − w_room) + G_w          (G_w = moisture gain, kg/s)
```
**Pressure and leakage.** This is an orifice law, so the leak flow grows with the square root of the pressure:
```
Q_leak = k · √ΔP       ΔP = ((Q_sup − Q_ex) / k)²       (the imbalance supply − exhaust leaves through the leaks)
equivalent leakage area:  A_L = Q_leak / (C_d · √(2·ΔP/ρ))      C_d = 0.61
```
At +15 Pa: Q_leak = 0.13 × √15 = 0.50 m³/h, so A_L = 45.9 mm². That is the door gaps, the pass-box seals and the cable glands together. The exhaust fans hold the room **0.50 m³/h below the supply**. More exhaust lowers the pressure; less raises it.

**Air changes per hour.** ACH divides by the room *volume*. A rate per hour needs volume; dividing by floor area would give a velocity (m/h), not air changes:
```
ACH = Q_sup / V_room = 6.0 / 0.095 = 62.9 /h
```
**Airborne particles** (≥0.5 µm, well-mixed room):
```
V · dC/dt = Q_sup·C_sup + Q_in·C_lab + G − Q_out·C          Q_out = Q_sup + Q_in
C_sup = 0.9·C_oa · (1 − η_bag) · (1 − η_H13) · (1 − η_H14)     η_bag = 0.64,  η_H13 = η_H14 = 0.99995 at 0.5 µm
        (100 % fresh air: AHU bag + H13 HEPA, then the H14 bag-in/bag-out terminal)
Q_in = max(0, −Q_leak) + 0.08·exp(−ΔP/3 Pa)
steady state:  C* = (Q_sup·C_sup + Q_in·C_lab + G) / Q_out
fill point (LAF first air):  C_A = C_sup + (1 − κ)·C + 250,   κ = 0.99 · min(1, Q_sup / (0.6·Q_set))
recovery to 1 % (100:1):  t = ln(100) / ACH = 4.6 / ACH  [h]
exhaust after the H14 BIBO exhaust terminals (PT-102):  C_ex = C · (1 − η_H14)   (a leaking terminal: C · 0.02)
to atmosphere:  C_dis = C_ex (to the air pump)   or   C_ex · (1 − η_H14,outer) (HEPA bypass)
```
**Contaminated exhaust (L3, DV-101).** PT-102 reads C_ex. Above 1 000 /m³ for 5 s, DV-101 throws to the outer BIBO HEPA; it returns to the air pump only after 60 s below 300 /m³. Normal running gives C_ex ≈ 6.0 /m³. Test case, a powder release at the filler of 10000000 particles/min for 60 s: the room peaks at 65000000 /m³ and PT-102 at 3 227 /m³; DV-101 throws 27 s after the start and the exhaust returns to the air pump after 4.5 min. While diverted, the discharge passes two H14 stages (terminal + outer). 
**Where the openings are.** The fresh-air intake (FAN-101 and its louvre) is the only opening in the outdoor wall, at the back-left. Both exhausts, FAN-103 after the Cu core and FAN-103B after the outer HEPA, leave through **one vertical roof stack** at the front-right of the plant room, each through a backdraft damper, with a rain cap on top. On the rig the stack outlet is ≈ 606 mm from the intake; at full scale keep a hazardous exhaust outlet at least 10 m from any outdoor-air intake (ASHRAE 62.1, Class 4 air) and discharge it vertically, above the roof, so it cannot be drawn back into the fresh air.

Default shedding G = 12 000 /min = 720 000 /h. So C* ≈ G / Q_sup = 120 000 /m³ (Grade B in operation, limit 352 000). The model gives 120 888 /m³ in the room and 1 459 /m³ at the fill point (Grade A limit 3 520). Recovery 100:1 takes 4.4 min. EU GMP Annex 1 guides 15–20 min.

## 8. Control

Every loop is a PI controller with clamping anti-windup, run every Δt (the firmware uses 100 ms). The error is normalised so that the gains are dimensionless:
```
e_k = (SP − PV) / span                     (sign flipped for reverse-acting loops)
I_k = clamp( I_{k−1} + K_p · e_k · Δt / T_i ,  u_min, u_max )
u_k = clamp( K_p · e_k + I_k ,  u_min, u_max )
manual: u_k = MV,  I_k = MV − K_p·e_k   (bumpless return to auto)
```
| Loop | PV → MV | Error (normalised) | K_p | T_i (s) | Output limits |
|---|---|---|---|---|---|
| L1 | FT-102 → FAN-102 | (Q_set − FT102) / 20 | 0.8 | 1.5 | 0 … 1 |
| L2 | FT-101 → FAN-101 | (FT102 − FT101) / 20   (header balance, 100 % fresh air) | 1 | 1.5 | 0 … 1 |
| L3 | PT-102 → DV-101 | 2-position: trip if PT102 > 1 000 /m³ for 5 s; reset after 60 s < 300 /m³ | — | — | 0 (air pump) / 1 (HEPA) |
| L4 | TT-103 (winter) / TT-104 (summer) → CMP-101 | ±(T_coil,set − PV) / 50 | 1.4 | 18 | 0 … 1 |
| L5 | TT-105 → HTR-101 | (T_sup,set − TT105) / 50 | 1.6 | 14 | 0 … 1 |
| L6 | MT-106 → HUM-101 (winter) / coil reset (summer) | ±(RH_set − MT106) / 100 | 2 | 120 | 0 … 1 |
| L7 | PDT-101 → FAN-103 | (PDT101 − ΔP_set) / 100 | 0.35 | 1.5 | 0 … 1 |

**Sequencing and interlocks:**
- Airflow proving: `FT102 > 0.25·Q_set and FT102 > 0.5 m³/h`. Without it the compressor, PTC and humidifier stay off, and the integrators of L4 and L5 are held at ≤ 0.
- L3 is not a PI loop: it is a two-position switch with a time delay and a hold. A missing PT-102 reading counts as contaminated. DV-101 is **spring return**: with RUN off, a controller fault or a power cut it rests on the HEPA bypass (fail-safe), and the start-up begins there until the exhaust has been clean for 60 s.
- Winter, exhaust diverted: the compressor is locked out (the evaporator has no air) and L4's integrator is held at ≤ 0.
- Summer dehumidification: `T_coil,set = T_coil,set,0 − 6 K · u_L6` (cooling-coil reset).
- Slew limits per second: fans 0.5, DV-101 0.1 (10 s stroke), compressor 0.1 (10 %/s ramp), PTC and humidifier 0.5.
- Firmware only (real hardware protection): compressor minimum off-time 180 s and minimum run 120 s. The reversing valve switches only after the compressor has been off 30 s. The humidifier is blocked when MT-105 > 85 %. The PTC is blocked if FAN-102's tach shows < 300 rpm.

| Alarm | Condition | Delay (s) | Severity |
|---|---|---|---|
| A01 | FT-102 < 0.8 · Q_set | 20 | serious |
| A02 | PDT-101 < 5 Pa | 25 | serious |
| A03 | PDT-101 > 40 Pa | 15 | warning |
| A04 | |MT-106 − RH_set| > 10 % | 120 | warning |
| A05 | evaporator at the frost limit (winter, recovery on) | 30 | warning |
| A06 | PT-102 > trip level: exhaust diverted to the outer BIBO HEPA | 5 | serious |
| A07 | |TT-105 − T_sup,set| > 2 K | 90 | warning |
| A08 | ACH < 20 /h | 30 | warning |
| A09 | PDT-102 > 450 Pa (HEPA loaded) | 10 | warning |
| A10 | room ≥0.5 µm > 70 % of 352 000 /m³ | 60 | warning |
| A11 | room ≥0.5 µm > 352 000 /m³ | 30 | serious |
| A12 | fill point ≥0.5 µm > 3 520 /m³ | 30 | serious |

## 9. Energy, baseline twin and carbon

Measured electrical power, from the current sensors and the DC bus voltage:
```
P = V_bus · (I_CT101 + I_CT102 + I_CT103) + P_ctrl          E = ∫ P dt  [Wh]
```
The **baseline twin** is the same rig, the same flows and the same leaving temperatures, with no recovery. It is computed from measured values only, so the firmware can run it too:
```
T_mb = TT101         w_mb = w(TT101, MT101)         (100 % fresh air straight from outdoors, no core)
winter:  P_hc,base = C_sup · max(0, TT103 − T_mb)                                   (electric pre-heat)
summer:  P_hc,base = [C_sup · max(0, T_mb − TT104) + ṁ·h_fg · max(0, w_mb − w_cc)] / COP_base   (plain chiller, COP 2.8)
P_base = P_hc,base + P_reheat + P_hum + P_fans + P_ctrl
saving = 1 − P / P_base           CO₂ [g] = E [Wh] × EF [kg/kWh]    (EF = 0.5 kg/kWh, editable)
annual = P × h_year / 1000 [kWh]        scale-up to a 5 000 m³/h AHU:  × 5000 / Q_sup  (indicative)
```

## 10. Operating points (computed by the model, after 30 simulated minutes)

| Quantity | Winter design | Summer design | Winter −10 °C | Summer 42 °C |
|---|---|---|---|---|
| Outdoor °C / RH % | -2.0 / 80 | 35.0 / 40 | -10.0 / 80 | 42.0 / 35 |
| Supply Q_sup (m³/h) | 6.00 | 6.00 | 6.00 | 6.00 |
| Fresh air Q_fa (m³/h) = 100 % | 6.00 | 6.00 | 6.00 | 6.00 |
| Exhaust Q_ex (m³/h) | 5.50 | 5.50 | 5.50 | 5.50 |
| Off the Cu plate core T₁ = TT-109 (°C) | 12.2 | 27.6 | 8.6 | 30.7 |
| After pre-heat / cooling coil (°C) | 21.0 / 21.0 | 27.6 / 9.3 | 15.9 / 15.9 | 30.7 / 10.9 |
| Supply T_sup (°C) | 22.0 | 15.9 | 22.0 | 16.0 |
| Room T (°C) / RH (%) | 23.8 / 45 | 21.5 / 45 | 23.8 / 43 | 21.5 / 52 |
| Exhaust after the air-pump coil (°C) | 0.4 | 45.0 | -3.0 | 45.0 |
| Heat recovered by the Cu core (W) | 28.5 | 14.9 | 37.4 | 22.6 |
| Coil duty Q_coil (W) | 17.7 | 72.1 | 14.6 | 90.0 |
| COP / EER | 5.63 | 3.02 | 5.59 | 2.85 |
| Compressor input W (W) | 3.2 | 23.9 | 2.6 | 31.5 |
| Reheat (W) / of which desuperheater (W) | 1.4 / 0.0 | 12.8 / 12.8 | 11.6 / 0.0 | 9.7 / 9.7 |
| Steam (g/h) | 39.6 | 0.0 | 45.0 | 0.0 |
| Electrical power, rig (W) | 42.3 | 31.9 | 56.0 | 39.6 |
| Electrical power, baseline twin (W) | 84.6 | 51.1 | 104.8 | 57.1 |
| Saving | 50 % | 38 % | 47 % | 31 % |
| CO₂ (g/h) rig / baseline | 21.1 / 42.3 | 15.9 / 25.5 | 28.0 / 52.4 | 19.8 / 28.6 |
| Compressor output u_cmp | 0.39 | 0.80 | 1.00 | 1.00 |
| Active alarms | none | none | A05 | none |

**A/B comparison.** With 100 % fresh air there is no damper to choose the ventilation, so recovery on and the baseline test always compare the **same** fresh-air flow:

| Season | Recovery on (W) | Baseline test (W) | Measured saving | Twin's baseline (W) |
|---|---|---|---|---|
| Winter design | 42.3 | 84.6 | 50 % | 84.6 |
| Summer design | 31.9 | 48.2 | 34 % | 51.1 |

The twin matches the baseline test within 2.9 W.

**Exhaust held on the HEPA bypass** (DV-101 thrown, e.g. after a release): winter supply 13.2 °C with 58.9 W (compressor locked out, PTC only; alarms A07); summer supply 16.0 °C with 39.8 W (outdoor condenser). Recovery stops while diverted, which is the price of keeping contaminated air out of the air pump.

At −10 °C the evaporator reaches the frost limit (alarm A05). The air pump is capped, the coil leaves at 15.9 °C instead of 21.0 °C, and the PTC reheat makes up the difference (11.6 W). For colder climates add a defrost cycle (reverse the 4-way valve for 2–3 min when TT-108 < −3 °C) or electric pre-heat of the exhaust.

Yearly at the winter design point and 8760 h: rig 370 kWh vs baseline 741 kWh. At 0.5 kg/kWh that is 185.2 vs 370.6 kg CO₂ per year.

## 11. Duct sizing

Method: **velocity method** with a friction check. The flows are the winter design flows above. **All ducts are rectangular.** The sections and lengths are read from the 3D model, so they are the built geometry. Each rectangle was sized as w × h = 2.2 r × 1.55 r from the round duct of radius r it replaces, which keeps the same friction loss (Huebscher's equal-friction diameter D_e ≈ 2 r):
```
Huebscher:    D_e = 1.30 · (a·b)^0.625 / (a + b)^0.25       (the round duct with the same friction loss)
continuity:   v = Q / (a·b)          D_needed = √(4·Q / (π·v_target))            hydraulic diameter: D_h = 2ab / (a + b)
Reynolds:     Re = ρ·v·D / μ
friction:     Re < 2 300: f = 64/Re      Re > 4 000: Swamee–Jain  f = 0.25 / [log₁₀(ε/(3.7·D) + 5.74/Re^0.9)]²
              (linear blend in between)
Darcy–Weisbach + fittings:   ΔP = (f·L/D + ΣK) · ρ·v²/2          bends: K = 0.35 · θ/90°  (swept, R/D ≈ 0.8)
```
Targets for a rig this size: ≤ 3 m/s in the supply main (quiet, small ΔP); ≤ 5 m/s anywhere, and the friction rate kept low.

| Duct | Q (m³/h) | w × h (mm) | D_h / D_e (mm) | L (m) | v (m/s) | Re | Regime | f | Bends | ΣK | ΔP (Pa) | Note |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Intake: louvre → fresh-air compressor | 6.00 | 34.0 × 34.0 | 34.0 / 37.2 | 0.05 | 1.44 | 3 250 | transitional | 0.035 | 0 | 0.50 | 0.7 | entry K 0.5 |
| Compressor discharge | 6.00 | 24.2 × 17.1 | 20.0 / 22.1 | 0.09 | 4.04 | 5 357 | turbulent | 0.037 | 2 | 0.55 | 7.0 | outlet transition |
| Fresh-air header | 6.00 | 25.3 × 17.8 | 20.9 / 23.1 | 0.16 | 3.70 | 5 125 | turbulent | 0.038 | 0 | 0.00 | 2.3 | full fresh-air flow |
| Header → recovery unit (fresh lane) | 6.00 | 16.0 × 22.0 | 18.5 / 20.4 | 0.08 | 4.73 | 5 816 | turbulent | 0.036 | 1 | 1.35 | 20.2 | all the fresh air goes to the Cu core |
| Core bypass: header → AHU (baseline test) | 6.00 | 22.0 × 15.5 | 18.2 / 20.1 | 0.18 | 4.89 | 5 893 | turbulent | 0.036 | 1 | 1.35 | 24.5 | baseline test only (slide gate shut in service) |
| Tempered-air duct: recovery unit → AHU | 6.00 | 16.0 × 22.0 | 18.5 / 20.4 | 0.25 | 4.73 | 5 816 | turbulent | 0.036 | 3 | 1.25 | 23.4 | fresh air off the Cu core |
| Supply boot | 6.00 | 30.0 × 23.2 | 26.2 / 28.8 | 0.09 | 2.39 | 4 154 | turbulent | 0.040 | 1 | 0.65 | 2.7 |  |
| Supply riser → terminal-1 tee | 6.00 | 30.8 × 21.7 | 25.5 / 28.2 | 0.66 | 2.49 | 4 209 | turbulent | 0.040 | 4 | 1.35 | 8.9 | full supply flow |
| Supply riser, tee 1 → LAF tee | 4.50 | 30.8 × 21.7 | 25.5 / 28.2 | 0.17 | 1.87 | 3 157 | transitional | 0.034 | 0 | 0.40 | 1.3 | 75 %; tee run K 0.4 |
| Supply riser, LAF tee → right-wall plenum | 2.10 | 30.8 × 21.7 | 25.5 / 28.2 | 0.21 | 0.87 | 1 473 | laminar | 0.043 | 1 | 0.75 | 0.5 | 35 % to the 2 right-wall terminals |
| Terminal drop 1 (ceiling) | 1.50 | 22.0 × 15.5 | 18.2 / 20.1 | 0.03 | 1.22 | 1 473 | laminar | 0.043 | 0 | 1.00 | 1.0 | 25 %; tee branch K 1.0 |
| LAF supply drop | 2.40 | 24.2 × 17.1 | 20.0 / 22.1 | 0.20 | 1.62 | 2 143 | laminar | 0.030 | 1 | 1.27 | 2.5 | 40 %; tee branch K 1.0 |
| Exhaust collector A (behind the partition) | 2.75 | 18.7 × 13.2 | 15.5 / 17.1 | 0.11 | 3.10 | 3 176 | transitional | 0.034 | 1 | 0.85 | 6.3 | from exhaust terminal 1 |
| Exhaust collector B (behind the partition) | 2.75 | 18.7 × 13.2 | 15.5 / 17.1 | 0.10 | 3.10 | 3 176 | transitional | 0.034 | 1 | 0.85 | 6.2 | from exhaust terminal 2 |
| Exhaust main: clean room → DV-101 | 5.50 | 16.0 × 22.0 | 18.5 / 20.4 | 0.20 | 4.34 | 5 328 | turbulent | 0.037 | 0 | 0.40 | 9.1 | collector tee K 0.4 |
| Exhaust: DV-101 → air-pump unit (Cu core) | 5.50 | 16.0 × 22.0 | 18.5 / 20.4 | 0.11 | 4.34 | 5 328 | turbulent | 0.037 | 2 | 1.00 | 13.7 | normal path |
| Exhaust: air-pump unit → roof stack | 5.50 | 16.0 × 22.0 | 18.5 / 20.4 | 1.29 | 4.34 | 5 328 | turbulent | 0.037 | 4 | 2.00 | 51.8 | to the common stack, tee K 0.6 |
| HEPA bypass: DV-101 → outer BIBO HEPA | 5.50 | 16.0 × 22.0 | 18.5 / 20.4 | 0.22 | 4.34 | 5 328 | turbulent | 0.037 | 1 | 0.95 | 15.7 | only when DV-101 is thrown |
| Bypass discharge: FAN-103B → roof stack | 5.50 | 16.0 × 22.0 | 18.5 / 20.4 | 0.91 | 4.34 | 5 328 | turbulent | 0.037 | 4 | 2.90 | 53.4 | common stack: exit + rain cap K 1.5 |

Result: the highest velocity is 4.89 m/s in *Core bypass: header → AHU (baseline test)*. Every run is ≤ 5 m/s. The supply main runs at 2.39 / 2.49 / 1.87 / 0.87 m/s. Duct friction is small next to the filters and coils (section 12), so the duct sizes in the model are adequate. Make the ducts from 2 mm clear PETG or acrylic sheet, solvent-welded, with the corners as mitred elbows; the long side is horizontal on horizontal runs.

**Core bypass (baseline test only).** All the fresh air normally passes the Cu core; the direct branch to the AHU has a slide gate that stays shut in service and is opened (with the core lane's gate shut) only for the A/B baseline test.

## 12. Fan selection: system pressure budgets

Filters are rated **clean**, at **mid-life** (halfway to final) and at **final** pressure. Select each fan so that its curve passes the mid-life point at the design flow at about 70–80 % speed, and still reaches the final point at full speed. Component pressure drops are typical values for these components at the face velocities in the CAD (AHU face 7.3 cm², 2.27 m/s at 6.0 m³/h). Confirm them with the parts you buy. Coil drops scale as ΔP ∝ v^1.8 from 25 Pa at 2.5 m/s.

**FAN-102 supply fan: AHU inlet (0 Pa, held by FAN-101) → BIBO terminals → clean room** at Q = 6.00 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| Panel filter | 40.0 | 95.0 | 150.0 | ePM10 50 % panel |
| Bag filter | 80.0 | 165.0 | 250.0 | ePM1 55 % bag |
| Pre-heat coil | 21.0 | 21.0 | 21.0 | dry, 2-row micro coil |
| Cooling coil (wet) | 27.3 | 27.3 | 27.3 | wet in summer (+30 %) |
| Reheat coil | 10.0 | 10.0 | 10.0 | finned PTC element |
| Droplet eliminator | 8.0 | 8.0 | 8.0 | droplet eliminator |
| Steam lance | 3.0 | 3.0 | 3.0 | steam lance |
| H13 HEPA (AHU) | 145.0 | 297.5 | 450.0 | H13; PDT-102 alarm at 450 Pa |
| Attenuator | 8.0 | 8.0 | 8.0 | attenuator |
| Supply boot (duct) | 2.7 | 2.7 | 2.7 |  |
| Supply riser (duct, to the farthest terminal) | 10.7 | 10.7 | 10.7 |  |
| H14 BIBO terminal | 120.0 | 285.0 | 450.0 | H14 BIBO terminal (supply or exhaust) |
| Terminal face screen | 3.0 | 3.0 | 3.0 | perforated face screen |
| Clean-room pressure | 15.0 | 15.0 | 15.0 |  |
| **Total** | **493.7** | **951.2** | **1408.7** |  |

**FAN-101 fresh-air compressor: lab → Cu core → AHU inlet** at Q = 6.00 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| Louvre + bird mesh | 17.6 | 17.6 | 17.6 |  |
| Intake (duct) | 0.7 | 0.7 | 0.7 |  |
| Compressor discharge (duct) | 7.0 | 7.0 | 7.0 |  |
| Fresh-air header (duct) | 2.3 | 2.3 | 2.3 |  |
| Header → recovery unit (duct) | 20.2 | 20.2 | 20.2 |  |
| Recovery-unit fresh-air filter | 40.0 | 95.0 | 150.0 | air-pump unit fresh-air filter |
| Cu plate core, fresh side | 30.0 | 30.0 | 30.0 | Cu plate core, each stream |
| Tempered-air fan (unpowered) | 5.0 | 5.0 | 5.0 | unpowered tempered-air fan |
| Tempered-air duct | 23.4 | 23.4 | 23.4 |  |
| AHU outdoor-air pre-filter | 40.0 | 95.0 | 150.0 | ISO Coarse 60 % panel |
| **Total** | **186.2** | **296.2** | **406.2** |  |

**FAN-103 exhaust fan (normal): clean room → BIBO exhaust terminal → Cu core → outdoors** at Q = 5.50 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| H14 BIBO exhaust terminal | 120.0 | 285.0 | 450.0 | H14 BIBO terminal (supply or exhaust) |
| Exhaust collector (duct) | 6.3 | 6.3 | 6.3 |  |
| Exhaust main (duct) | 9.1 | 9.1 | 9.1 |  |
| DV-101 (open) | 4.0 | 4.0 | 4.0 | DV-101 open blade |
| DV-101 → air-pump unit (duct) | 13.7 | 13.7 | 13.7 |  |
| Recovery-unit exhaust filter | 40.0 | 95.0 | 150.0 | air-pump unit exhaust filter |
| Cu plate core, exhaust side | 30.0 | 30.0 | 30.0 | Cu plate core, each stream |
| Exhaust-air coil | 20.0 | 20.0 | 20.0 | exhaust-air coil (evaporator) |
| Exhaust duct to the roof stack | 51.8 | 51.8 | 51.8 |  |
| Backdraft damper | 5.0 | 5.0 | 5.0 | backdraft damper, open |
| Common stack + rain cap | 6.0 | 6.0 | 6.0 | rain cap |
| Less: clean-room pressure | -15.0 | -15.0 | -15.0 |  |
| **Total** | **291.0** | **511.0** | **731.0** |  |

**FAN-103B exhaust fan (HEPA bypass): clean room → BIBO exhaust terminal → outer BIBO HEPA → roof stack** at Q = 5.50 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| H14 BIBO exhaust terminal | 120.0 | 285.0 | 450.0 | H14 BIBO terminal (supply or exhaust) |
| Exhaust collector (duct) | 6.3 | 6.3 | 6.3 |  |
| Exhaust main (duct) | 9.1 | 9.1 | 9.1 |  |
| DV-101 (open to the bypass) | 4.0 | 4.0 | 4.0 | DV-101 open blade |
| HEPA bypass (duct) | 15.7 | 15.7 | 15.7 |  |
| Outer BIBO HEPA (H14) | 120.0 | 285.0 | 450.0 | outer BIBO H14 (police filter) |
| Backdraft damper | 5.0 | 5.0 | 5.0 | backdraft damper, open |
| Bypass discharge + common stack (duct) | 53.4 | 53.4 | 53.4 |  |
| Rain cap | 6.0 | 6.0 | 6.0 | rain cap |
| Less: clean-room pressure | -15.0 | -15.0 | -15.0 |  |
| **Total** | **324.5** | **654.5** | **984.5** |  |

| Fan | Duty point (mid-life) | Must also reach (final, full speed) | Selection |
|---|---|---|---|
| FAN-102 supply | 6.00 m³/h at 951 Pa | 6.00 m³/h at 1 409 Pa | 24 V DC centrifugal (radial) blower, PWM + tach. Shut-off pressure ≥ 1 761 Pa, free air ≥ 18 m³/h |
| FAN-101 fresh-air compressor | 6.00 m³/h at 296 Pa | 6.00 m³/h at 406 Pa | 24 V DC centrifugal blower, PWM + tach. Shut-off ≥ 508 Pa, free air ≥ 12 m³/h |
| FAN-103 exhaust (air-pump unit) | 5.50 m³/h at 511 Pa | 5.50 m³/h at 731 Pa | 24 V DC blower ≥ 914 Pa shut-off, PWM + tach |
| FAN-103B exhaust (outer HEPA) | 5.50 m³/h at 655 Pa | 5.50 m³/h at 985 Pa | 24 V DC blower ≥ 1 231 Pa shut-off, same PWM as FAN-103; DV-101's end switch powers the fan of the open path |

The supply path is the hardest duty, because four filter stages are in series (panel, bag, H13 and the H14 BIBO terminal). If the blower you find cannot reach 1 409 Pa, change the filters earlier: panel at 100 Pa, bag at 160 Pa, both HEPAs at 300 Pa (set the A09 limit to 300). That brings the final point down to **969 Pa**, which 75–97 mm high-pressure 24 V blowers can reach. Read each BIBO terminal's ΔP on its gauge port at every filter check.

Fan affinity for retuning: `Q₂/Q₁ = n₂/n₁`, `ΔP₂/ΔP₁ = (n₂/n₁)²`, `P₂/P₁ = (n₂/n₁)³`. Air power: `P_air = Q·ΔP`. At the supply duty point this is 1.59 W; with a small-blower total efficiency of about 15–25 % that needs 7.9 W electrical, which matches the 8 W rating.

## 13. Actuator sizing

**DV-101 exhaust diverter.** A two-way blade in a tee at the end of the exhaust main (section 16.0 × 22.0 mm). The worst close-off pressure is the higher fan path at its final point, 985 Pa.
```
aerodynamic torque   T_a ≈ ΔP · A · c / 4 = 985 · 0.000352 · 0.022 / 4 = 0.00191 N·m
seal torque          T_s ≈ 5 N·m per m² of blade × 2 seats = 0.00352 N·m      linkage ≈ 0.02 N·m
required             T = 0.0254 N·m   → with ×3 margin 0.0763 N·m
```
Any 24 V **spring-return** on/off damper actuator has far more torque than this (the smallest are about 1–2 N·m). Choose one with a spring-return time ≤ 20 s and a built-in **SPDT auxiliary switch** (Belimo TF24-S class). Energised = exhaust to the air pump; de-energised (power cut, RUN off, controller fault) = spring to the outer HEPA, the safe position. The firmware drives it from GPIO21 through a logic MOSFET with a flyback diode; the auxiliary switch routes the exhaust-fan supply to FAN-103 or FAN-103B, so the fan that runs is always the one on the open path.

**PT-102 exhaust particle sensor.** On the exhaust main between the collector and DV-101, a few duct widths before the diverter, sampling through a short isokinetic probe. On the rig it is a third SPS30 on I²C mux channel 7 (indicative only, like PT-101). In a production plant use an ISO 21501-4 remote particle counter with a 4–20 mA or Modbus output: the trip level (1 000 /m³ ≥0.5 µm) is far below what a low-cost optical sensor can resolve.

**CMP-101 compressor.** The largest coil duties found are cooling 90.0 W (summer 42 °C) and heating 17.7 W (winter −10 °C). With 30 % margin the compressor needs **≥ 117 W cooling at T_e ≈ 5 °C / T_c ≈ 50 °C** and an inverter speed range of about 3 : 1. The model's capacity limits are 90 W cooling and 45 W heating. At the worst summer point u_cmp = 1.00, so the compressor is **at its limit**: choose one with more capacity.

> **Reality check.** The smallest commercial DC compressors (24 V miniature rotary compressors) give roughly 100–300 W of cooling at minimum speed. That is several times this rig's need, so the real compressor will cycle on and off at minimum speed. The firmware enforces a 180 s minimum off time and a 120 s minimum run time, and the receiver absorbs the charge swings. A capillary tube plus an EEV trim, or a hot-gas bypass, gives finer control. These miniature compressors are mostly made for R134a or R290. R32 versions exist but are rare, so confirm the refrigerant with the supplier and change the charge and the safety notes if you use another refrigerant.

**HTR-101 PTC reheat.** Its sizing condition is summer, reheating from the coil leaving temperature to the supply set point. Model: 12.8 W at design, 9.7 W at 42 °C, less the desuperheater share. Rating 30 W, giving 3.1× margin. At 24 V that is 1.25 A, so use a self-regulating finned PTC (Curie point ≈ 120 °C) with a 130 °C thermal fuse in series.

**HUM-101 steam humidifier.** The sizing condition is the coldest, driest winter: outdoor −10 °C / 80 % (w = 1.41 g/kg) and room 22 °C / 45 % (w = 7.38 g/kg), with 100 % fresh air (f = 1; the Cu core passes no moisture):
```
ṁ_steam = f · (w_room − w_oa) · ρ · Q_sup − G_w = 1.00 · 5.96e−3 · 1.2 · 6.0 − 0.001 = 41.9 g/h      model: 45.0 g/h
power ≈ ṁ · (h_fg,100°C + c_w·ΔT) = 41.9 · (2257 + 4.19·90) / 3600 = 30.7 W
```
Rating 45 g/h (1.1× margin), 33.8 W. Use a **steam** (boiling) humidifier, not an ultrasonic one: ultrasonic mist carries the dissolved minerals into a clean room as particles.

**RV-101 reversing valve:** a miniature 4-way valve with a 24 V DC coil (about 5 W), switched by a logic MOSFET with a flyback diode. Switch it only with the compressor stopped and the pressures equalised (firmware: 30 s).

**EEV-101:** a miniature stepper EEV (bipolar drive, about 500 steps from fully closed to fully open), driven by a DRV8825 at 24 V with current limiting set to the coil rating (V_ref = I_coil × 0.5 Ω). The firmware homes it by over-driving 560 steps closed at start-up. The refrigerant mass flow it must pass is in section 14.

## 14. Refrigerant circuit sizing (R32)

R32 property values are approximate saturation values (from IIR-reference tables): h_liquid(45 °C) ≈ 290 kJ/kg, h_vapour(5 °C) ≈ 517 kJ/kg, plus 5 K superheat (≈ +6 kJ/kg).
```
refrigerating effect   Δh_evap = 517 + 6 − 290 = 233 kJ/kg
mass flow              ṁ_ref = Q_evap / Δh_evap = 90.0 W / 233 kJ/kg = 0.386 g/s = 1.4 kg/h
condenser duty         Q_cond = Q_evap + W ≈ 121.5 W   (summer worst case)
```
Line sizing: keep the liquid line at 0.3–1 m/s and the suction line at ≥ 4 m/s for oil return. At about 1.4 kg/h, 1/8" (3.2 mm OD, 1.8 mm ID) tube gives a liquid velocity of 0.16 m/s. On the suction side, 3/16" (4.8 mm OD, 3.2 mm ID) gives 1.9 m/s at a vapour density of about 25 kg/m³.

**Charge estimate (design ≈ 40 g; the final charge is weighed in):**
| Part | Estimate |
|---|---|
| Liquid line 0.6 m, 1.8 mm ID (full of liquid) | 1.5 g |
| Condenser coil (≈30 % liquid), 0.8 m × 3 mm ID | 1.6 g |
| Evaporator + suction (vapour) | ≈ 1 g |
| Dissolved in the compressor oil + shell | ≈ 15–25 g (depends on the compressor; ask the supplier) |
| Receiver working reserve | ≈ 10 g → **receiver internal volume ≥ 15 cm³** (e.g. Ø20 × 60 mm) |
| Suction accumulator | **≥ 50 % of the charge as liquid ≈ 20 cm³** (e.g. Ø25 × 60 mm) |

R32 is class A2L, mildly flammable, with a GWP of 675. At 40 g it is 27.0 kg CO₂e. The IEC 60335-2-40 room limit for A2L, m₁ = 4 m³ × LFL (0.307 kg/m³) ≈ 1.2 kg, is far above this charge, so there are no special room requirements. Leak-test with nitrogen and evacuate to < 500 µm Hg before charging. Charging must be done by a certified technician (EU F-gas Regulation 2024/573).

## 15. Electrical sizing

| Load | Supply | Max power (W) | Note |
|---|---|---|---|
| FAN-101 fresh-air compressor | 24 V | 14.5 | max speed |
| FAN-102 supply fan | 24 V | 8.3 | max speed |
| FAN-103 / FAN-103B exhaust fan (one runs: DV-101's end switch picks it) | 24 V | 6.3 | max speed |
| DV-101 spring-return actuator | 24 V | 4.0 | running ≈ 4 W, holding ≈ 2 W |
| CMP-101 compressor + driver | 24 V | 35.0 | ≈ 90 W cooling ÷ COP 3 + driver 5 W; start current limited by the driver |
| HTR-101 PTC reheat | 24 V | 30.0 | self-limiting PTC |
| HUM-101 steam humidifier | 24 V | 33.8 | 45 g/h × 0.75 Wh/g |
| EEV-101 stepper (DRV8825, current-limited) | 24 V | 2.0 | holding current reduced after a move |
| RV-101 4-way valve coil | 24 V | 5.0 | energised in one season only |
| D6F flow sensors ×2 | 24 V | 0.6 |  |
| 5 V rail: HMI 7" (≈2 W), ACS712 ×3, SPS30 ×3 (≈0.4 W each) | 24 V | 5.0 | via the 24 → 5 V 3 A buck, 90 % efficient |
| 3.3 V: ESP32-S3, TCA9548A, SHT31 ×3, SDP810 ×2, DS18B20 ×5 | 24 V | 1.5 | from the 5 V rail |
| **Connected total** |  | **145.9** |  |

**Power supply.** Connected load 145.9 W. The PTC and humidifier run in winter and the PTC is light in summer, but size for all of it plus 25 %: **24 V DC, ≥ 190 W (7.9 A)**, e.g. a 150 W enclosed DIN or chassis supply. The 5 V rail comes from a 24 → 5 V 3 A buck (HMI, ACS712s and the three SPS30s). The ESP32-S3 makes its own 3.3 V.

| Current channel | Loads | Max current (A) | ACS712-05B range ±5 A | Fuse |
|---|---|---|---|---|
| CT-101 | compressor driver | 1.04 (start ≈ 3 A, limited by the driver) | OK | 3 A slow-blow |
| CT-102 | all fans + DV-101 | 1.38 | OK | 2 A |
| CT-103 | PTC + humidifier | 2.66 | OK | 3.15 A |
| Main | everything | 6.1 | — | 8 A at the PSU output |

**ACS712 scaling:** sensitivity 185 mV/A at V_cc = 5 V, zero at V_cc/2. A 10 k / 20 k divider brings it to the ESP32 ADC range (×0.667):
```
V_adc = 0.667 · (2.5 + 0.185 · I)      →      I = (V_adc / 0.667 − V_zero) / 0.185      (V_zero measured at start-up, outputs off)
resolution ≈ 0.8 mV / (0.185 · 0.667 V/A) ≈ 6.5 mA per count (oversample 64× → ≈1 mA)
```
**Bus voltage:** `V_bus = V_adc · (100 k + 10 k) / 10 k = 11 · V_adc` (24 V → 2.18 V).

**PCB traces (IPC-2221, external layer, 1 oz copper, 10 °C rise):** `I = 0.048 · ΔT^0.44 · A^0.725`, with A in mil².
| Current (A) | Minimum width (mm) | Use |
|---|---|---|
| 0.1 | 0.20 | signals, sensors |
| 0.6 | 0.20 | one fan |
| 1.3 | 0.43 | PTC heater |
| 2.2 | 0.89 | PTC + humidifier (CT-103) |
| 3 | 1.37 | compressor (CT-101) |
| 6.5 | 3.97 | main 24 V bus |

The flat FR4 harness strips carry signals on 0.25 mm tracks, plus 24 V and 0 V on 1.0 mm tracks for loads up to 1.3 A. The PTC and the compressor get 2.5 mm tracks or a wire pair.

**Wire:** PSU to board 1.0 mm² (18 AWG). Compressor, PTC and humidifier 0.5 mm². Fans and sensors 0.14–0.25 mm² (or the FR4 strips).

## 16. Sensor scaling and ranges

| Tag | Sensor | Scaling | Range vs design |
|---|---|---|---|
| TT/MT-101, -105, -106 | SHT31 (I²C 0x44) | T = −45 + 175·S_T/65535 °C;  RH = 100·S_RH/65535 % | −40 … 125 °C, 0 … 100 %; ±0.2 K, ±2 % RH |
| TT-103, 104, 107, 108, 109 | DS18B20 (1-Wire) | T = raw / 16 °C (12-bit, 750 ms) | −55 … 125 °C, ±0.5 K |
| FT-101 | Omron D6F-W04A1 in the Ø23 mm header | v = table(V_out); Q = k_p · v · A · 3600 | 0 … 4 m/s; design 4.01 m/s |
| FT-102 | Omron D6F-W04A1 in the Ø28 mm riser | same; k_p ≈ 0.82 (centre-line → mean, turbulent) | design 2.71 m/s |
| PDT-101 | Sensirion SDP810-125Pa (I²C 0x25) | ΔP = raw / scale (scale read from the sensor, 240 /Pa) | ±125 Pa; set point 15 Pa |
| PDT-102 | Sensirion SDP810-500Pa (I²C 0x25) | ΔP = raw / scale (60 /Pa) | ±500 Pa; clean 145 Pa, alarm 450 |
| PT-101 (room), PT-101A (fill point) | Sensirion SPS30 ×2 (I²C 0x69) | N(≥0.5 µm) = (NC10 − NC0.5) · 10⁶ /m³;  N(≥5 µm) ≈ 0.57 · (NC10 − NC4.0) · 10⁶ | 0 … 3 000 /cm³; indicative only (see §18) |
| PT-102 (exhaust) | Sensirion SPS30 (I²C 0x69, mux ch7) | as PT-101 | trip 1 000 /m³; indicative only (§13) |
| CT-101 … 103 | ACS712-05B + 10 k/20 k divider | see §15 | ±5 A |
| VT-101 | 100 k / 10 k divider | V = 11 · V_adc | 0 … 30 V |

The D6F-W output is **not linear**. The firmware uses a 6-point lookup table: 0.50 V at 0 m/s up to about 2.50 V at 4 m/s. Fill it from the curve in the datasheet, then **calibrate in place** against a reference anemometer or a bag-and-stopwatch flow test, and set k_p so that FT-102 reads the reference flow.

## 17. Fit check: what fits inside the scaled AHU

The AHU and air-pump unit are Model C's units at 1.1 cm per model unit, as required. The AHU casing is about **220 × 50 × 37 mm** and the air-pump unit about 180 × 29 × 35 mm. The 3D model keeps their shape and layout. Some real parts are bigger than the space drawn for them:
| Part | Drawn in the CAD | Typical real minimum | Build |
|---|---|---|---|
| Cu plate core | ≈ 24 mm cube, 11 plates | ≈ 66 mm cube, 29 Cu plates 0.3 mm, gap 2 mm (§4) | **bigger than drawn**: make the air-pump unit housing to fit it, or accept a lower ε |
| Coils (pre-heat, cooling, reheat, exhaust) | ≈ 19 × 32 mm face | micro coils from 3 mm copper tube + fins | fit: hand-made or ordered as custom micro coils |
| PTC reheat element | inside the AHU | PTC plates from 20 × 30 mm | fits |
| Filters, HEPA | ≈ 23 × 33 mm face | cut from filter media; H13 media in a 3D-printed frame | fits; scan-test the HEPA frame |
| Supply / transfer / exhaust fans | Ø6–8 mm (symbolic) | 24 V blowers from 40 × 40 mm (usually 50–75 mm) | **mount outside the casings**, in line with the supply boot, extract and exhaust ducts |
| R32 compressor + driver | inside the AHU base (symbolic) | Ø80–100 × 130–160 mm | **mount on the plant-room floor** beside the AHU; the refrigerant lines run to the coils |
| Liquid receiver, accumulator | Ø7 × 15 mm, Ø7.5 × 17 mm | ≥ 15 cm³ and ≥ 20 cm³ (§14) | **mount on the plant-room floor**, next to the compressor |
| Steam humidifier boiler | lance only | small boiler ≈ 40 × 40 × 60 mm | mount outside; steam hose to the lance in the AHU |
| EEV, filter-drier, sight glass | on the AHU base | EEV body ≈ Ø25 × 60 mm | plant-room floor, in the liquid line |
| Sensors (SHT31, DS18B20 probes, SDP810, D6F) | as drawn | fit (DS18B20 in Ø3–4 mm probes) | fit |
| PT-101 particle counter | 32 × 42 × 16 mm | two SPS30 (41 × 41 × 12 mm each) | enclosure ≈ 45 × 90 mm on the back wall |
| BIBO HEPA housings (4 supply incl. LAF, 2 exhaust, 1 outer) | as drawn | H14 media in 3D-printed frames, PVC change bags on Ø20–40 mm rings | fit; leak-scan every frame |
| DV-101 actuator | 18 × 18 × 13 mm | spring-return actuators ≈ 60 × 100 × 60 mm | **mount beside the duct**, shaft through the duct wall |

The plant room is about 490 × 490 × 490 mm and the AHU fills only part of it, so all of these fit beside it without changing the AHU's shape.

## 18. Assumptions to verify on the real rig

- Component pressure drops in §12 are typical values. Measure the real ones with PDT-102 and a handheld manometer, then rerun the fan check.
- Cu core effectiveness ε (60 % by default). Measure T₁ with TT-109 and correct ε on the HMI. Check the plate roughness (Ra ≤ 0.8 µm) with a profilometer.
- Room leakage k_leak: measure Q_leak at 15 Pa (fresh minus exhaust flow at steady state) and update `HW.leakK`.
- Thermal mass C_room and envelope UA: run a step test (heater on, log TT-106) and fit the time constant τ = C/(UA + C_sup).
- Particle sensors: the SPS30 is a low-cost optical sensor, good for trends and demonstrations. GMP classification needs an ISO 21501-4 counter at 28.3 L/min through the isokinetic probe.
- COP model (half of Carnot): compare with the measured CT-101 power and coil duty (C_sup·ΔT across the coil).
- Compressor size: see the reality check in §13.

_Generated by `tools/calc-report.js` from the simulator model and the 3D geometry._
