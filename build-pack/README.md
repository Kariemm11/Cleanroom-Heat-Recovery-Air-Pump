# Build pack: everything needed to build the real rig

| # | File | What it is |
|---|---|---|
| 01 | [`../cad/cleanroom-rig-assembly.step`](../cad/cleanroom-rig-assembly.step) | **3D CAD (SolidWorks)**: 266 parts in 8 sub-assemblies; `../cad/step/` holds one file per sub-assembly; `../cad/BOM.csv`; enclosure drawing `../cad/drawings/enclosure-GA.pdf` |
| 02 | [`02-io-list.csv`](02-io-list.csv) | **Inputs and outputs**: every tag, device, signal, ESP32-S3 pin, connector, range, scaling, loop and alarm |
| 03 | [`03-wiring-power.svg`](03-wiring-power.svg), [`03-wiring-controller.svg`](03-wiring-controller.svg), `03-wiring-diagrams.pdf` | **Wiring diagrams**: power distribution (PSU, fuses, current sensors, rails) and controller I/O (every pin → interface → device → connector) |
| 04 | [`04-pcb-and-harness.md`](04-pcb-and-harness.md) | **PCB and harness**: main-board rules, connector pin-outs J1–J21, FR4 strip build, bring-up order |
| 05 | [`05-electronics-bom.csv`](05-electronics-bom.csv) | **Electronics bill of materials** (the mechanical BOM is `../cad/BOM.csv`) |
| 06 | [`../firmware/`](../firmware/) | **ESP32-S3 firmware** (PlatformIO, C++): sensors, actuators, 7 PI loops, interlocks, alarms, energy and CO₂, HMI, telemetry; unit tests |
| 07 | [`07-engineering-calculations.md`](07-engineering-calculations.md) / `.pdf` | **All equations and calculations**: psychrometrics, the full mathematical model, control, energy and CO₂, operating points, **duct sizing**, fan selection, **actuator sizing**, refrigerant circuit, electrical sizing, sensor scaling, fit check |
| 08 | [`08-build-and-commissioning.md`](08-build-and-commissioning.md) / `.pdf` | **Build and commissioning**: mechanical build, refrigerant (certified technician), electrics, calibration, loop tuning, performance and A/B tests, safety |
| 09 | [`09-live-monitor.html`](09-live-monitor.html) | **Live monitor**: open in Chrome or Edge, connect to the rig by USB; live values, alarms, trends, commands, CSV logging |
| 10 | [`10-simulator-standalone.html`](10-simulator-standalone.html) | **The 3D simulation in one HTML file**: works offline with a double-click |

How the pieces relate: the simulator (`../index.html`) is the digital twin. The firmware runs the same loops on the real sensors, and the calculations are generated from the simulator's own model (`node ../tools/calc-report.js`), so all three agree. The wiring diagrams use the same pin map as `../firmware/include/config.h`.
