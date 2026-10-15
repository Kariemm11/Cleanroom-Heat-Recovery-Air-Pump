# Rig controller firmware (ESP32-S3)

Firmware for the clean-room heat-recovery air-pump rig. It runs the same eight loops (seven PI loops and the two-position L3 exhaust diverter), interlocks, alarms and energy/CO₂ accounting as the simulator (`assets/js/rig-model.js`). It reads the real sensors and drives the real actuators. The equations are in [`../build-pack/07-engineering-calculations.md`](../build-pack/07-engineering-calculations.md) §8–9, and the pin map is in [`../build-pack/02-io-list.csv`](../build-pack/02-io-list.csv).

| File | What it does |
|---|---|
| `include/config.h` | Every pin, PWM setting and calibration constant (the D6F table, ACS712 scaling, 1-Wire ROM codes) |
| `include/control.h`, `src/control.cpp` | The controller: psychrometrics, PI loops, sequencing, compressor protection, alarms, the baseline twin, energy and CO₂. **Plain C++, no Arduino**, so it is unit-tested on a PC |
| `src/sensors.*` | SHT31, SDP810 and SPS30 behind the TCA9548A mux (raw I²C with CRC checks); DS18B20 (1-Wire); D6F flow, ACS712 current and bus voltage (ADC); fan tachometers |
| `src/actuators.*` | Fan PWM (25 kHz), damper servo (50 Hz), compressor speed (0–5 V via RC + LM358), 4-way valve, EEV stepper (DRV8825), PTC heater and humidifier PWM |
| `src/comms.*` | 1 Hz JSON telemetry on USB, text commands (USB and HMI), Nextion-style HMI updates, settings in flash (NVS) |
| `src/main.cpp` | Scheduler: 100 ms control step on core 1, sensor task on core 0 |
| `test/` | Host unit tests and a syntax check against Arduino stand-ins |

## Build and flash

1. Install [PlatformIO](https://platformio.org) (VS Code extension or `pip install platformio`).
2. Connect the ESP32-S3-DevKitC-1 by its **USB** port (not the UART port).
3. Run:

```bash
cd firmware
pio run -t upload          # build and flash
pio device monitor         # 115200 baud: JSON telemetry + replies to commands
```

The libraries (OneWire, DallasTemperature) are fetched automatically from `platformio.ini`. The code builds on Arduino-ESP32 core 2.x, which PlatformIO's `espressif32@6.9.0` uses, and on core 3.x: the LEDC calls switch automatically.

## First power-up

1. With the 24 V loads disconnected, flash and open the monitor. At boot it prints a **SCAN**: every 1-Wire ROM code and the I²C devices on each mux channel. Expected: ch0, ch1 and ch4 → `0x44`; ch2 and ch3 → `0x25`; ch5, ch6 and ch7 → `0x69`; 3 probes on bus A and 2 on bus B.
2. Paste the ROM codes into `config.h` (`ROM_TT109`, `ROM_TT103` … `ROM_TT108`), so each probe keeps its tag whatever the bus order.
3. Send `RUN off` and then `ZERO` with all loads off, to store the current-sensor zeros. They are also taken automatically at boot.
4. Calibrate FT-101 and FT-102 (see `build-pack/08-build-and-commissioning.md` §5). Edit `D6F_V`/`D6F_MS` and `FT10x_KP`, then reflash.
5. Connect the loads and send `RUN on`.

## Commands

Send commands on USB, or from the HMI. One command per line, not case-sensitive:

| Command | Effect |
|---|---|
| `SET flow 6.0` | supply airflow set point, m³/h, 100 % fresh air (also `rh` %, `dp` Pa, `ef` kg CO₂/kWh, `cop` baseline COP) |
| `SET trip 1000` / `SET reset 300` | PT-102 exhaust particle levels (/m³) that throw DV-101 to the outer HEPA / let it return |
| `SET coil 21` / `SET sup 22` / `SET room 21` | temperature set points of the active season, °C: coil, fixed supply, clean room |
| `TCTL room` / `TCTL supply` | temperature control: **room set point** (L8 cascade moves the supply set point to hold TT-106, the default) or a **fixed supply** set point |
| `MODE winter` / `MODE summer` | sequenced season change: compressor stops, 30 s pressure equalisation, then the 4-way valve switches |
| `REC on` / `REC off` | recovery on / **baseline test** (also bypass the cores by hand, see the commissioning guide) |
| `RUN on` / `RUN off` | system on / everything off |
| `MAN L5 40` / `AUTO L5` | a loop (L1…L8) in manual at 40 % output / back to auto (bumpless) |
| `MAN L3 0` / `MAN L3 100` | force DV-101: exhaust to the air pump / to the outer HEPA (`AUTO L3` returns to PT-102 control) |
| `RESET energy` | clear the Wh and CO₂ counters (start of an A/B test) |
| `ZERO` | current-sensor zero (only with RUN off) |
| `SCAN`, `GET`, `HELP` | list devices / print settings / list commands |

Set points, season and recovery mode are stored in flash and restored at power-up.

## Telemetry (USB, 1 Hz)

There is one JSON object per line. `build-pack/09-live-monitor.html` reads it with Web Serial (Chrome or Edge). It shows the values live, sends commands and records a CSV.

```json
{"t":812.0,"mode":"winter","on":1,"rec":1,
 "s":{"TT101":-1.95,"MT101":79.8,"FT101":6.01,"TT109":12.2, … ,"PT101":121000,"PT101A":1580,"PT102":6,"RPM102":3120},
 "u":{"fa":0.247,"sf":0.333,"ef":0.209,"dv":0.00,"cmp":0.300,"rh":0.051,"hum":0.640,"eev":200,"rv":0},
 "k":{"ach":62.9,"f":1.00,"P":22.8,"Pb":41.1,"sav":0.445,"co2h":11.4,"co2hb":20.6,"coilSP":21.0,"supSP":22.0,"Ewh":5.1,"Ewhb":9.2,"co2g":2.6,"co2gb":4.6,"room":"B","fill":"A"},
 "man":[0,0,0,0,0,0,0],"al":[]}
```

A missing or faulty sensor is sent as `null`. The loops that need it hold their last output, and alarm A13 is raised.

## HMI-101 (7" serial HMI)

The firmware writes Nextion-style updates (`name.txt="value"` + `FF FF FF`) every 500 ms to the text components `tt101 mt101 ft101 tt109 tt103 tt104 tt105 mt105 ft102 pdt101 pdt102 tt106 mt106 tt107 tt108 pt101 pt101a pt102 ach pw pwb sav co2 ewh mode grade dv101 alarms`. On the HMI, set-point buttons send the text commands above, e.g. `prints "SET flow 6.0\r\n",0`. Any 115200-baud serial HMI that understands this format will work.

## Safety built into the firmware

- The compressor, PTC and humidifier run only with **proven airflow** (FT-102 > 25 % of set point). The PTC and humidifier also need FAN-102's tach > 300 rpm.
- Compressor: minimum off time 180 s, minimum run 120 s, 10 %/s ramp, frost pull-back (TT-108 < −3 °C). Season changes are sequenced.
- The humidifier is blocked when the supply RH (MT-105) is above 85 %.
- **Contaminated exhaust (L3):** PT-102 above the trip level for 5 s throws DV-101 to the outer BIBO HEPA (alarm A06); it returns to the air pump only after 60 s below the reset level. A missing PT-102 reading counts as contaminated. DV-101 is spring return, so RUN off, a reset or a power cut leaves the exhaust on the HEPA. The compressor is locked out while the exhaust is diverted, in both seasons: its exhaust-side coil (evaporator in winter, condenser in summer) has no air.
- Hardware protection still needed: a 130 °C thermal fuse on the PTC, a fuse per channel, and the compressor driver's own over-current protection (see the wiring diagram).

## Tests (on a PC, no hardware)

```bash
cd firmware
g++ -std=c++17 -O1 -Wall -Iinclude test/test_control.cpp src/control.cpp -o /tmp/test_control && /tmp/test_control
./test/check_syntax.sh      # every source file against minimal Arduino-ESP32 stand-ins
```

The unit tests close every loop around a small plant model. They check that the loops settle, the interlocks hold, the compressor minimum off and run times are kept while it cycles, season changes are sequenced, the alarms fire, manual mode is bumpless, and energy and CO₂ add up. They also check that the L8 room cascade brings TT-106 to its set point, that summer pre-cooling through the Cu core works, and that a lost interlock (exhaust diverted, no airflow) stops the compressor at once, even inside its 120 s minimum run time. Expected output: `38 checks, 0 failed`.
