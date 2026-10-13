# PCB and wiring harness

The rig has no loose wires. One **main controller PCB** sits on the plant room's back wall. Every sensor and actuator connects to it through its own **flat FR4 strip** with copper tracks, as drawn in the 3D model and the STEP file (*PCB wiring harness* sub-assembly, `PCB strip <tag>` parts). This page gives the connector pin-out of every strip, the main-board layout rules and the build order.

The schematics are [`03-wiring-power.svg`](03-wiring-power.svg) and [`03-wiring-controller.svg`](03-wiring-controller.svg). The pin map is [`02-io-list.csv`](02-io-list.csv), and it matches [`../firmware/include/config.h`](../firmware/include/config.h).

## Main PCB

- 2 layers, FR4 1.6 mm, 1 oz copper, about 180 × 120 mm, mounted on the back wall at the PCB position in the CAD (`PCB = {x −300 … −120 mm, y 270 … 390 mm}` from the box centre).
- **Bottom layer: solid 0 V plane.** The 24 V bus runs on the top layer at ≥ 2.5 mm width. The ACS712 modules sit right next to their fuses.
- Keep the ADC inputs (GPIO1, 2, 4–7) away from the fan PWM and heater PWM tracks. Put a 100 nF capacitor at each ADC pin and a 10 µF capacitor on each ACS712 output.
- Track widths (IPC-2221, 1 oz, 10 °C rise): signals 0.25 mm; fans 0.4 mm; PTC and compressor ≥ 1.0 mm; 24 V bus ≥ 2.5 mm (or add solder over the track).
- Mount the ESP32-S3-DevKitC-1 on 2 × 22-pin female headers so it can be swapped. Its USB-C port must be reachable from outside the box for flashing and telemetry.

## Connectors and strips

Connectors are JST-XH (2.5 mm pitch) unless noted. Pin 1 is marked on the board.

| J | Strip (CAD part) | Pins | Signals (pin 1 → n) | Current | Track width on the strip |
|---|---|---|---|---|---|
| J1 | PSU input | 2 (screw terminal) | +24 V, 0 V | 6.5 A | wire 1.0 mm² |
| J2 | PCB strip: FAN-101 | 4 | +24 V, 0 V, PWM (open drain), TACH | 0.6 A | 1.0 / 1.0 / 0.25 / 0.25 mm |
| J3 | PCB strip: FAN-102 | 4 | +24 V, 0 V, PWM, TACH | 0.4 A | 1.0 / 1.0 / 0.25 / 0.25 |
| J4 | PCB strip: FAN-103 (+ FAN-103B) | 4 | +24 V, 0 V, PWM (both fans), TACH (fan A) | 0.3 A | 1.0 / 1.0 / 0.25 / 0.25 |
| J5 | PCB strip: SV-101 | 3 | +5 V, 0 V, SIG (330 Ω) | 2.5 A stall | 1.0 / 1.0 / 0.25 |
| J6 | PCB strip: CMP-101 | 3 | +24 V (through CT-101), 0 V, SPEED 0–5 V | 1.1 A | 1.0 / 1.0 / 0.25 |
| J7 | PCB strip: RV-101 *(on the CMP strip)* | 2 | +24 V, SW− (MOSFET) | 0.2 A | 0.5 / 0.5 |
| J8 | PCB strip: EEV-101 | 4 | A1, A2, B1, B2 (DRV8825) | 0.3 A | 0.5 each |
| J9 | PCB strip: HTR-101 | 2 | +24 V (through CT-103), SW− | 1.3 A | 1.0 / 1.0 |
| J10 | PCB strip: HUM-101 | 2 | +24 V (through CT-103), SW− | 0.95 A | 1.0 / 1.0 |
| J11 | PCB strip: FT-101 | 3 | +24 V, 0 V, Vout | 15 mA | 0.25 each |
| J12 | PCB strip: FT-102 | 3 | +24 V, 0 V, Vout | 15 mA | 0.25 each |
| J13 | PCB strips: TT-102, TT-103, TT-104 (daisy-chained) | 3 | +3.3 V, 0 V, DQ (bus A) | < 5 mA | 0.25 each |
| J14 | PCB strips: TT-107, TT-108 | 3 | +3.3 V, 0 V, DQ (bus B) | < 5 mA | 0.25 each |
| J15 | PCB strip: TT-101 (MT-101) | 4 | +3.3 V, 0 V, SDA0, SCL0 | < 2 mA | 0.25 each |
| J16 | PCB strip: TT-105 | 4 | +3.3 V, 0 V, SDA1, SCL1 | < 2 mA | 0.25 |
| J17 | PCB strip: PDT-101 | 4 | +3.3 V, 0 V, SDA2, SCL2 | < 5 mA | 0.25 |
| J18 | PCB strip: PDT-102 | 4 | +3.3 V, 0 V, SDA3, SCL3 | < 5 mA | 0.25 |
| J19 | PCB strip: TT-106 | 4 | +3.3 V, 0 V, SDA4, SCL4 | < 2 mA | 0.25 |
| J20 | PCB strip: PT-101 | 7 | +5 V, 0 V, SDA5, SCL5, SDA6, SCL6, SEL (0 V) | 0.2 A | 0.5 / 0.5 / 0.25 … |
| J21 | PCB strip: HMI-101 | 4 | +5 V, 0 V, TX (GPIO17), RX (GPIO18 via 1 k) | 0.5 A | 0.5 / 0.5 / 0.25 / 0.25 |
| J22 | PCB strip: CT (on board) | — | the current sensors are on the main PCB | — | — |
| J23 | PCB strip: PSU | — | the 24 V feed from the PSU to J1 | 6.5 A | wire 1.0 mm² |

There are **no strips or connectors** for the R32 receiver, suction accumulator, filter-drier, sight glass or charging ports. They are mechanical refrigerant parts. The pass box and the vial filling machine are stand-alone and are not wired to the rig either.

## Strip construction

- 1.0 mm FR4 (flex-rigid where a strip bends around a corner), copper tracks on the top side, solder mask, tinned pads at both ends.
- Track spacing ≥ 0.5 mm for 24 V. I²C pairs run side by side with 0 V on both sides. Keep each I²C strip under 0.5 m; that is why every device has its own mux channel.
- The device end of each strip is soldered to the sensor breakout or terminated in a small JST. The board end is a JST-XH plug.
- Fix the strips to the acrylic with 3M VHB at about 100 mm spacing, along the routes shown in the 3D model (floor runs, then risers to each device).

## Build order

1. Assemble the main PCB and fit the fuses, but don't plug the ESP32 in yet. Power it at 24 V through a current-limited bench supply (0.3 A). Check 5 V on the buck output and that every fuse is intact.
2. Plug in the ESP32-S3, flash the firmware (`firmware/README.md`), and open the monitor. Connect the I²C strips one at a time: the boot **SCAN** must show each device on its channel.
3. Connect the 1-Wire probes and copy the printed ROM codes into `config.h`. Connect the D6F sensors and check that 0.5 V reads as zero flow.
4. Connect the fans (J2–J4), then the servo. With `RUN on` and `MAN L1 30`, check the tach and the flow readings.
5. The compressor (J6), valve (J7) and EEV (J8) come last, after the refrigerant circuit has been leak-tested and charged (`08-build-and-commissioning.md`).
