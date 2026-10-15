"""Build the SolidWorks-ready STEP model of the clean-room test rig.

The 3D simulator is the single source of geometry: tools/export_geometry.js opens
index.html in headless Chromium and dumps every solid (box, cylinder, cone, torus,
plane, swept duct) with its world transform, part name, sub-assembly and colour.
This script rebuilds each one as an exact B-rep solid with CadQuery / OpenCascade,
groups them into named parts and sub-assemblies, and writes:

  cad/cleanroom-rig-assembly.step     the whole rig (AP214, mm, names + colours)
  cad/step/<sub-assembly>.step        one file per sub-assembly
  cad/BOM.csv                          part list with sizes, materials and body counts

Usage:  python tools/build_cad.py cad/rig-geometry.json
Units:  the simulator works in centimetres; everything here is written in millimetres.
"""
import csv
import json
import math
import os
import re
import sys
from collections import OrderedDict, defaultdict

import cadquery as cq
from OCP.gp import gp_Quaternion, gp_Trsf, gp_Vec

MM = 10.0  # cm → mm

ASM_ORDER = [
    "Acrylic enclosure",
    "AHU",
    "Heat-recovery air-pump unit",
    "Fresh-air compressor",
    "Ductwork",
    "Clean room",
    "Exhaust safety: PT-102 + DV-101 + outer HEPA",
    "Controls and HMI",
    "PCB wiring harness",
]


def ascii_name(s):
    table = {"·": "-", "→": "to", "⇄": "-", "²": "2", "³": "3", "₂": "2", "Δ": "d", "×": "x",
             "°": "deg", "–": "-", "—": "-", "+": "plus", "/": "-", "&": "and"}
    for k, v in table.items():
        s = s.replace(k, v)
    s = re.sub(r"[^A-Za-z0-9 _\-.()]", "", s)
    s = re.sub(r"\s+", " ", s).strip()
    return s or "Part"


def rotate(q, v):
    """rotate vector v by quaternion q = (x, y, z, w)"""
    x, y, z, w = q
    vx, vy, vz = v
    # t = 2 * cross(q.xyz, v)
    tx, ty, tz = 2 * (y * vz - z * vy), 2 * (z * vx - x * vz), 2 * (x * vy - y * vx)
    return (vx + w * tx + (y * tz - z * ty),
            vy + w * ty + (z * tx - x * tz),
            vz + w * tz + (x * ty - y * tx))


def location(rec):
    t = gp_Trsf()
    qx, qy, qz, qw = rec["quat"]
    t.SetRotation(gp_Quaternion(qx, qy, qz, qw))
    px, py, pz = rec["pos"]
    t.SetTranslationPart(gp_Vec(px * MM, py * MM, pz * MM))
    return cq.Location(t)


def shell_cone(rb, rt, h, wall):
    outer = cq.Solid.makeCone(rb, rt, h, cq.Vector(0, -h / 2, 0), cq.Vector(0, 1, 0)) if rb != rt else \
        cq.Solid.makeCylinder(rb, h, cq.Vector(0, -h / 2, 0), cq.Vector(0, 1, 0))
    ib, it = max(rb - wall, 0.05), max(rt - wall, 0.05)
    inner = cq.Solid.makeCone(ib, it, h * 1.02, cq.Vector(0, -h * 0.51, 0), cq.Vector(0, 1, 0)) if ib != it else \
        cq.Solid.makeCylinder(ib, h * 1.02, cq.Vector(0, -h * 0.51, 0), cq.Vector(0, 1, 0))
    return outer.cut(inner)


def primitive(rec):
    """the solid in its local frame (mm), or None if the type is not handled"""
    g, p = rec["geo"], rec["geo"]["p"]
    sx, sy, sz = rec["scl"]
    t = g["t"]
    round_ = t in ("CylinderGeometry", "ConeGeometry", "TorusGeometry", "SphereGeometry")
    if round_ and (abs(sx - sz) > 1e-6 or (t in ("SphereGeometry", "TorusGeometry") and abs(sx - sy) > 1e-6)):
        # stretched round shapes (e.g. the operator's ellipsoid body parts): build at unit scale,
        # then apply the exact non-uniform scale as a general transform
        unit = dict(rec, scl=[1.0, 1.0, 1.0])
        base = primitive(unit)
        return base.transformGeometry(cq.Matrix([[sx, 0, 0, 0], [0, sy, 0, 0], [0, 0, sz, 0]]))
    if t == "BoxGeometry":
        w, h, d = p["width"] * sx * MM, p["height"] * sy * MM, p["depth"] * sz * MM
        return cq.Solid.makeBox(w, h, d, cq.Vector(-w / 2, -h / 2, -d / 2))
    if t == "PlaneGeometry":
        w, h, d = p["width"] * sx * MM, p["height"] * sy * MM, 0.5
        return cq.Solid.makeBox(w, h, d, cq.Vector(-w / 2, -h / 2, -d / 2))
    if t in ("CylinderGeometry", "ConeGeometry"):
        if t == "ConeGeometry":
            rt, rb = 0.0, p["radius"]
        else:
            rt, rb = p["radiusTop"], p["radiusBottom"]
        rt, rb, h = rt * sx * MM, rb * sx * MM, p["height"] * sy * MM
        if p.get("openEnded"):
            return shell_cone(rb, rt, h, max(0.6, 0.06 * max(rb, rt)))
        if abs(rt - rb) < 1e-6:
            return cq.Solid.makeCylinder(rb, h, cq.Vector(0, -h / 2, 0), cq.Vector(0, 1, 0))
        return cq.Solid.makeCone(rb, rt, h, cq.Vector(0, -h / 2, 0), cq.Vector(0, 1, 0))
    if t == "TorusGeometry":
        return cq.Solid.makeTorus(p["radius"] * sx * MM, p["tube"] * sx * MM, cq.Vector(0, 0, 0), cq.Vector(0, 0, 1))
    if t == "SphereGeometry":
        return cq.Solid.makeSphere(p["radius"] * sx * MM, cq.Vector(0, 0, 0), cq.Vector(0, 1, 0), -90, 90, 360)
    return None


def rect_section(rec):
    """a rectangular duct section: a hollow box (2 mm wall at rig scale) in its local frame"""
    p, (sx, sy, sz) = rec["geo"]["p"], rec["scl"]
    w, h, d = p["width"] * sx * MM, p["height"] * sy * MM, p["depth"] * sz * MM
    t = rec["geo"]["cad"].get("wall", 0.15) * MM
    o = cq.Solid.makeBox(w, h, d, cq.Vector(-w / 2, -h / 2, -d / 2))
    i = cq.Solid.makeBox(max(w - 2 * t, 0.2), max(h - 2 * t, 0.2), d + 0.4, cq.Vector(-(w - 2 * t) / 2, -(h - 2 * t) / 2, -d / 2 - 0.2))
    return o.cut(i)


def swept(rec):
    """ducts and refrigerant pipes: a circle (or ring) swept along the exported centre line,
    built directly in world coordinates (mm)"""
    cad = rec["geo"]["cad"]
    sx, sy, sz = rec["scl"]
    pos = rec["pos"]
    pts = []
    for (x, y, z) in cad["pts"]:
        rx, ry, rz = rotate(rec["quat"], (x * sx, y * sy, z * sz))
        v = cq.Vector((rx + pos[0]) * MM, (ry + pos[1]) * MM, (rz + pos[2]) * MM)
        if not pts or (v - pts[-1]).Length > 0.05:
            pts.append(v)
    r = cad["r"] * sx * MM
    wall = cad.get("wall")
    path = cq.Wire.assembleEdges([cq.Edge.makeSpline(pts)])
    tan = (pts[1] - pts[0]).normalized()
    plane = cq.Plane(origin=pts[0], xDir=tan.cross(cq.Vector(0, 1, 0)) if abs(tan.y) < 0.95 else tan.cross(cq.Vector(1, 0, 0)), normal=tan)
    wp = cq.Workplane(plane).circle(r)
    if wall:
        wp = wp.circle(max(r - wall * MM, 0.2))
    return wp.sweep(cq.Workplane().add(path), transition="round").val()


def duct_solids(rec):
    """a rig duct: straight hollow tubes joined by bends that are tangent arcs, rebuilt from the
    corner points the simulator used (the same rounding rule as roundedPath() in rig.js)"""
    cad = rec["geo"]["cad"]
    sx = rec["scl"][0]
    pos = rec["pos"]

    def w(p):
        x, y, z = rotate(rec["quat"], (p[0] * sx, p[1] * sx, p[2] * sx))
        return cq.Vector((x + pos[0]) * MM, (y + pos[1]) * MM, (z + pos[2]) * MM)

    v = [w(p) for p in cad["pts"]]
    r, wall, bend = cad["r"] * sx * MM, cad["wall"] * MM, cad["bend"] * sx * MM
    ri = max(r - wall, 0.2)
    out, cur = [], v[0]

    def tube(a, b):
        d = b - a
        L = d.Length
        if L < 0.05:
            return
        n = d.normalized()
        o = cq.Solid.makeCylinder(r, L, a, n)
        i = cq.Solid.makeCylinder(ri, L + 0.2, a - n * 0.1, n)
        out.append(o.cut(i))

    def ring(at, normal):
        xd = normal.cross(cq.Vector(0, 1, 0)) if abs(normal.y) < 0.95 else normal.cross(cq.Vector(1, 0, 0))
        return cq.Workplane(cq.Plane(origin=at, xDir=xd, normal=normal)).circle(r).circle(ri)

    for k in range(1, len(v)):
        a, b = v[k - 1], v[k]
        c = v[k + 1] if k + 1 < len(v) else None
        if c is None:
            tube(cur, b)
            break
        d1, d2 = (b - a), (c - b)
        rc = min(bend, d1.Length * 0.45, d2.Length * 0.45)
        n1, n2 = d1.normalized(), d2.normalized()
        if n1.cross(n2).Length < 1e-4:          # straight through
            continue
        p1, p2 = b - n1 * rc, b + n2 * rc
        tube(cur, p1)
        arc = cq.Edge.makeTangentArc(p1, n1, p2)
        out.append(ring(p1, n1).sweep(cq.Workplane().add(cq.Wire.assembleEdges([arc]))).val())
        cur = p2
    return out


def build_tree(data):
    """every exported primitive as an exact solid, grouped: sub-assembly → part → colour → solids"""
    tree = OrderedDict((a, OrderedDict()) for a in ASM_ORDER)
    fails = []
    for rec in data:
        asm = rec["asm"] if rec["asm"] in tree else "Controls and HMI"
        part = rec["part"]
        if part == "HMI-101 display":
            rec["mat"] = {"c": [0.05, 0.08, 0.11], "o": 1}
        try:
            if rec["geo"].get("cad", {}).get("type") == "duct":
                col = tuple(round(c, 2) for c in rec["mat"]["c"]) + (max(0.25, rec["mat"]["o"]),)
                tree[asm].setdefault(part, OrderedDict()).setdefault(col, []).extend(duct_solids(rec))
                continue
            if rec["geo"].get("cad", {}).get("type") == "rseg":
                solid = rect_section(rec).moved(location(rec))
            elif rec["geo"].get("cad"):
                solid = swept(rec)
            else:
                prim = primitive(rec)
                if prim is None:
                    fails.append((part, rec["geo"]["t"], "unsupported"))
                    continue
                solid = prim.moved(location(rec))
        except Exception as e:  # keep going; report at the end
            fails.append((part, rec["geo"]["t"], str(e)[:80]))
            continue
        col = tuple(round(c, 2) for c in rec["mat"]["c"]) + (max(0.25, rec["mat"]["o"]),)
        tree[asm].setdefault(part, OrderedDict()).setdefault(col, []).append(solid)
    return tree, fails


def main(src, outdir="cad"):
    data = json.load(open(src))
    os.makedirs(os.path.join(outdir, "step"), exist_ok=True)
    tree, fails = build_tree(data)
    print("solids built", flush=True)
    root = cq.Assembly(name="Cleanroom_HR_AirPump_Rig")
    bom = []
    for asm, parts in tree.items():
        if not parts:
            continue
        sub = cq.Assembly(name=ascii_name(asm))
        used = set()
        for part, cols in parts.items():
            for i, (col, solids) in enumerate(cols.items()):
                name = ascii_name(part) + ("" if i == 0 else " -" + str(i + 1))
                base, n = name, 2
                while name in used:
                    name = "%s (%d)" % (base, n)
                    n += 1
                used.add(name)
                comp = cq.Compound.makeCompound(solids)
                sub.add(comp, name=name, color=cq.Color(*col))
                bb = comp.BoundingBox()
                bom.append([ascii_name(asm), name, len(solids), round(bb.xlen, 1), round(bb.ylen, 1), round(bb.zlen, 1),
                            material(part, col)])
        sub.export(os.path.join(outdir, "step", ascii_name(asm).replace(" ", "_") + ".step"))
        print("  wrote", asm, flush=True)
        root.add(sub, name=ascii_name(asm))
    root.export(os.path.join(outdir, "cleanroom-rig-assembly.step"))

    with open(os.path.join(outdir, "BOM.csv"), "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["Sub-assembly", "Part", "Bodies", "X (mm)", "Y (mm)", "Z (mm)", "Material / finish"])
        w.writerows(bom)

    # one STEP per part (with its colours), then the 2D views + DXF for every part, sub-assembly and the whole rig
    import cad_2d
    sheets = []
    for asm, parts in tree.items():
        if not parts:
            continue
        adir = cad_2d.safe(ascii_name(asm))
        allsolids = []
        os.makedirs(os.path.join(outdir, "parts", adir), exist_ok=True)
        for part, cols in parts.items():
            pa = cq.Assembly(name=ascii_name(part))
            solids = []
            for i, (col, sl) in enumerate(cols.items()):
                pa.add(cq.Compound.makeCompound(sl), name="body" + str(i + 1), color=cq.Color(*col))
                solids += sl
            pa.export(os.path.join(outdir, "parts", adir, cad_2d.safe(ascii_name(part)) + ".step"))
            allsolids += solids
            try:
                comp = cq.Compound.makeCompound(solids)
                cad_2d.write_dxf(os.path.join(outdir, "dxf", "parts", adir, cad_2d.safe(ascii_name(part)) + ".dxf"),
                                 ascii_name(asm) + " / " + ascii_name(part), cad_2d.layout(comp, poly=True))   # polygonal HLR: exact HLR stalls on some curved parts
            except Exception as e:  # keep going
                fails.append((part, "2D", str(e)[:80]))
        comp = cq.Compound.makeCompound(allsolids)
        placed = cad_2d.layout(comp, poly=True)
        cad_2d.write_dxf(os.path.join(outdir, "dxf", "sub-assemblies", adir + ".dxf"), "Sub-assembly: " + ascii_name(asm), placed)
        cad_2d.write_svg(os.path.join(outdir, "drawings", "views", adir + ".svg"), "Sub-assembly: " + ascii_name(asm), placed)
        sheets.append(adir)
        print("  2D", asm, flush=True)
    placed = cad_2d.layout(root.toCompound(), poly=True)
    cad_2d.write_dxf(os.path.join(outdir, "dxf", "cleanroom-rig-assembly.dxf"), "Clean-room rig: general arrangement", placed)
    cad_2d.write_svg(os.path.join(outdir, "drawings", "views", "00_cleanroom-rig-assembly.svg"), "Clean-room rig: general arrangement", placed)
    import make_drawings
    cad_2d.write_panels(make_drawings.PANELS, os.path.join(outdir, "dxf", "enclosure-panels"))
    print("  2D done", flush=True)

    total = sum(len(s) for parts in tree.values() for cols in parts.values() for s in cols.values())
    print("solids written:", total, "of", len(data), "· parts:", len(bom))
    for f_ in fails:
        print("  skipped:", f_)
    bb = root.toCompound().BoundingBox()
    print("overall size (mm): %.1f x %.1f x %.1f" % (bb.xlen, bb.ylen, bb.zlen))


def material(part, col):
    """material / finish for the BOM, matched on whole words of the part name"""
    p = part.lower()
    words = set(re.findall(r"[a-z0-9]+", p))
    if {"filler", "panel"} <= words:
        return "Filler HMI panel"
    rules = [
        (("receiver",), "Steel liquid receiver, painted, rotalock valve + level sight glass (R32)"),
        (("accumulator",), "Steel suction accumulator with U-tube, painted (R32)"),
        (("drier",), "Bi-flow filter-drier, copper shell, molecular-sieve core"),
        (("sight",), "Sight glass with moisture indicator, brass body"),
        (("charging",), "Brass service valve with Schrader charging port and cap"),
        (("isokinetic",), "Stainless steel 316L isokinetic sampling probe"),
        (("sample",), "Conductive PU sample tubing, 4 mm OD"),
        (("particle",), "Laser particle counter, 0.5 + 5.0 um channels; 316L 2-port sampling manifold"),
        (("operator",), "Operator figure (e.g. PLA print), cleanroom gown colours"),
        (("cu",) if "core" in words else (), "Copper Cu-ETP (C11000) plates 0.3 mm, both faces Ra <= 0.8 um, edges folded + sealed"),
        (("bibo", "laf"), "Stainless steel 304 bag-in/bag-out housing, H14 media, PVC change bag"),
        (("dv",), "24 V spring-return damper actuator + SPDT end switch; aluminium blade in a PETG tee"),
        (("pt",) if "102" in words else (), "Particle sensor SPS30 (indicative) with sample probe"),
        (("plenum", "skirts", "stack", "cap"), "Stainless steel 304 / clear PVC"),
        (("peristaltic",), "Peristaltic dosing pump, stainless housing"),
        (("vial",), "Glass vial with product and rubber stopper"),
        (("needle",), "Stainless steel 316L needles on aluminium carriage"),
        (("hose",), "Platinum-cured silicone tubing"),
        (("filling", "turntable", "accumulation", "tank", "stopper", "chute", "press"), "Stainless steel 316L / polycarbonate RABS"),
        (("pass",), "Stainless steel 304 with glass vision panels"),
        (("acrylic", "ceiling"), "PMMA (cast acrylic), 5 mm, clear"),
        (("strip",), "FR4 flex/rigid strip, 1 mm, ENIG copper tracks"),
        (("pcb",), "FR4 2-layer PCB 1.6 mm + components"),
        (("duct", "riser", "header", "boot", "branch", "discharge", "sleeve", "drop"), "Clear PVC / PETG duct, 2 mm wall"),
        (("frame",) if "base" in words else (), "Aluminium 20x20 extrusion, black anodised"),
        (("casing",), "Clear PETG panel (3D model: galvanised steel)"),
        (("coil",), "Copper tube + aluminium fins"),
        (("filter", "hepa"), "Filter media in aluminium frame"),
        (("bench", "diffuser", "grille"), "Stainless steel 304 / white powder-coat"),
        (("pipework",), "Copper refrigerant tube (R32)"),
    ]
    for keys, mat in rules:
        if words & set(keys):
            return mat
    return "See model colour"


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cad/rig-geometry.json", sys.argv[2] if len(sys.argv) > 2 else "cad")
