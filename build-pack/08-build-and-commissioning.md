# Build and commissioning guide

These are the steps to turn the CAD, the wiring and the firmware into a working rig, and then prove it works. Read the *Fit check* (calculations §17) first: the AHU and the air pump keep Model C's shape, so the compressor, receiver, accumulator, humidifier boiler and blowers mount on the plant-room floor beside them.

## 1. Mechanical build

1. **Enclosure.** Cut the 5 mm cast acrylic panels from `cad/drawings/enclosure-GA.pdf`: panel views, cut-outs and the cut list. Bond them with acrylic cement (dichloromethane-based) on the aluminium 20×20 base frame. Fit the partition at x = 0 with its two sleeves: supply at the top, return low.
2. **Units.** 3D-print or laser-cut the AHU and air-pump unit casings from the STEP sub-assemblies (`cad/step/AHU.step`, `cad/step/Heat-recovery_air-pump_unit.step`). Seal the joints with silicone; every leak spoils the pressure and energy figures.
3. **Ducts.** Make them from clear PVC/PETG tube at the diameters in calculations §11: header Ø23, riser Ø28, air-pump lanes Ø13.6–15, return branch Ø20 mm. Use the bend radius from the CAD (1.6 × r). Fit the **balancing orifice** (≈ Ø6 mm, §11) in the direct fresh-air branch.
4. **Filters.** Cut the filter media to the CAD faces. Bond the H13 media into its frame with polyurethane, then **leak-scan** the frame with a particle counter before use.
5. **Clean room.** Fit the false ceiling at 400 mm, the two ceiling diffusers, the two low-level return grilles, the hinged door with an EPDM seal, the pass box (two doors with a mechanical interlock, UV lamp) and the vial filling machine under diffuser 2.
6. **Sensors.** Fit DS18B20 probes in the air stream (not touching a coil), the SHT31s in a shaded spot of the stream, and the D6F flow sensors on straight runs (≥ 5 D upstream, 2 D downstream). Run the SDP810 tubes to the room and to a lab reference port, and the HEPA ΔP tubes across the filter.

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
3. **L2 fresh air**, then **L3 damper**: the mixed air (TT-102) should settle at its set point. The damper never goes below the minimum fresh air.
4. **L4 compressor**, **L5 PTC**, **L6 humidifier**: these are slow loops. Give each 30 min and log with the live monitor. Retune K_p/T_i only if a loop oscillates: halve K_p first.
5. **Interlocks:** stop the supply fan with `MAN L1 0`. The PTC, humidifier and compressor must drop out within 1 s.

## 7. Performance tests

1. **ACH.** ACH = FT-102 / 0.0953 m³. Cross-check with a tracer decay: fill the room with smoke or CO₂, then log the decay. ACH = ln(C₀/C)/t.
2. **Recovery time 100:1.** Raise the particle count with a smoke puff and time the drop to 1 % on PT-101. Expect about 4.6/ACH h, ≈ 4.4 min at 62.9 ACH.
3. **Energy A/B test** (calculations §10): put **L3 in manual at the same damper position** in both runs, e.g. `MAN L3 30`.
   - Run A: `REC on`, 60 min after 30 min to settle, then `RESET energy` and log 60 min.
   - Run B: bypass the cores by hand: open the AHU core bypass slide and close the air-pump fresh lane slide gate. Then send `REC off`. Settle 30 min, `RESET energy`, and log 60 min under the same outdoor conditions.
   - Saving = 1 − E_A / E_B. Compare it with the live twin's figure. The model predicts 35 % (winter, 30 % fresh air), 44 % (winter, 50 %) and 40 % (summer, 30 %).
4. **Containment.** Check that the room holds Grade B in operation (PT-101 < 352 000 /m³) and the fill point Grade A (PT-101A < 3 520 /m³) with the filler running and the operator present. Opening the pass box door should give only a short, small rise.

## 8. Safety checklist

- [ ] PE connected; mains part in a closed enclosure; 24 V fuses fitted.
- [ ] PTC thermal fuse in series; heaters cannot run without airflow (test it).
- [ ] Refrigerant charge recorded and labelled (R32, A2L, GWP 675, mass); leak test passed.
- [ ] Steam humidifier hot surfaces guarded; water topped up with demineralised water.
- [ ] UV lamp in the pass box only runs with both doors closed.
- [ ] Emergency stop: the PSU mains switch, within reach.
