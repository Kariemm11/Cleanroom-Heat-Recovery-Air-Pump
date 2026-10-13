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
| FAN-103 exhaust fans | 12 m³/h, 2 × 3 W |
| Pre-heat coil (air-pump condenser, winter) | 45 W |
| Cooling coil (air-pump evaporator, summer) | 60 W |
| Reheat (PTC + desuperheater) | 30 W PTC |
| Steam humidifier | 30 g/h, 0.75 Wh per g of steam |
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
Check at the winter design point: outdoor -2 °C / 80 % gives w = 2.60 g/kg. The room at 23.8 °C / 44.9 % gives w = 8.23 g/kg, with a dew point of 11.1 °C.

## 3. Air-side model

Fan flow follows speed, with a first-order lag (τ = 1.2 s). Fan power follows the cube law (affinity laws), plus an idle term:
```
Q_fan = Q_max · u          P_fan = P_idle + P_max · u³          (Q ∝ n, ΔP ∝ n², P ∝ n³)
```
Flow bookkeeping, where Q_sup is the supply, Q_fa the fresh air and Q_ex the exhaust:
```
Q_fa,eff = min(Q_fa, Q_sup)          spill = max(0, Q_fa − Q_sup)
Q_rec = Q_sup − Q_fa,eff             f = Q_fa,eff / Q_sup     (fresh-air fraction)
Q_hr = s · Q_fa,eff                  Q_dir = (1 − s) · Q_fa,eff     s = split to the air-pump unit
```
Mixing box, by mass and energy balance with equal densities:
```
T_mix = f · T_2 + (1 − f) · T_room          w_mix = f · w_2 + (1 − f) · w_room
```
Heat-capacity rate of an air stream: `C = Q · ρ · c_p / 3600` [W/K], with Q in m³/h. At the 6.0 m³/h design supply, C_sup = 2.012 W/K.

## 4. Heat-recovery cores (two-core cascade)

Each core uses the effectiveness definition, ε = actual heat transferred ÷ the maximum possible. The fresh air passes the air-pump unit's crossflow core (ε₁) and then the AHU's plate core (ε₂). The exhaust passes them in the opposite order (AHU core first, then the air-pump unit core), so the two equations are coupled. The model iterates them four times:
```
Q₁ = ε₁ · min(C_hr, C_ex) · (R₁ − T_oa)        T₁ = T_oa + Q₁ / C_hr          R₂ = R₁ − Q₁ / C_ex
T_in = s · T₁ + (1 − s) · T_oa                 (the air-pump lane meets the direct branch)
Q₂ = ε₂ · min(C_fa, C_ex) · (T_room − T_in)     T₂ = T_in + Q₂ / C_fa         R₁ = T_room − Q₂ / C_ex
```
With a rotary wheel instead of the plate core, moisture is also recovered: `w₂ = w_oa + ε₂ · min(C_fa,C_ex)/C_fa · (w_room − w_oa)`.

Winter design result: T_oa = -2.0 °C → T₁ = 5.9 °C (air-pump core), T_in = 4.0 °C, T₂ = 12.2 °C (after the AHU core). Exhaust: 13.9 → 6.7 °C. Recovered: Q₁ + Q₂ = 14.3 W.

## 5. Coils, humidifier and fan heat

Pre-heat coil (winter; the air-pump condenser, or an electric element in the baseline):
```
T_ph = T_mix + Q_ph / C_sup          Q_ph = u_cmp · Q_ph,max   (lag τ = 8 s)
```
Cooling coil (summer; the air-pump evaporator) uses the **bypass-factor** method (BF = 0.15). A fraction BF of the air passes untouched and the rest leaves at the coil surface (apparatus dew point) temperature T_s. The coil duty Q_cc is split into sensible and latent parts by bisection:
```
ΔT = T_ph − T_cc            T_s = T_ph − ΔT / (1 − BF)            w_s = w_sat(T_s)
w_cc = BF · w_mix + (1 − BF) · w_s   (only if w_mix > w_s, i.e. the coil is wet)
Q_lat = ṁ · h_fg · (w_mix − w_cc)        C_sup · ΔT + Q_lat = Q_cc
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
Q_leak = k · √ΔP       ΔP = ((Q_fa − Q_ex) / k)²       (the imbalance fresh − exhaust leaves through the leaks)
equivalent leakage area:  A_L = Q_leak / (C_d · √(2·ΔP/ρ))      C_d = 0.61
```
At +15 Pa: Q_leak = 0.13 × √15 = 0.50 m³/h, so A_L = 45.9 mm². That is the door gaps, the pass-box seals and the cable glands together. The exhaust fans hold the room **0.50 m³/h below the fresh air**. More exhaust lowers the pressure; less raises it.

**Air changes per hour.** ACH divides by the room *volume*. A rate per hour needs volume; dividing by floor area would give a velocity (m/h), not air changes:
```
ACH = Q_sup / V_room = 6.0 / 0.095 = 62.9 /h
```
**Airborne particles** (≥0.5 µm, well-mixed room):
```
V · dC/dt = Q_sup·C_sup + Q_in·C_lab + G − Q_out·C          Q_out = Q_sup + Q_in
C_sup = C_mix · (1 − η_bag) · (1 − η_HEPA)      η_bag = 0.64,  η_HEPA = 0.99995 at 0.5 µm (H13 is ≥ 99.95 % at MPPS)
C_mix = f · 0.9·C_oa + (1 − f) · C         Q_in = max(0, −Q_leak) + 0.08·exp(−ΔP/3 Pa)
steady state:  C* = (Q_sup·C_sup + Q_in·C_lab + G) / Q_out
fill point (first air under the RABS):  C_A = C_sup + (1 − κ)·C + 250,   κ = 0.99 · min(1, Q_sup / (0.6·Q_set))
recovery to 1 % (100:1):  t = ln(100) / ACH = 4.6 / ACH  [h]
```
Default shedding G = 12 000 /min = 720 000 /h. So C* ≈ G / Q_sup = 120 000 /m³ (Grade B in operation, limit 352 000). The model gives 121 055 /m³ in the room and 1 623 /m³ at the fill point (Grade A limit 3 520). Recovery 100:1 takes 4.4 min. EU GMP Annex 1 guides 15–20 min.

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
| L2 | FT-101 → FAN-101 | (u_dmp·FT102 − FT101) / 20 | 1 | 1.5 | 0 … 1 |
| L3 | TT-102 → SV-101 | (TT102 − T_mix,set) / 50 · (+1 if TT101 < TT107 else −1) | 3 | 6 | min fresh air … 1 |
| L4 | TT-103 (winter) / TT-104 (summer) → CMP-101 | ±(T_coil,set − PV) / 50 | 1.4 | 18 | 0 … 1 |
| L5 | TT-105 → HTR-101 | (T_sup,set − TT105) / 50 | 1.6 | 14 | 0 … 1 |
| L6 | MT-106 → HUM-101 (winter) / coil reset (summer) | ±(RH_set − MT106) / 100 | 2 | 120 | 0 … 1 |
| L7 | PDT-101 → FAN-103 | (PDT101 − ΔP_set) / 100 | 0.35 | 1.5 | 0 … 1 |

**Sequencing and interlocks:**
- Airflow proving: `FT102 > 0.25·Q_set and FT102 > 0.5 m³/h`. Without it the compressor, PTC and humidifier stay off, and the integrators of L4 and L5 are held at ≤ 0.
- L3 is economiser-style: when the outdoor air is warmer than the return (TT101 ≥ TT107), the damper action reverses. Its low limit is the minimum fresh air (30 %).
- Summer dehumidification: `T_coil,set = T_coil,set,0 − 6 K · u_L6` (cooling-coil reset).
- Slew limits per second: fans 0.5, servo 1.6 (0 → 90° in ≈0.6 s), compressor 0.1 (10 %/s ramp), PTC and humidifier 0.5.
- Firmware only (real hardware protection): compressor minimum off-time 180 s and minimum run 120 s. The reversing valve switches only after the compressor has been off 30 s. The humidifier is blocked when MT-105 > 85 %. The PTC is blocked if FAN-102's tach shows < 300 rpm.

| Alarm | Condition | Delay (s) | Severity |
|---|---|---|---|
| A01 | FT-102 < 0.8 · Q_set | 20 | serious |
| A02 | PDT-101 < 5 Pa | 25 | serious |
| A03 | PDT-101 > 40 Pa | 15 | warning |
| A04 | |MT-106 − RH_set| > 10 % | 120 | warning |
| A05 | evaporator at the frost limit (winter, recovery on) | 30 | warning |
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
T_mb = f·TT101 + (1 − f)·TT107         w_mb = f·w(TT101,MT101) + (1 − f)·w(TT106,MT106)         f = FT101 / FT102
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
| Fresh air Q_fa (m³/h), fraction f | 2.99, 0.50 | 1.80, 0.30 | 2.19, 0.37 | 1.80, 0.30 |
| Exhaust Q_ex (m³/h) | 2.50 | 1.30 | 1.69 | 1.30 |
| After air-pump core T₁ (°C) | 5.9 | 31.1 | 0.4 | 36.0 |
| After AHU core T₂ (°C) | 12.2 | 28.2 | 7.8 | 31.7 |
| Mixed T_mix (°C) | 18.0 | 23.5 | 18.0 | 24.6 |
| After pre-heat / cooling coil (°C) | 21.0 / 21.0 | 23.5 / 10.3 | 19.4 / 19.4 | 24.6 / 10.1 |
| Supply T_sup (°C) | 22.1 | 16.0 | 22.0 | 16.0 |
| Room T (°C) / RH (%) | 23.8 / 45 | 21.5 / 45 | 23.8 / 45 | 21.5 / 45 |
| Exhaust after the air-pump coil (°C) | 0.9 | 45.0 | -3.0 | 45.0 |
| Heat recovered by the cores (W) | 14.3 | 4.1 | 13.1 | 6.2 |
| Coil duty Q_coil (W) | 6.1 | 37.8 | 2.7 | 46.4 |
| COP / EER | 5.30 | 3.09 | 4.56 | 2.80 |
| Compressor input W (W) | 1.1 | 12.2 | 0.6 | 16.6 |
| Reheat (W) / of which desuperheater (W) | 1.5 / 0.0 | 10.8 / 10.8 | 4.6 / 0.0 | 11.3 / 11.3 |
| Steam (g/h) | 19.1 | 0.0 | 16.6 | 0.0 |
| Electrical power, rig (W) | 23.0 | 18.1 | 23.5 | 22.5 |
| Electrical power, baseline twin (W) | 41.4 | 30.8 | 38.2 | 35.2 |
| Saving | 44 % | 41 % | 38 % | 36 % |
| CO₂ (g/h) rig / baseline | 11.5 / 20.7 | 9.0 / 15.4 | 11.8 / 19.1 | 11.2 / 17.6 |
| Compressor output u_cmp | 0.13 | 0.63 | 1.00 | 0.78 |
| Active alarms | none | none | A05 | none |

**Fair A/B comparison.** The economiser loop L3 picks the damper position. With recovery on in winter, the recovered air is warm, so L3 admits **50 % fresh air**. In the baseline test (recovery bypassed) the outdoor air is cold, so it falls back to the **30 % minimum**. Comparing those two runs directly compares *different ventilation rates*: winter 23.0 W against 24.6 W. The live twin always compares at the *same* fresh air as the rig. For a fair measured A/B test, **put L3 in Manual at the same damper position in both runs**:

| Season, fixed fresh-air fraction | Recovery on (W) | Baseline test (W) | Measured saving | Twin's baseline (W) |
|---|---|---|---|---|
| Winter, 30 % | 15.9 | 24.7 | 36 % | 24.6 |
| Winter, 50 % | 22.9 | 41.3 | 45 % | 41.3 |
| Summer, 30 % | 18.1 | 30.0 | 40 % | 30.7 |

At equal ventilation the twin matches the baseline test within 0.7 W, and the saving is 36 % to 45 % in winter and 40 % in summer. Note too that with recovery the rig gives **50 % fresh air for 23.0 W**, less than the baseline needs for only 30 % (24.6 W).

At −10 °C the evaporator reaches the frost limit (alarm A05). The air pump is capped, the coil leaves at 19.4 °C instead of 21.0 °C, and the PTC reheat makes up the difference (4.6 W). For colder climates add a defrost cycle (reverse the 4-way valve for 2–3 min when TT-108 < −3 °C) or electric pre-heat of the exhaust.

Yearly at the winter design point and 8760 h: rig 202 kWh vs baseline 363 kWh. At 0.5 kg/kWh that is 100.8 vs 181.4 kg CO₂ per year.

## 11. Duct sizing

Method: **velocity method** with a friction check. The flows are the winter design flows above. The diameters and lengths are read from the 3D model, so they are the built geometry.
```
continuity:   v = Q / A          D_needed = √(4·Q / (π·v_target))            rectangular: D_h = 2ab / (a + b)
Reynolds:     Re = ρ·v·D / μ
friction:     Re < 2 300: f = 64/Re      Re > 4 000: Swamee–Jain  f = 0.25 / [log₁₀(ε/(3.7·D) + 5.74/Re^0.9)]²
              (linear blend in between)
Darcy–Weisbach + fittings:   ΔP = (f·L/D + ΣK) · ρ·v²/2          bends: K = 0.35 · θ/90°  (swept, R/D ≈ 0.8)
```
Targets for a rig this size: ≤ 3 m/s in the supply main (quiet, small ΔP); ≤ 5 m/s anywhere, and the friction rate kept low.

| Duct | Q (m³/h) | D or D_h (mm) | L (m) | v (m/s) | Re | Regime | f | Bends | ΣK | ΔP (Pa) | D for 3 m/s (mm) |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Intake: louvre → fresh-air compressor | 2.99 | 38.0 | 0.05 | 0.73 | 1 848 | laminar | 0.035 | 0 | 0.50 | 0.2 | 18.8 |
| Compressor discharge | 2.99 | 22.0 | 0.09 | 2.19 | 3 192 | transitional | 0.035 | 2 | 0.55 | 2.0 | 18.8 |
| Fresh-air header | 2.99 | 23.0 | 0.16 | 2.00 | 3 053 | transitional | 0.033 | 0 | 0.00 | 0.6 | 18.8 |
| Header → recovery unit (fresh lane) | 2.25 | 15.0 | 0.08 | 3.53 | 3 511 | transitional | 0.037 | 1 | 1.35 | 11.6 | 16.3 |
| Header → AHU outdoor-air intake | 0.75 | 20.0 | 0.18 | 0.66 | 878 | laminar | 0.073 | 1 | 1.35 | 0.5 | 9.4 |
| Tempered-air duct: recovery unit → AHU | 2.25 | 13.6 | 0.14 | 4.27 | 3 861 | transitional | 0.040 | 4 | 0.73 | 12.5 | 16.3 |
| Extract transfer duct: AHU → recovery unit | 2.50 | 13.6 | 0.13 | 4.74 | 4 289 | turbulent | 0.040 | 4 | 0.81 | 16.0 | 17.2 |
| Exhaust duct: recovery unit → louvre | 2.50 | 13.2 | 0.05 | 5.06 | 4 432 | turbulent | 0.039 | 0 | 1.00 | 17.6 | 17.2 |
| Supply boot (rectangular 30 × 23.2 mm) | 6.00 | 26.2 | 0.09 | 2.39 | 4 154 | turbulent | 0.040 | 1 | 0.65 | 2.7 | 26.6 |
| Return duct (rectangular 33 × 23.1 mm) | 5.50 | 27.2 | 0.06 | 2.00 | 3 611 | transitional | 0.038 | 0 | 0.50 | 1.4 | 25.5 |
| Supply riser, up to the diffuser-1 tee | 6.00 | 28.0 | 0.66 | 2.71 | 5 025 | turbulent | 0.038 | 4 | 1.35 | 9.9 | 26.6 |
| Supply riser, tee → diffuser 2 | 3.00 | 28.0 | 0.25 | 1.35 | 2 512 | transitional | 0.029 | 1 | 0.75 | 1.1 | 18.8 |
| Diffuser drop 1 | 3.00 | 25.0 | 0.03 | 1.70 | 2 814 | transitional | 0.032 | 0 | 1.00 | 1.8 | 18.8 |
| Return branch (grille 2) | 2.75 | 20.0 | 0.16 | 2.43 | 3 224 | transitional | 0.035 | 1 | 0.85 | 4.0 | 18.0 |

Result: the highest velocity is 5.06 m/s in *Exhaust duct: recovery unit → louvre*. Over 5 m/s: Exhaust duct: recovery unit → louvre (5.06 m/s; Ø14.0 mm would give 4.5 m/s). It is short, so its pressure drop stays small; enlarge it if it is noisy. The supply main runs at 2.39 / 2.71 / 1.35 m/s. Duct friction is small next to the filters and coils (sections 12–13), so the duct sizes in the model are adequate. The 13–15 mm air-pump lanes are the tightest, and that is acceptable at their short lengths.

**Branch balancing (fresh-air split).** The 75 / 25 split between the air-pump lane and the direct branch is set by their resistances. The air-pump lane loses 99.1 Pa (filter, core, ducts) and the direct branch 0.5 Pa. So the direct branch needs a **balancing orifice** that drops 98.6 Pa at 0.75 m³/h:
```
A_o = Q / (C_d · √(2·ΔP/ρ)) = 0.000208 / (0.61 · √(2·98.6/1.2)) = 26.6 mm²   →   orifice Ø ≈ 5.8 mm (adjust ±20 % on site to set FT-101 split)
```

## 12. Fan selection: system pressure budgets

Filters are rated **clean**, at **mid-life** (halfway to final) and at **final** pressure. Select each fan so that its curve passes the mid-life point at the design flow at about 70–80 % speed, and still reaches the final point at full speed. Component pressure drops are typical values for these components at the face velocities in the CAD (AHU face 7.3 cm², 2.27 m/s at 6.0 m³/h). Confirm them with the parts you buy. Coil drops scale as ΔP ∝ v^1.8 from 25 Pa at 2.5 m/s.

**FAN-102 supply fan: recirculating loop (the room pressure cancels around the loop)** at Q = 6.00 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| Mixing damper (recirculation side) | 5.0 | 5.0 | 5.0 | open blade, ≈2.6 m/s |
| Panel filter | 40.0 | 95.0 | 150.0 | ePM10 50 % panel |
| Bag filter | 80.0 | 165.0 | 250.0 | ePM1 55 % bag |
| Pre-heat coil | 21.0 | 21.0 | 21.0 | dry, 2-row micro coil |
| Cooling coil (wet) | 27.3 | 27.3 | 27.3 | wet in summer (+30 %) |
| Reheat coil | 10.0 | 10.0 | 10.0 | finned PTC element |
| Droplet eliminator | 8.0 | 8.0 | 8.0 | droplet eliminator |
| Steam lance | 3.0 | 3.0 | 3.0 | steam lance |
| H13 HEPA | 145.0 | 297.5 | 450.0 | H13; PDT-102 alarm at 450 Pa |
| Attenuator | 8.0 | 8.0 | 8.0 | attenuator |
| Supply boot (duct) | 2.7 | 2.7 | 2.7 |  |
| Supply riser (duct) | 11.0 | 11.0 | 11.0 |  |
| Ceiling diffuser | 5.2 | 5.2 | 5.2 | neck Ø25 mm, K 3.0 |
| Return grilles | 1.6 | 1.6 | 1.6 | free area ≈7.5 cm², K 2.5 |
| Return duct (duct) | 1.4 | 1.4 | 1.4 |  |
| Extract pre-filter (recirculated air) | 40.0 | 95.0 | 150.0 | extract pre-filter |
| **Total** | **409.1** | **756.6** | **1104.1** |  |

**FAN-101 fresh-air compressor: lab → mixing box** at Q = 2.99 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| Louvre + bird mesh | 7.4 | 7.4 | 7.4 |  |
| Intake (duct) | 0.2 | 0.2 | 0.2 |  |
| Compressor discharge (duct) | 2.0 | 2.0 | 2.0 |  |
| Fresh-air header (duct) | 0.6 | 0.6 | 0.6 |  |
| Recovery-unit lane (filter, core, ducts; the direct branch is balanced to it) | 99.1 | 99.1 | 99.1 |  |
| AHU outdoor-air pre-filter | 40.0 | 95.0 | 150.0 | ISO Coarse 60 % panel |
| AHU plate core, fresh side | 30.0 | 30.0 | 30.0 | plate core, each stream |
| Outdoor-air damper | 5.0 | 5.0 | 5.0 | open blade, ≈2.6 m/s |
| Back-pressure of the mixing box (gauge) | -28.0 | -28.0 | -28.0 |  |
| **Total** | **156.2** | **211.2** | **266.2** |  |

**FAN-103 exhaust fans (two in series): extract deck → outdoors** at Q = 2.50 m³/h

| Component | Clean (Pa) | Mid-life (Pa) | Final (Pa) | Note |
|---|---|---|---|---|
| Extract pre-filter | 40.0 | 95.0 | 150.0 | extract pre-filter |
| Extract bag filter | 80.0 | 165.0 | 250.0 | extract bag filter |
| AHU plate core, exhaust side | 30.0 | 30.0 | 30.0 | plate core, each stream |
| Extract transfer duct | 16.0 | 16.0 | 16.0 |  |
| Recovery-unit exhaust filter | 40.0 | 95.0 | 150.0 | air-pump unit exhaust filter |
| Crossflow core, exhaust side | 30.0 | 30.0 | 30.0 | crossflow core, each stream |
| Exhaust-air coil | 20.0 | 20.0 | 20.0 | exhaust-air coil (evaporator) |
| Exhaust duct | 17.6 | 17.6 | 17.6 |  |
| Exhaust louvre | 7.4 | 7.4 | 7.4 |  |
| Less: pressure available in the extract deck | -12.0 | -12.0 | -12.0 |  |
| **Total** | **268.9** | **463.9** | **658.9** |  |

| Fan | Duty point (mid-life) | Must also reach (final, full speed) | Selection |
|---|---|---|---|
| FAN-102 supply | 6.00 m³/h at 757 Pa | 6.00 m³/h at 1 104 Pa | 24 V DC centrifugal (radial) blower, PWM + tach. Shut-off pressure ≥ 1 380 Pa, free air ≥ 18 m³/h |
| FAN-101 fresh-air compressor | 2.99 m³/h at 211 Pa | 2.99 m³/h at 266 Pa | 24 V DC centrifugal blower, PWM + tach. Shut-off ≥ 333 Pa, free air ≥ 12 m³/h |
| FAN-103 exhaust (×2 in series) | 2.50 m³/h at 464 Pa total | 2.50 m³/h at 659 Pa | two 24 V DC blowers, each ≥ 412 Pa shut-off, PWM in parallel, tach from one |

The supply loop is the hardest duty, because four filter stages are in series. If the blower you find cannot reach 1 104 Pa, change the filters earlier: panel at 100 Pa, bag at 160 Pa and HEPA at 300 Pa (set the A09 limit to 300). That brings the final point down to **764 Pa**, which 75–97 mm high-pressure 24 V blowers can reach.

Fan affinity for retuning: `Q₂/Q₁ = n₂/n₁`, `ΔP₂/ΔP₁ = (n₂/n₁)²`, `P₂/P₁ = (n₂/n₁)³`. Air power: `P_air = Q·ΔP`. At the supply duty point this is 1.26 W; with a small-blower total efficiency of about 15–25 % that needs 6.3 W electrical, which matches the 8 W rating.

## 13. Actuator sizing

**SV-101 mixing-damper servo.** There are two linked dampers (outdoor air and recirculation), each with a face of about 22 × 32 mm and blade chord 2.9 mm (CAD).
```
aerodynamic torque   T_a ≈ ΔP · A_face · c / 4 = 30 · 0.000704 · 0.0029 / 4 = 0.0000153 N·m
seal / bearing torque T_s ≈ 5 N·m per m² of face × 2 dampers = 0.00704 N·m      linkage friction ≈ 0.02 N·m
required              T = 0.0271 N·m   → with ×3 margin 0.0812 N·m
```
The MG996R gives about 0.94 N·m at 4.8 V, so it has far more torque than needed (35×); metal gears and good holding are why it was chosen. An SG90-class servo (0.18 N·m) would also work. It travels 60° in 0.17–0.2 s, which meets the model's 0 → 90° in about 0.6 s. Control is a 50 Hz pulse, 500 µs = 0° and 2 500 µs = 180°; the damper uses 0 … 90°.

**CMP-101 compressor.** The largest coil duties found are cooling 46.4 W (summer 42 °C) and heating 6.1 W (winter −10 °C). With 30 % margin the compressor needs **≥ 60 W cooling at T_e ≈ 5 °C / T_c ≈ 50 °C** and an inverter speed range of about 3 : 1. The model's capacity limits are 60 W cooling and 45 W heating. At the worst summer point u_cmp = 0.78, so the compressor is within its range.

> **Reality check.** The smallest commercial DC compressors (24 V miniature rotary compressors) give roughly 100–300 W of cooling at minimum speed. That is several times this rig's need, so the real compressor will cycle on and off at minimum speed. The firmware enforces a 180 s minimum off time and a 120 s minimum run time, and the receiver absorbs the charge swings. A capillary tube plus an EEV trim, or a hot-gas bypass, gives finer control. These miniature compressors are mostly made for R134a or R290. R32 versions exist but are rare, so confirm the refrigerant with the supplier and change the charge and the safety notes if you use another refrigerant.

**HTR-101 PTC reheat.** Its sizing condition is summer, reheating from the coil leaving temperature to the supply set point. Model: 10.8 W at design, 11.3 W at 42 °C, less the desuperheater share. Rating 30 W, giving 2.7× margin. At 24 V that is 1.25 A, so use a self-regulating finned PTC (Curie point ≈ 120 °C) with a 130 °C thermal fuse in series.

**HUM-101 steam humidifier.** The sizing condition is the coldest, driest winter: outdoor −10 °C / 80 % (w = 1.41 g/kg) and room 22 °C / 45 % (w = 7.38 g/kg), with fresh-air fraction f = 0.37:
```
ṁ_steam = f · (w_room − w_oa) · ρ · Q_sup − G_w = 0.37 · 5.96e−3 · 1.2 · 6.0 − 0.001 = 14.7 g/h      model: 16.6 g/h
power ≈ ṁ · (h_fg,100°C + c_w·ΔT) = 14.7 · (2257 + 4.19·90) / 3600 = 10.7 W
```
Rating 30 g/h (2.0× margin), 22.5 W. Use a **steam** (boiling) humidifier, not an ultrasonic one: ultrasonic mist carries the dissolved minerals into a clean room as particles.

**RV-101 reversing valve:** a miniature 4-way valve with a 24 V DC coil (about 5 W), switched by a logic MOSFET with a flyback diode. Switch it only with the compressor stopped and the pressures equalised (firmware: 30 s).

**EEV-101:** a miniature stepper EEV (bipolar drive, about 500 steps from fully closed to fully open), driven by a DRV8825 at 24 V with current limiting set to the coil rating (V_ref = I_coil × 0.5 Ω). The firmware homes it by over-driving 560 steps closed at start-up. The refrigerant mass flow it must pass is in section 14.

## 14. Refrigerant circuit sizing (R32)

R32 property values are approximate saturation values (from IIR-reference tables): h_liquid(45 °C) ≈ 290 kJ/kg, h_vapour(5 °C) ≈ 517 kJ/kg, plus 5 K superheat (≈ +6 kJ/kg).
```
refrigerating effect   Δh_evap = 517 + 6 − 290 = 233 kJ/kg
mass flow              ṁ_ref = Q_evap / Δh_evap = 46.4 W / 233 kJ/kg = 0.199 g/s = 0.7 kg/h
condenser duty         Q_cond = Q_evap + W ≈ 63.0 W   (summer worst case)
```
Line sizing: keep the liquid line at 0.3–1 m/s and the suction line at ≥ 4 m/s for oil return. At about 0.7 kg/h, 1/8" (3.2 mm OD, 1.8 mm ID) tube gives a liquid velocity of 0.08 m/s. On the suction side, 3/16" (4.8 mm OD, 3.2 mm ID) gives 1.0 m/s at a vapour density of about 25 kg/m³.

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
| FAN-103 2 × exhaust fans | 24 V | 6.4 | max speed |
| CMP-101 compressor + driver | 24 V | 25.0 | ≈ 60 W cooling ÷ COP 3 + driver 5 W; start current limited by the driver |
| HTR-101 PTC reheat | 24 V | 30.0 | self-limiting PTC |
| HUM-101 steam humidifier | 24 V | 22.5 | 30 g/h × 0.75 Wh/g |
| EEV-101 stepper (DRV8825, current-limited) | 24 V | 2.0 | holding current reduced after a move |
| RV-101 4-way valve coil | 24 V | 5.0 | energised in one season only |
| D6F flow sensors ×2 | 24 V | 0.6 |  |
| 5 V rail: servo (stall 2.5 A peak), HMI 7" (≈2 W), ACS712 ×3, SPS30 ×2 (≈0.4 W each) | 24 V | 15.0 | via the 24 → 5 V 3 A buck, 90 % efficient |
| 3.3 V: ESP32-S3, TCA9548A, SHT31 ×3, SDP810 ×2, DS18B20 ×5 | 24 V | 1.5 | from the 5 V rail |
| **Connected total** |  | **130.8** |  |

**Power supply.** Connected load 130.8 W. The PTC and humidifier run in winter and the PTC is light in summer, but size for all of it plus 25 %: **24 V DC, ≥ 170 W (7.1 A)**, e.g. a 150 W enclosed DIN or chassis supply. The 5 V rail comes from a 24 → 5 V 3 A buck (servo stall 2.5 A is the peak). The ESP32-S3 makes its own 3.3 V.

| Current channel | Loads | Max current (A) | ACS712-05B range ±5 A | Fuse |
|---|---|---|---|---|
| CT-101 | compressor driver | 1.04 (start ≈ 3 A, limited by the driver) | OK | 3 A slow-blow |
| CT-102 | all fans | 1.21 | OK | 2 A |
| CT-103 | PTC + humidifier | 2.19 | OK | 3.15 A |
| Main | everything | 5.5 | — | 8 A at the PSU output |

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
| TT-102 … 104, 107, 108 | DS18B20 (1-Wire) | T = raw / 16 °C (12-bit, 750 ms) | −55 … 125 °C, ±0.5 K |
| FT-101 | Omron D6F-W04A1 in the Ø23 mm header | v = table(V_out); Q = k_p · v · A · 3600 | 0 … 4 m/s; design 2.00 m/s |
| FT-102 | Omron D6F-W04A1 in the Ø28 mm riser | same; k_p ≈ 0.82 (centre-line → mean, turbulent) | design 2.71 m/s |
| PDT-101 | Sensirion SDP810-125Pa (I²C 0x25) | ΔP = raw / scale (scale read from the sensor, 240 /Pa) | ±125 Pa; set point 15 Pa |
| PDT-102 | Sensirion SDP810-500Pa (I²C 0x25) | ΔP = raw / scale (60 /Pa) | ±500 Pa; clean 145 Pa, alarm 450 |
| PT-101 (room), PT-101A (fill point) | Sensirion SPS30 ×2 (I²C 0x69) | N(≥0.5 µm) = (NC10 − NC0.5) · 10⁶ /m³;  N(≥5 µm) ≈ 0.57 · (NC10 − NC4.0) · 10⁶ | 0 … 3 000 /cm³; indicative only (see §18) |
| CT-101 … 103 | ACS712-05B + 10 k/20 k divider | see §15 | ±5 A |
| VT-101 | 100 k / 10 k divider | V = 11 · V_adc | 0 … 30 V |

The D6F-W output is **not linear**. The firmware uses a 6-point lookup table: 0.50 V at 0 m/s up to about 2.50 V at 4 m/s. Fill it from the curve in the datasheet, then **calibrate in place** against a reference anemometer or a bag-and-stopwatch flow test, and set k_p so that FT-102 reads the reference flow.

## 17. Fit check: what fits inside the scaled AHU

The AHU and air-pump unit are Model C's units at 1.1 cm per model unit, as required. The AHU casing is about **220 × 50 × 37 mm** and the air-pump unit about 180 × 29 × 35 mm. The 3D model keeps their shape and layout. Some real parts are bigger than the space drawn for them:
| Part | Drawn in the CAD | Typical real minimum | Build |
|---|---|---|---|
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

The plant room is about 490 × 490 × 490 mm and the AHU fills only part of it, so all of these fit beside it without changing the AHU's shape.

## 18. Assumptions to verify on the real rig

- Component pressure drops in §12 are typical values. Measure the real ones with PDT-102 and a handheld manometer, then rerun the fan check.
- Core effectivenesses ε₁ and ε₂ (50 % each by default). Measure T₁ and T₂ with probes and correct them on the HMI.
- Room leakage k_leak: measure Q_leak at 15 Pa (fresh minus exhaust flow at steady state) and update `HW.leakK`.
- Thermal mass C_room and envelope UA: run a step test (heater on, log TT-106) and fit the time constant τ = C/(UA + C_sup).
- Particle sensors: the SPS30 is a low-cost optical sensor, good for trends and demonstrations. GMP classification needs an ISO 21501-4 counter at 28.3 L/min through the isokinetic probe.
- COP model (half of Carnot): compare with the measured CT-101 power and coil duty (C_sup·ΔT across the coil).
- Compressor size: see the reality check in §13.

_Generated by `tools/calc-report.js` from the simulator model and the 3D geometry._
