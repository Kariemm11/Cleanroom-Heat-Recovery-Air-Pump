"""Wiring diagrams for the clean-room rig (A3 landscape SVG, 1 unit = 1 mm).

Sheet 1: power distribution (PSU, fusing, current sensors, rails, connectors)
Sheet 2: controller I/O (every ESP32-S3 pin → interface part → device → PCB connector)

The pin map is the same as firmware/include/config.h and build-pack/02-io-list.csv.
Usage:  python3 tools/make_wiring.py   (writes build-pack/03-wiring-*.svg)
"""
import os
from xml.sax.saxutils import escape

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "build-pack")

INK, DIM, LINE = "#111827", "#4b5563", "#9ca3af"
C_IN, C_OUT, C_PWR, C_GND, C_BUS = "#0369a1", "#b45309", "#b91c1c", "#111827", "#047857"
FONT = "IBM Plex Sans, Arial, Helvetica, sans-serif"


class Sheet:
    def __init__(self, title, number):
        self.e = []
        self.title, self.number = title, number

    def add(self, s):
        self.e.append(s)

    def text(self, x, y, s, size=2.4, color=INK, anchor="start", weight="normal", italic=False):
        st = ' font-style="italic"' if italic else ""
        self.add(f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" fill="{color}" text-anchor="{anchor}" font-weight="{weight}"{st}>{escape(s)}</text>')

    def box(self, x, y, w, h, title=None, lines=(), fill="#ffffff", stroke=INK, size=2.2, tsize=2.6, sw=0.3):
        self.add(f'<rect x="{x:.2f}" y="{y:.2f}" width="{w:.2f}" height="{h:.2f}" rx="0.8" fill="{fill}" stroke="{stroke}" stroke-width="{sw}"/>')
        ty = y + 3.4
        if title:
            self.text(x + 1.6, ty, title, tsize, INK, weight="bold")
            ty += tsize + 0.6
        for ln in lines:
            self.text(x + 1.6, ty, ln, size, DIM)
            ty += size + 0.5

    def wire(self, pts, color=INK, sw=0.35, dash=None):
        d = " ".join(f"{x:.2f},{y:.2f}" for x, y in pts)
        da = f' stroke-dasharray="{dash}"' if dash else ""
        self.add(f'<polyline points="{d}" fill="none" stroke="{color}" stroke-width="{sw}"{da}/>')

    def dot(self, x, y, color=INK):
        self.add(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="0.7" fill="{color}"/>')

    def frame(self):
        self.add('<rect x="5" y="5" width="410" height="287" fill="none" stroke="#111827" stroke-width="0.5"/>')
        # title block
        x, y = 290, 268
        self.add(f'<rect x="{x}" y="{y}" width="125" height="24" fill="#ffffff" stroke="#111827" stroke-width="0.4"/>')
        self.text(x + 2, y + 5.5, "Clean-room heat-recovery air-pump rig", 3.0, weight="bold")
        self.text(x + 2, y + 10.5, self.title, 2.8)
        self.text(x + 2, y + 15.5, "ESP32-S3 controller · 24 V DC · pin map = firmware/include/config.h", 2.1, DIM)
        self.text(x + 2, y + 20.5, f"Sheet {self.number} of 2 · A3 · Eng. Kariem Moussa · GIU", 2.1, DIM)

    def svg(self):
        head = (f'<svg xmlns="http://www.w3.org/2000/svg" width="420mm" height="297mm" viewBox="0 0 420 297" '
                f'font-family="{FONT}"><rect width="420" height="297" fill="#ffffff"/>')
        return head + "".join(self.e) + "</svg>\n"


def legend(s, x, y):
    items = [(C_PWR, "24 V / 5 V supply"), (C_GND, "0 V"), (C_IN, "sensor signal (to ESP32)"),
             (C_OUT, "drive signal (from ESP32)"), (C_BUS, "I²C / 1-Wire / UART bus")]
    s.text(x, y, "Legend", 2.6, weight="bold")
    for i, (c, t) in enumerate(items):
        yy = y + 4 + i * 4
        s.wire([(x, yy - 0.8), (x + 8, yy - 0.8)], c, 0.6)
        s.text(x + 10, yy, t, 2.2, DIM)


# ------------------------------------------------------------------ sheet 1: power
def sheet_power():
    s = Sheet("Sheet 1 · Power distribution, fusing and current sensing", 1)
    s.frame()
    s.text(10, 13, "POWER DISTRIBUTION", 4.2, weight="bold")
    s.text(10, 18.5, "All loads run from one 24 V DC supply. Each branch has its own fuse; the three ACS712 current sensors measure the "
                     "compressor, fan and heater branches (CT-101 … 103). The controls branch is not on a CT (≈3.5 W, added in firmware).", 2.4, DIM)
    # mains + PSU
    s.box(10, 40, 34, 22, "Mains 230 V AC", ["L, N, PE", "IEC inlet + switch", "fuse 2 A T"], "#f9fafb")
    s.wire([(44, 51), (54, 51)], C_PWR, 0.6)
    s.box(54, 38, 40, 28, "PSU 24 V DC, 150 W", ["6.25 A, enclosed", "e.g. 150 W DIN/chassis", "PE to the rig frame"], "#fef2f2", C_PWR)
    s.wire([(94, 48), (104, 48)], C_PWR, 0.7)
    s.box(104, 41, 30, 14, "Input protection", ["TVS SMBJ28A", "470 µF 35 V bulk"], "#ffffff")
    s.wire([(134, 48), (142, 48)], C_PWR, 0.7)
    s.box(142, 42, 16, 12, "F1 8 A", ["main fuse"], "#fff7ed", C_PWR)
    s.wire([(158, 48), (170, 48), (170, 240)], C_PWR, 1.0)
    s.text(171.5, 46, "+24 V BUS", 2.6, C_PWR, weight="bold")
    s.wire([(94, 58), (100, 58), (100, 226), (150, 226)], C_GND, 0.8)
    s.wire([(150, 223), (150, 229)], C_GND, 0.8); s.wire([(152, 224.5), (152, 227.5)], C_GND, 0.6); s.wire([(154, 225.5), (154, 226.5)], C_GND, 0.5)
    s.text(102, 223.5, "0 V star point (PSU −): one return wire per branch", 2.2, DIM)

    branches = [
        (70, "F2 3 A T", "CT-101", "ACS712-05B · GPIO4", [("J6 CMP-101 compressor driver", ["24 V, 0 V, SPEED 0–5 V (from LM358)", "≈35 W; driver limits the start current"])]),
        (110, "F3 3.15 A", "CT-103", "ACS712-05B · GPIO6", [("J9 HTR-101 PTC 30 W", ["24 V → thermal fuse 130 °C → PTC → MOSFET (GPIO47)"]),
                                                          ("J10 HUM-101 steam humidifier 34 W", ["24 V → heater → MOSFET (GPIO48)"])]),
        (160, "F4 2 A", "CT-102", "ACS712-05B · GPIO5", [("J2 FAN-101 · J3 FAN-102 · J4 FAN-103/103B", ["J4 24 V via DV-101 end switch (NO FAN-103, NC FAN-103B)", "J5 DV-101 actuator 24 V (MOSFET GPIO21 + SS34)"])]),
        (205, "F5 2 A", None, "controls branch (not on a CT)", [
            ("Buck 24 → 5 V, 3 A", ["5 V: ESP32-S3 5V pin, J21 HMI 7\",", "ACS712 ×3, J20 SPS30 ×2, J24 SPS30 (PT-102)"]),
            ("24 V small loads", ["J11/J12 D6F flow ×2 · J8 DRV8825 VMOT (EEV)", "J7 RV-101 4-way valve coil (MOSFET GPIO42 + SS34)"]),
            ("3.3 V from the ESP32-S3 regulator", ["TCA9548A, SHT31 ×3, SDP810 ×2, DS18B20 ×5,", "pull-ups (≈ 60 mA)"])]),
    ]
    for y, fuse, ct, ctnote, loads in branches:
        s.dot(170, y)
        s.wire([(170, y), (182, y)], C_PWR, 0.7)
        s.box(182, y - 6, 18, 12, fuse, [], "#fff7ed", C_PWR)
        x = 200
        if ct:
            s.wire([(200, y), (210, y)], C_PWR, 0.7)
            s.box(210, y - 7, 34, 14, ct, [ctnote, "Hall sensor in series"], "#eff6ff", C_IN)
            x = 244
        else:
            s.text(203, y - 2, ctnote, 2.1, DIM, italic=True)
        for i, (t, lines) in enumerate(loads):
            ly = y - 6 + i * 16 if len(loads) > 1 else y - 6
            s.wire([(x, y), (x + 8, y), (x + 8, ly + 6), (262, ly + 6)], C_PWR, 0.6)
            s.box(262, ly, 118, 13, t, lines, "#ffffff", INK, 2.1, 2.4)
    # notes
    notes = [
        "Wire: PSU → board 1.0 mm²; compressor, PTC, humidifier 0.5 mm²; fans and sensors 0.14–0.25 mm² or the FR4 strips.",
        "PCB tracks (IPC-2221, 1 oz, 10 °C rise): 24 V bus ≥ 2.5 mm; compressor/PTC ≥ 1.0 mm; fans 0.4 mm; signals 0.25 mm.",
        "Inductive loads (RV coil) need a flyback diode; the PTC and the humidifier heater are resistive.",
        "MOSFET low-side switches: logic-level N-MOSFETs (AOD4184 / IRLZ44N), 100 Ω gate resistor, 100 k gate pull-down.",
        "No PCB connection to the receiver, accumulator, filter-drier, sight glass or charging ports (mechanical refrigerant parts).",
    ]
    s.text(10, 238, "Notes", 2.8, weight="bold")
    for i, n in enumerate(notes):
        s.text(10, 243 + i * 4.2, "• " + n, 2.2, DIM)
    legend(s, 10, 75)
    return s


# ------------------------------------------------------------------ sheet 2: controller I/O
def sheet_io():
    s = Sheet("Sheet 2 · Controller I/O: ESP32-S3 pins, interfaces, devices", 2)
    s.frame()
    s.text(10, 13, "CONTROLLER I/O", 4.2, weight="bold")
    s.text(10, 18.5, "ESP32-S3-DevKitC-1 on the main PCB (back wall). Inputs on the left, outputs on the right. Every device is reached by its own FR4 strip "
                     "with the connector shown (J-number). Interface parts sit on the main PCB.", 2.4, DIM)
    ex0, ex1, ey0, ey1 = 178, 246, 26, 262
    s.box(ex0, ey0, ex1 - ex0, ey1 - ey0, None, (), "#f8fafc", INK, sw=0.5)
    s.text((ex0 + ex1) / 2, ey0 + 5, "ESP32-S3-DevKitC-1", 3.2, anchor="middle", weight="bold")
    s.text((ex0 + ex1) / 2, ey0 + 9, "N8R8 · 3.3 V logic · ADC1 only", 2.1, DIM, anchor="middle")

    def lpin(y, pin, fn, color):
        s.text(ex0 + 1.5, y + 0.8, pin, 2.2, color, weight="bold")
        s.text(ex0 + 15, y + 0.8, fn, 2.0, DIM)

    def rpin(y, pin, fn, color):
        s.text(ex1 - 1.5, y + 0.8, pin, 2.2, color, anchor="end", weight="bold")
        s.text(ex1 - 15, y + 0.8, fn, 2.0, DIM, anchor="end")

    # --- I²C via the TCA9548A
    for y, pin, fn in [(40, "GPIO8", "SDA"), (47, "GPIO9", "SCL")]:
        lpin(y, pin, fn, C_BUS)
        s.wire([(ex0, y), (156, y)], C_BUS, 0.5)
    s.box(126, 29, 30, 57, "TCA9548A", ["I²C mux 0x70", "2.2 k pull-ups", "on SDA/SCL", "and on every", "channel (3.3 V)"], "#ecfdf5", C_BUS)
    chans = [("ch0", "SHT31 0x44 · TT-101 / MT-101 fresh air", "J15"), ("ch1", "SHT31 0x44 · TT-105 / MT-105 supply", "J16"),
             ("ch2", "SDP810-125Pa 0x25 · PDT-101 room ΔP", "J17"), ("ch3", "SDP810-500Pa 0x25 · PDT-102 HEPA ΔP", "J18"),
             ("ch4", "SHT31 0x44 · TT-106 / MT-106 room", "J19"), ("ch5", "SPS30 0x69 (5 V) · PT-101 room particles", "J20"),
             ("ch6", "SPS30 0x69 (5 V) · PT-101A fill-point particles", "J20"), ("ch7", "SPS30 0x69 (5 V) · PT-102 exhaust particles", "J24")]
    for i, (ch, dev, j) in enumerate(chans):
        y = 32 + i * 7
        s.wire([(126, y), (112, y)], C_BUS, 0.4)
        s.text(124, y - 0.6, ch, 1.9, C_BUS, anchor="end")
        s.box(12, y - 2.8, 100, 5.6, None, (), "#ffffff", LINE, sw=0.25)
        s.text(13.5, y + 0.8, f"{dev}", 2.0, INK)
        s.text(110.5, y + 0.8, j, 2.0, C_BUS, anchor="end", weight="bold")
    s.text(12, 89.5, "Each channel: 3.3 V (5 V for SPS30), 0 V, SDAx, SCLx. SPS30 SEL pin → 0 V (I²C mode).", 2.0, DIM, italic=True)

    left = [
        (95, "GPIO15", "1-Wire A", C_BUS, "4.7 k to 3.3 V", "TT-109 off Cu core, TT-103 pre-heat, TT-104 coil · DS18B20 ×3", "J13"),
        (107, "GPIO16", "1-Wire B", C_BUS, "4.7 k to 3.3 V", "TT-107 exhaust in, TT-108 exhaust out · DS18B20 ×2", "J14"),
        (119, "GPIO1", "ADC1_CH0", C_IN, "direct 0.5–2.5 V", "FT-101 fresh-air flow · Omron D6F-W04A1 (24 V supply)", "J11"),
        (131, "GPIO2", "ADC1_CH1", C_IN, "direct 0.5–2.5 V", "FT-102 supply flow · Omron D6F-W04A1 (24 V supply)", "J12"),
        (143, "GPIO4", "ADC1_CH3", C_IN, "10 k / 20 k", "CT-101 compressor current · ACS712-05B (5 V)", "PCB"),
        (155, "GPIO5", "ADC1_CH4", C_IN, "10 k / 20 k", "CT-102 fan current · ACS712-05B (5 V)", "PCB"),
        (167, "GPIO6", "ADC1_CH5", C_IN, "10 k / 20 k", "CT-103 PTC + humidifier current · ACS712-05B", "PCB"),
        (179, "GPIO7", "ADC1_CH6", C_IN, "100 k / 10 k", "VT-101 24 V bus voltage", "PCB"),
        (191, "GPIO10", "tach", C_IN, "10 k to 3.3 V", "FAN-101 tach (open collector, 2 pulses/rev)", "J2.4"),
        (203, "GPIO11", "tach", C_IN, "10 k to 3.3 V", "FAN-102 tach", "J3.4"),
        (215, "GPIO12", "tach", C_IN, "10 k to 3.3 V", "FAN-103 / 103B tach (running fan)", "J4.4"),
    ]
    for y, pin, fn, col, iface, dev, j in left:
        lpin(y, pin, fn, col)
        s.wire([(ex0, y), (112, y)], col, 0.5)
        s.box(140, y - 3, 30, 6, None, (), "#fffbeb", LINE, sw=0.25)
        s.text(155, y + 0.8, iface, 1.9, INK, anchor="middle")
        s.box(12, y - 3.5, 100, 7, None, (), "#ffffff", LINE, sw=0.25)
        s.text(13.5, y + 0.9, dev, 2.0, INK)
        s.text(110.5, y + 0.9, j, 2.0, col, anchor="end", weight="bold")
    # power pins
    for i, (pin, fn, col) in enumerate([("5V", "from buck 24→5 V", C_PWR), ("3V3", "out, ≤ 300 mA", C_PWR), ("GND", "0 V star", C_GND)]):
        y = 232 + i * 8
        lpin(y, pin, fn, col)
        s.wire([(ex0, y), (150, y)], col, 0.5)
    s.text(12, 234, "5 V → HMI, ACS712 ×3, SPS30 ×3", 2.0, DIM)
    s.text(12, 242, "3.3 V → TCA9548A, SHT31 ×3, SDP810 ×2, DS18B20 ×5, pull-ups", 2.0, DIM)
    s.text(12, 250, "0 V → common; ADC reference ground at the board", 2.0, DIM)

    right = [
        (40, "GPIO38", "PWM 25 kHz", C_OUT, "AO3400 open drain", "FAN-101 fresh-air compressor (24 V blower, PWM in)", "J2"),
        (56, "GPIO39", "PWM 25 kHz", C_OUT, "AO3400 open drain", "FAN-102 supply fan", "J3"),
        (72, "GPIO40", "PWM 25 kHz", C_OUT, "AO3400 open drain", "FAN-103 / FAN-103B exhaust (PWM in parallel)", "J4"),
        (88, "GPIO21", "digital", C_OUT, "MOSFET + SS34 flyback", "DV-101 diverter, 24 V spring return (high = air pump)", "J5"),
        (104, "GPIO41", "PWM 20 kHz", C_OUT, "RC 10 k/1 µF → LM358 ×1.5", "CMP-101 compressor driver SPEED 0–5 V", "J6"),
        (120, "GPIO42", "digital", C_OUT, "MOSFET + SS34 flyback", "RV-101 4-way valve coil 24 V (high = cooling)", "J7"),
        (136, "GPIO13", "STEP", C_OUT, "DRV8825 (VMOT 24 V)", "EEV-101 bipolar stepper: A1 A2 B1 B2", "J8"),
        (152, "GPIO14", "DIR", C_OUT, "DRV8825 EN→0V, SLP/RST→3V3", "(Vref = I_coil × 0.5 Ω)", ""),
        (168, "GPIO47", "PWM 1 kHz", C_OUT, "AOD4184 low side", "HTR-101 PTC reheat 30 W + 130 °C thermal fuse", "J9"),
        (184, "GPIO48", "PWM 1 kHz", C_OUT, "AOD4184 low side", "HUM-101 steam humidifier heater 34 W", "J10"),
        (200, "GPIO17", "UART1 TX", C_BUS, "direct (3.3 V)", "HMI-101 RX · 7\" serial HMI, 115200 8N1 (5 V)", "J21"),
        (216, "GPIO18", "UART1 RX", C_BUS, "1 k series", "HMI-101 TX", "J21"),
    ]
    for y, pin, fn, col, iface, dev, j in right:
        rpin(y, pin, fn, col)
        s.wire([(ex1, y), (300, y)], col, 0.5)
        s.box(254, y - 3, 42, 6, None, (), "#fffbeb", LINE, sw=0.25)
        s.text(275, y + 0.8, iface, 1.9, INK, anchor="middle")
        if dev:
            s.box(300, y - 3.5, 110, 7, None, (), "#ffffff", LINE, sw=0.25)
            s.text(301.5, y + 0.9, dev, 2.0, INK)
            s.text(408.5, y + 0.9, j, 2.0, col, anchor="end", weight="bold")
    s.text(300, 228, "USB-C (native USB): flashing + JSON telemetry to the laptop (Live monitor).", 2.1, DIM)
    s.text(300, 233, "Spare: GPIO3/45/46 are strapping pins; GPIO35–37 used by octal PSRAM; leave free.", 2.1, DIM)
    s.text(300, 238, "Compressor speed: 0–3.3 V PWM → RC (fc 16 Hz) → LM358 gain 1 + 5.1k/10k = 1.51 → 0–5 V.", 2.1, DIM)
    s.text(300, 243, "Fans: open-drain inverts PWM (firmware FAN_PWM_INVERTED = true).", 2.1, DIM)
    legend(s, 12, 262)
    return s


def main():
    os.makedirs(OUT, exist_ok=True)
    for s, name in [(sheet_power(), "03-wiring-power.svg"), (sheet_io(), "03-wiring-controller.svg")]:
        with open(os.path.join(OUT, name), "w") as f:
            f.write(s.svg())
        print("wrote build-pack/" + name)


if __name__ == "__main__":
    main()
