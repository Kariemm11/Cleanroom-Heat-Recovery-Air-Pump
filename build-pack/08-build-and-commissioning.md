# Build and commissioning guide

These are the steps to turn the CAD, the wiring and the firmware into a working rig, and then prove it works. Read the *Fit check* (calculations §17) first: the AHU and the air pump keep Model C's shape, so the compressor, receiver, accumulator, humidifier boiler and blowers mount on the plant-room floor beside them.

## 1. Mechanical build

1. **Enclosure.** Cut the 5 mm cast acrylic panels from `cad/drawings/enclosure-GA.pdf`: panel views, cut-outs and the cut list. Bond them with acrylic cement (dichloromethane-based) on the aluminium 20×20 base frame. Fit the partition at x = 0 with the supply sleeve at the top and the two low-level exhaust-terminal openings; cut the roof opening for the common exhaust stack (front-right of the plant room, away from the fresh-air intake). The fresh-air louvre is the only opening in the outdoor wall.
2. **Units.** 3D-print or laser-cut the AHU and air-pump unit casings from the STEP sub-assemblies (`cad/step/AHU.step`, `cad/step/Heat-recovery_air-pump_unit.step`). The AHU is a single-deck 100 % fresh-air unit: no mixing box, no extract deck, no core. Seal the joints with silicone; every leak spoils the pressure and energy figures.
3. **Cu plate core.** Make the core from 0.3 mm copper (Cu-ETP) plates with a 2 mm gap (calculations §4: about a 66 mm cube). Polish both faces to **Ra ≤ 0.8 µm** and check with a profilometer; fold and seal the edges so the two streams cannot touch. Leak-test the core: pressurise one side to 200 Pa and check that the other side stays at 0 Pa.
4. **Ducts.** All ducts are **rectangular**: make them from 2 mm clear PETG or acrylic sheet, solvent-welded, at the sections in calculations §11 (e.g. riser 31 × 22 mm, air-pump lanes and exhaust 16 × 22 mm), with mitred elbows. Fit a slide gate in the core-bypass branch (shut in service, open only for the baseline test).
5. **Filters.** Cut the filter media to the CAD faces. Bond the H13 (AHU) and H14 (terminals, LAF, outer housing) media into their frames with polyurethane, then **leak-scan** every frame with a particle counter before use. Every terminal is **bag-in/bag-out**: fit the change ring and a PVC change bag to each housing, so a used filter is bagged out without being touched.
6. **Clean room.** Fit the false ceiling at 400 mm with the BIBO ceiling terminal, the right-wall supply plenum with its two BIBO terminals (high and low), the three low-level BIBO exhaust terminals in the partition (the third at the front, beside the pass box), the hinged door with an EPDM seal, the pass box (two doors with a mechanical interlock, UV lamp) and the staging bench beside it. Set the vial filling machine and the operator position along the right wall, the operator's back to the wall terminals, and hang the **LAF hood** over the filler with its PVC skirts down to the RABS.
7. **Exhaust safety.** Fit PT-102 (SPS30 with a short sample probe) and TT-107 on the exhaust main, then DV-101 (spring-return actuator, SPDT end switch wired into the J4 fan feed), the outer BIBO HEPA and FAN-103B on a shelf beside the fresh-air compressor, and the common roof stack with its rain cap. Run the air-pump unit's exhaust up the back-left corner and along the top of the plant room to the same stack, with a backdraft damper on each branch.
8. **Sensors.** Fit DS18B20 probes in the air stream (not touching a coil; TT-109 at the AHU inlet), the SHT31s in a shaded spot of the stream, and the D6F flow sensors on straight runs (≥ 5 D upstream, 2 D downstream). Run the SDP810 tubes to the room and to a lab reference port, and the HEPA ΔP tubes across the filter.

## 2. Refrigerant circuit (certified technician only)

Use R32 (A2L) and work to EU F-gas Regulation 2024/573.

1. Mount the compressor, receiver (≥ 15 cm³), accumulator (≥ 20 cm³), 4-way valve, filter-drier, sight glass and EEV on the plant-room floor. Braze the copper lines (1/8" liquid, 3/16" suction) under a nitrogen purge.
2. **Pressure test** with dry nitrogen to the compressor maker's test pressure. Hold it 24 h with no drop.
3. **Evacuate** to < 500 µm Hg. After isolating the pump it must stay below 1 000 µm Hg for 10 min.
4. **Charge** through the liquid-side Schrader port **by weight**, with the cylinder on a scale. Start at 30 g, run in summer mode, then add in 2 g steps until the sight glass is clear and the superheat is 5–8 K. The design estimate is about 40 g. Record the final charge on the rig label.
5. Leak-check with an electronic A2L detector. Fit the caps on both ports.

## 3. Electrics

1. Build the main PCB and the strips (`04-pcb-and-harness.md`). Follow the power sheet (`03-wiring-power.svg`): fuses F1–F5, the CT placement and the 0 V star point.
2. Before connecting the ESP32, check that 24 V comes up through a current-limited supply, the buck gives 5.0 V, and there is no short on any J connector.
3. Fit the PTC thermal fuse (130 °C) in series. Connect PE from the PSU to the rig frame.

## 4. Firmware

Flash it as in `firmware/README.md`. At first boot, check the **SCAN** printout, paste the 1-Wire ROM codes into `config.h` and reflash. Then send `RUN off` and `ZERO` with all loads off.

## 5. Sensor calibration

| Sensor | Method | Accept |
|---|---|---|
| FT-101, FT-102 (D6F) | Fill the `D6F_V`/`D6F_MS` table from the datasheet curve. Measure each flow against a reference: a calibrated vane anemometer in a straight tube, or the bag method (time to fill a known volume). Adjust `FT10x_KP`. | ±5 % at 3 and 6 m³/h |
| PDT-101, PDT-102 (SDP810) | Zero with both ports open to the same air. Check against an inclined manometer. | ±1 Pa at 15 Pa |
| TT/MT (SHT31), TT (DS18B20) | Put all the probes together in one still-air box beside a reference thermometer for 30 min. Note the offsets in `config.h` if any are > 0.3 K. | ±0.3 K, ±3 % RH |
| CT-101 … 103 (ACS712) | Zero with the loads off. Check against a clamp meter or bench supply at about 1 A. | ±20 mA |
| PT-101 (SPS30) | Compare with a reference counter next to it. The SPS30 is for trends and demonstrations only. | indicative |

## 6. Loop tuning and checks

Bring the loops in one at a time. Put the others in `MAN` at a fixed output.

1. **L1 airflow** (FAN-102): step the set point 5 → 6 m³/h. FT-102 should settle within 10 s without oscillating.
2. **L7 room pressure** (FAN-103): the room should hold +15 Pa ±2 Pa. Open the door: A02 is raised, and it should recover within 30 s after the door closes.
3. **L2 fresh-air header**: FT-101 should follow FT-102 within 0.2 m³/h. **L3 diverter**: `SET trip 10` makes the clean exhaust count as dirty: DV-101 must throw to the HEPA within 5 s + its stroke, FAN-103B must start, A06 must show, and in winter the compressor must stop. `SET trip 1000` again: DV-101 returns after 60 s. Pull the J5 plug (or `RUN off`): DV-101 must spring to the HEPA.
4. **L4 compressor**, **L5 PTC**, **L6 humidifier**: these are slow loops. Give each 30 min and log with the live monitor. Retune K_p/T_i only if a loop oscillates: halve K_p first.
5. **Interlocks:** stop the supply fan with `MAN L1 0`. The PTC, humidifier and compressor must drop out within 1 s.

## 7. Performance tests

1. **ACH.** ACH = FT-102 / 0.0953 m³. Cross-check with a tracer decay: fill the room with smoke or CO₂, then log the decay. ACH = ln(C₀/C)/t.
2. **Recovery time 100:1.** Raise the particle count with a smoke puff and time the drop to 1 % on PT-101. Expect about 4.6/ACH h, ≈ 4.4 min at 62.9 ACH.
3. **Energy A/B test** (calculations §10): with 100 % fresh air both runs have the same ventilation. Keep DV-101 on the air pump (`MAN L3 0`) in run A.
   - Run A: `REC on`, 60 min after 30 min to settle, then `RESET energy` and log 60 min.
   - Run B: open the core-bypass slide gate and close the air-pump fresh-lane gate, then send `REC off`. Settle 30 min, `RESET energy`, and log 60 min under the same outdoor conditions.
   - Saving = 1 − E_A / E_B. Compare it with the live twin's figure. The model predicts 50 % (winter design) and 34 % (summer design).
4. **Containment.** Check that the room holds Grade B in operation (PT-101 < 352 000 /m³) and the fill point Grade A under the LAF (PT-101A < 3 520 /m³) with the filler running and the operator present. Opening the pass box door should give only a short, small rise. Smoke test: smoke released at the filler must move away from the operator, towards the low-level exhausts. Release test: a puff of test dust at the filler must throw DV-101 (PT-102 above the trip level) and the exhaust must return to the air pump a few minutes later.

## 8. Safety checklist

- [ ] PE connected; mains part in a closed enclosure; 24 V fuses fitted.
- [ ] PTC thermal fuse in series; heaters cannot run without airflow (test it).
- [ ] Refrigerant charge recorded and labelled (R32, A2L, GWP 675, mass); leak test passed.
- [ ] Steam humidifier hot surfaces guarded; water topped up with demineralised water.
- [ ] UV lamp in the pass box only runs with both doors closed.
- [ ] DV-101 springs to the HEPA bypass with the power off; the bypass stack is away from the fresh-air intake.
- [ ] Every BIBO housing has a change bag fitted; used filters are bagged out, never handled.
- [ ] Emergency stop: the PSU mains switch, within reach.
