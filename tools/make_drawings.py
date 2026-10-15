"""Fabrication drawing of the acrylic enclosure (A3, scale 1:6) + panel cut list.

All positions come from the simulator's geometry (assets/js/rig.js), converted to mm.
Box coordinates: x along the 1000 mm length (partition at x = 0, plant room x < 0),
y up from the floor, z across (front face at z = +250).

Usage:  python tools/make_drawings.py            → cad/drawings/enclosure-GA.svg
"""
import os

T = 5.0  # acrylic thickness, mm

# panel: name, qty, size A × B, plane, cut-outs [(kind, u, v, w, h, note)] in the panel's own view coords
PANELS = [
    ("Base plate", 1, (1000, 500), "x-z", []),
    ("Roof", 1, (1000, 500), "x-z", [
        ("rect", -75, 100, 22, 16, "common exhaust stack 22 × 16 (front-right, away from the fresh-air intake)"),
    ]),
    ("Front wall", 1, (1000, 490), "x-y", [
        ("rect", 390, 200, 160, 320, "door opening (door panel 180 × 340)"),
        ("rect", 110, 175, 102, 102, "pass box opening 102 × 102"),
        ("hole", -440, 385, 4.5, 0, "HMI standoff M4"), ("hole", -320, 385, 4.5, 0, ""),
        ("hole", -440, 445, 4.5, 0, ""), ("hole", -320, 445, 4.5, 0, ""),
        ("rect", -380, 456, 14, 4, "HMI ribbon slot"),
    ]),
    ("Back wall", 1, (1000, 490), "x-y", [
        ("hole", -294, 276, 3.4, 0, "PCB standoff M3"), ("hole", -126, 276, 3.4, 0, ""),
        ("hole", -294, 384, 3.4, 0, ""), ("hole", -126, 384, 3.4, 0, ""),
        ("hole", 425, 200, 3.4, 0, "MT-106 sensor M3"), ("hole", 455, 200, 3.4, 0, ""),
        ("rect", -17.5, 110, 19, 13.5, "exhaust collector C into the plant room 19 × 13.5"),
    ]),
    ("Left wall (outdoor side)", 1, (490, 490), "z-y", [
        ("hole", -140, 220, 38, 0, "fresh-air compressor intake Ø38"),
        ("hole", -200, 21, 8, 0, "24 V supply cable gland Ø8"),
        ("hole", -178, 200, 4.5, 0, "compressor bracket M4"), ("hole", -138, 200, 4.5, 0, ""),
    ]),
    ("Right wall", 1, (490, 490), "z-y", [
        ("rect", -10, 41.5, 70, 54, "exhaust terminal 3 (H14 BIBO, behind the operator) 70 × 54"),
    ]),
    ("Partition wall", 1, (490, 490), "z-y", [
        ("rect", 85, 445, 31, 22, "supply duct 31 × 22"),
        ("rect", 30, 69, 70, 54, "exhaust terminal 1 (H14 BIBO) 70 × 54"),
        ("rect", -130, 69, 70, 54, "exhaust terminal 2 (H14 BIBO) 70 × 54"),
        ("hole", -190, 308, 4, 0, "PDT-101 reference tube Ø4"),
        ("rect", -103, 8, 20, 4, "PCB harness slot (floor)"),
    ]),
    ("Clean-room false ceiling", 1, (492.5, 490), "x-z", [
        ("rect", 140, 0, 86, 86, "ceiling H14 BIBO terminal 86 × 86"),
        ("rect", 305, -40, 24, 17, "LAF supply drop 24 × 17"), ("rect", 445, -52, 72, 72, "ceiling H14 BIBO terminal 2 72 × 72"), ("rect", 445, 32, 72, 72, "ceiling H14 BIBO terminal 3 72 × 72"),
        ("hole", 266, -144, 4, 0, "LAF hanger Ø4"), ("hole", 344, -144, 4, 0, ""), ("hole", 266, 64, 4, 0, ""), ("hole", 344, 64, 4, 0, ""),
        ("hole", 240, -150, 6, 0, "luminaire cable Ø6"),
    ]),
    ("Clean-room door", 1, (220, 340), "x-y", []),
]

S = 1 / 6  # 1:6 on paper (mm per mm)
LEGEND = {}
INK, DIM, CUT, MUTED = "#121c26", "#1273cc", "#c6302f", "#5d6e7e"


def svg_open(w, h):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}mm" height="{h}mm" viewBox="0 0 {w} {h}" '
            f'font-family="IBM Plex Mono, DejaVu Sans Mono, monospace">',
            f'<rect x="0" y="0" width="{w}" height="{h}" fill="#ffffff"/>',
            '<defs><marker id="a" viewBox="0 0 6 6" refX="3" refY="3" markerWidth="2.4" markerHeight="2.4" orient="auto-start-reverse">'
            f'<path d="M0 0L6 3L0 6z" fill="{DIM}"/></marker></defs>']


def text(x, y, s, size=2.6, anchor="start", color=INK, weight=400, rot=0):
    tr = f' transform="rotate({rot} {x:.2f} {y:.2f})"' if rot else ""
    return (f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" text-anchor="{anchor}" fill="{color}" '
            f'font-weight="{weight}"{tr}>{s}</text>')


def dim_h(x1, x2, y, label, off=6):
    yy = y + off
    return [f'<line x1="{x1:.2f}" y1="{y:.2f}" x2="{x1:.2f}" y2="{yy + 1:.2f}" stroke="{DIM}" stroke-width="0.15"/>',
            f'<line x1="{x2:.2f}" y1="{y:.2f}" x2="{x2:.2f}" y2="{yy + 1:.2f}" stroke="{DIM}" stroke-width="0.15"/>',
            f'<line x1="{x1:.2f}" y1="{yy:.2f}" x2="{x2:.2f}" y2="{yy:.2f}" stroke="{DIM}" stroke-width="0.2" '
            'marker-start="url(#a)" marker-end="url(#a)"/>',
            text((x1 + x2) / 2, yy - 1, label, 2.4, "middle", DIM)]


def dim_v(x, y1, y2, label, off=6):
    xx = x - off
    return [f'<line x1="{x:.2f}" y1="{y1:.2f}" x2="{xx - 1:.2f}" y2="{y1:.2f}" stroke="{DIM}" stroke-width="0.15"/>',
            f'<line x1="{x:.2f}" y1="{y2:.2f}" x2="{xx - 1:.2f}" y2="{y2:.2f}" stroke="{DIM}" stroke-width="0.15"/>',
            f'<line x1="{xx:.2f}" y1="{y1:.2f}" x2="{xx:.2f}" y2="{y2:.2f}" stroke="{DIM}" stroke-width="0.2" '
            'marker-start="url(#a)" marker-end="url(#a)"/>',
            text(xx - 1, (y1 + y2) / 2, label, 2.4, "middle", DIM, rot=-90)]


def panel_view(ox, oy, panel, u0, v0, title, flip_u=False):
    """draw one panel at paper origin (ox, oy) = its top-left; u0, v0 = model coords of that corner"""
    name, _, (A, B), _, cuts = panel
    out = [f'<rect x="{ox:.2f}" y="{oy:.2f}" width="{A * S:.2f}" height="{B * S:.2f}" fill="#eaf5fb" '
           f'stroke="{INK}" stroke-width="0.35"/>', text(ox, oy - 2.2, title, 3.0, weight=600)]

    def P(u, v):
        uu = (u0 - u) if flip_u else (u - u0)
        return ox + uu * S, oy + (v0 - v) * S

    last = ""
    for n, (kind, u, v, w, h, note) in enumerate(cuts, 1):
        x, y = P(u, v)
        if kind == "hole":
            out.append(f'<circle cx="{x:.2f}" cy="{y:.2f}" r="{max(w * S / 2, 0.35):.2f}" fill="none" stroke="{CUT}" stroke-width="0.3"/>')
        else:
            out.append(f'<rect x="{x - w * S / 2:.2f}" y="{y - h * S / 2:.2f}" width="{w * S:.2f}" height="{h * S:.2f}" '
                       f'fill="none" stroke="{CUT}" stroke-width="0.3"/>')
        out.append(text(x + 1.4, y - 1.2, str(n), 2.0, color=CUT, weight=600))
        last = note or last + ("" if last.endswith("(same)") else " (same)")
        ul = (u0 - u) if flip_u else (u - u0)
        vb = v - (v0 - B)
        LEGEND.setdefault(name, []).append(f"{n}  {last}  @ {ul:g} from left, {vb:g} from bottom")
    out += dim_h(ox, ox + A * S, oy + B * S, f"{A:g}", 5)
    out += dim_v(ox, oy, oy + B * S, f"{B:g}", 5)
    return out


def main(outdir="cad/drawings"):
    os.makedirs(outdir, exist_ok=True)
    W, H = 594, 420                                    # A2 landscape, so every panel with a cut-out fits at 1:6
    s = svg_open(W, H)
    s.append(f'<rect x="8" y="8" width="{W - 16}" height="{H - 16}" fill="none" stroke="{INK}" stroke-width="0.5"/>')
    by = {p[0]: p for p in PANELS}
    g = 22
    c1 = 24
    c2 = c1 + 1000 * S + g
    c3 = c2 + 490 * S + g
    c4 = c3 + 490 * S + g
    r1, r2 = 30, 140
    s += panel_view(c1, r1, by["Front wall"], -500, 495, "FRONT WALL — seen from the front")
    s += panel_view(c2, r1, by["Left wall (outdoor side)"], -245, 495, "LEFT WALL — outdoor side")
    s += panel_view(c3, r1, by["Partition wall"], 245, 495, "PARTITION — from the clean room", flip_u=True)
    s += panel_view(c4, r1, by["Right wall"], 245, 495, "RIGHT WALL — seen from outside", flip_u=True)
    s += panel_view(c1, r2, by["Back wall"], -500, 495, "BACK WALL — seen from inside")
    s += panel_view(c2, r2, by["Clean-room false ceiling"], 2.5, 245, "FALSE CEILING — from below")
    s += panel_view(c2 + 492.5 * S + g, r2, by["Roof"], -500, 250, "ROOF — from above, front edge at the top")

    # cut-out legend with positions (centre of each hole / opening, as seen in the view)
    s.append(text(24, 252, "CUT-OUTS — centre positions in mm, measured in each view from its left and bottom edges", 2.8, weight=600))
    for k, (name, lines) in enumerate(LEGEND.items()):
        x0, y0 = 24 + (k % 4) * 140, 260 + (k // 4) * 36
        s.append(text(x0, y0, name, 2.4, weight=600))
        for i, ln in enumerate(lines):
            s.append(text(x0 + 1.5, y0 + 3.2 * (i + 1), ln, 2.0, color=MUTED))

    # cut list as a table
    tx, ty = W - 12 - 88, r2                           # right of the roof view, inside the frame
    s.append(text(tx, ty - 2.2, "ACRYLIC CUT LIST — 5 mm cast PMMA", 3.0, weight=600))
    s.append(f'<line x1="{tx}" y1="{ty + 2}" x2="{tx + 88}" y2="{ty + 2}" stroke="{MUTED}" stroke-width="0.2"/>')
    s.append(text(tx, ty + 1, "Panel", 2.2, color=MUTED)); s.append(text(tx + 56, ty + 1, "Qty", 2.2, color=MUTED))
    s.append(text(tx + 88, ty + 1, "Size (mm)", 2.2, "end", MUTED))
    for i, (name, q, (a_, b_), _, _) in enumerate(PANELS):
        y = ty + 6 + i * 4.2
        s.append(text(tx, y, name, 2.3)); s.append(text(tx + 58, y, str(q), 2.3, "middle"))
        s.append(text(tx + 88, y, f"{a_:g} × {b_:g}", 2.3, "end"))
    y = ty + 6 + len(PANELS) * 4.2 + 3
    for line in ["Base and roof are full size; front and back sit",
                 "between them; the two ends and the partition sit",
                 "between front and back. Solvent-weld (or acrylic",
                 "cement) all joints; seal duct sleeves with EPDM."]:
        s.append(text(tx, y, line, 2.1, color=MUTED)); y += 3.2

    # title block
    s.append(f'<rect x="{W - 150}" y="{H - 34}" width="142" height="26" fill="none" stroke="{INK}" stroke-width="0.4"/>')
    s.append(text(W - 146, H - 27, "CLEAN-ROOM HEAT-RECOVERY AIR-PUMP TEST RIG", 2.8, weight=600))
    s.append(text(W - 146, H - 22, "Acrylic enclosure 1000 × 500 × 500 mm — general arrangement", 2.3))
    s.append(text(W - 146, H - 17, "Scale 1:6 on A2 · dimensions in mm · 3D: cad/cleanroom-rig-assembly.step / .dwg", 2.1, color=MUTED))
    s.append(text(W - 146, H - 12.4, "Eng. Kariem Moussa · supervised by Dr. Eng. Ahmed Maher · GIU", 2.1, color=MUTED))
    s.append("</svg>")
    path = os.path.join(outdir, "enclosure-GA.svg")
    open(path, "w").write("\n".join(s))
    print("wrote", path)


if __name__ == "__main__":
    main()
