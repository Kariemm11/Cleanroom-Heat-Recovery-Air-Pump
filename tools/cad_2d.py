"""2D drawings and DXF files from the CAD solids (used by build_cad.py).

Every part, every sub-assembly and the whole rig get three orthographic views (front, top, right side;
first-angle layout) with hidden lines, as DXF (mm, layers VISIBLE / HIDDEN / TEXT / BORDER) for AutoCAD,
SolidWorks or a laser cutter. Sub-assemblies and the whole rig also get an SVG sheet, which
tools/make_build_pack.py prints to PDF. The acrylic enclosure panels get flat DXF cutting patterns.
"""
import os
import re

import cadquery as cq
import ezdxf
from OCP.BRepMesh import BRepMesh_IncrementalMesh
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt
from OCP.HLRAlgo import HLRAlgo_Projector
from OCP.HLRBRep import HLRBRep_Algo, HLRBRep_HLRToShape, HLRBRep_PolyAlgo, HLRBRep_PolyHLRToShape

# view direction (towards the viewer) and the view's x axis; first-angle placement
VIEWS = {"FRONT": ((0, 0, 1), (1, 0, 0)), "TOP": ((0, 1, 0), (1, 0, 0)), "RIGHT SIDE": ((1, 0, 0), (0, 0, -1))}


def safe(s):
    return re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")[:90] or "part"


def _edges(shape):
    out = []
    if shape is None or shape.IsNull():
        return out
    for e in cq.Shape.cast(shape).Edges():
        try:
            if e.geomType() == "LINE":
                a, b = e.startPoint(), e.endPoint()
                out.append([(a.x, a.y), (b.x, b.y)])
            else:
                n = max(4, min(72, int(e.Length() / 1.5) + 2))
                out.append([(p.x, p.y) for p in (e.positionAt(i / (n - 1)) for i in range(n))])
        except Exception:
            pass
    return out


def project(shape, view, poly):
    n, x = VIEWS[view]
    ax = gp_Ax2(gp_Pnt(0, 0, 0), gp_Dir(*n), gp_Dir(*x))
    s = shape.wrapped if hasattr(shape, "wrapped") else shape
    if poly:                                   # fast polygonal hidden-line removal for big assemblies
        BRepMesh_IncrementalMesh(s, 0.6, False, 0.5, True)
        a = HLRBRep_PolyAlgo()
        a.Load(s)
        a.Projector(HLRAlgo_Projector(ax))
        a.Update()
        h = HLRBRep_PolyHLRToShape()
        h.Update(a)
        return _edges(h.VCompound()) + _edges(h.OutLineVCompound()), _edges(h.HCompound())
    a = HLRBRep_Algo()                         # exact hidden-line removal for single parts
    a.Add(s)
    a.Projector(HLRAlgo_Projector(ax))
    a.Update()
    a.Hide()
    h = HLRBRep_HLRToShape(a)
    return _edges(h.VCompound()) + _edges(h.OutLineVCompound()), _edges(h.HCompound())


def _bb(lines):
    xs = [p[0] for l in lines for p in l] or [0]
    ys = [p[1] for l in lines for p in l] or [0]
    return min(xs), min(ys), max(xs), max(ys)


def layout(shape, poly):
    """three views placed first-angle: front, top below it, right side to its left"""
    v = {k: project(shape, k, poly) for k in VIEWS}
    f = _bb(v["FRONT"][0] + v["FRONT"][1])
    t = _bb(v["TOP"][0] + v["TOP"][1])
    r = _bb(v["RIGHT SIDE"][0] + v["RIGHT SIDE"][1])
    g = max(15.0, 0.12 * max(f[2] - f[0], f[3] - f[1]))
    off = {"FRONT": (0, 0), "TOP": (0, f[1] - g - t[3]), "RIGHT SIDE": (f[0] - g - r[2], 0)}
    placed = {}
    for k, (vis, hid) in v.items():
        dx, dy = off[k]
        placed[k] = ([[(x + dx, y + dy) for x, y in l] for l in vis], [[(x + dx, y + dy) for x, y in l] for l in hid])
    return placed


def write_dxf(path, title, placed, note=""):
    doc = ezdxf.new("R2010", setup=True)
    doc.units = ezdxf.units.MM
    doc.layers.add("VISIBLE", color=7)
    doc.layers.add("HIDDEN", color=8, linetype="HIDDEN")
    doc.layers.add("TEXT", color=5)
    doc.layers.add("BORDER", color=7)
    msp = doc.modelspace()
    allp = []
    for k, (vis, hid) in placed.items():
        for l in vis:
            msp.add_lwpolyline(l, dxfattribs={"layer": "VISIBLE"})
        for l in hid:
            msp.add_lwpolyline(l, dxfattribs={"layer": "HIDDEN"})
        allp += vis + hid
        x0, y0, x1, y1 = _bb(vis + hid)
        h = max(2.5, 0.025 * max(x1 - x0, y1 - y0, 40))
        msp.add_text(k + " VIEW", height=h, dxfattribs={"layer": "TEXT"}).set_placement((x0, y0 - 2.2 * h))
    x0, y0, x1, y1 = _bb(allp)
    h = max(3.0, 0.02 * max(x1 - x0, y1 - y0, 60))
    m = 4 * h
    msp.add_lwpolyline([(x0 - m, y0 - 3 * m), (x1 + m, y0 - 3 * m), (x1 + m, y1 + m), (x0 - m, y1 + m)], close=True, dxfattribs={"layer": "BORDER"})
    msp.add_text(title, height=1.3 * h, dxfattribs={"layer": "TEXT"}).set_placement((x0 - m + h, y0 - 3 * m + 3.2 * h))
    msp.add_text("Clean-room heat-recovery air-pump rig · Eng. Kariem Moussa · GIU · mm · first-angle projection" + (" · " + note if note else ""),
                 height=0.7 * h, dxfattribs={"layer": "TEXT"}).set_placement((x0 - m + h, y0 - 3 * m + 1.4 * h))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    doc.saveas(path)
    return (x0 - m, y0 - 3 * m, x1 + m, y1 + m)


def write_svg(path, title, placed):
    allp = [l for vis, hid in placed.values() for l in vis + hid]
    x0, y0, x1, y1 = _bb(allp)
    W, H = x1 - x0, y1 - y0
    pad = 0.08 * max(W, H)
    vb = (x0 - pad, -(y1 + pad), W + 2 * pad, H + 3 * pad)
    sw = max(W, H) / 1400
    out = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="%.2f %.2f %.2f %.2f" width="420mm" height="297mm" preserveAspectRatio="xMidYMid meet">' % vb,
           '<rect x="%.2f" y="%.2f" width="%.2f" height="%.2f" fill="#ffffff"/>' % vb]
    for k, (vis, hid) in placed.items():
        for l in hid:
            out.append('<polyline fill="none" stroke="#9aa7b2" stroke-width="%.3f" stroke-dasharray="%.2f %.2f" points="%s"/>'
                       % (sw * 0.8, 4 * sw, 3 * sw, " ".join("%.2f,%.2f" % (x, -y) for x, y in l)))
        for l in vis:
            out.append('<polyline fill="none" stroke="#121c26" stroke-width="%.3f" points="%s"/>' % (sw * 1.6, " ".join("%.2f,%.2f" % (x, -y) for x, y in l)))
        bx0, by0, bx1, by1 = _bb(vis + hid)
        out.append('<text x="%.2f" y="%.2f" font-family="Arial" font-size="%.2f" fill="#0369a1">%s VIEW</text>' % (bx0, -by0 + 0.035 * max(W, H), 0.022 * max(W, H), k))
    out.append('<text x="%.2f" y="%.2f" font-family="Arial" font-weight="bold" font-size="%.2f" fill="#121c26">%s</text>' % (x0, -(y1 + pad * 0.4), 0.03 * max(W, H), title))
    out.append('<text x="%.2f" y="%.2f" font-family="Arial" font-size="%.2f" fill="#5d6e7e">Clean-room heat-recovery air-pump rig · Eng. Kariem Moussa · GIU · mm · first-angle projection · not to scale on screen</text>'
               % (x0, -(y0 - pad * 1.8), 0.018 * max(W, H)))
    out.append("</svg>")
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w").write("\n".join(out))


# acrylic panels as flat cutting patterns: (panel name in make_drawings.PANELS, u0, v0, flip_u)
PANEL_ORIGIN = {"Base plate": (-500, 250, False), "Roof": (-500, 250, False), "Front wall": (-500, 495, False),
                "Back wall": (-500, 495, False), "Left wall (outdoor side)": (-245, 495, False), "Right wall": (245, 495, True),
                "Partition wall": (245, 495, True), "Clean-room false ceiling": (2.5, 245, False), "Clean-room door": (0, 340, False)}


def write_panels(panels, outdir):
    for name, qty, (A, B), plane, cuts in panels:
        u0, v0, flip = PANEL_ORIGIN.get(name, (0, B, False))
        doc = ezdxf.new("R2010", setup=True)
        doc.units = ezdxf.units.MM
        doc.layers.add("CUT_OUTLINE", color=7)
        doc.layers.add("CUT_INNER", color=1)
        doc.layers.add("TEXT", color=5)
        msp = doc.modelspace()
        msp.add_lwpolyline([(0, 0), (A, 0), (A, B), (0, B)], close=True, dxfattribs={"layer": "CUT_OUTLINE"})
        for kind, u, v, w, h, note in cuts:
            x = (u0 - u) if flip else (u - u0)
            y = B - (v0 - v)
            if kind == "hole":
                msp.add_circle((x, y), w / 2, dxfattribs={"layer": "CUT_INNER"})
            else:
                msp.add_lwpolyline([(x - w / 2, y - h / 2), (x + w / 2, y - h / 2), (x + w / 2, y + h / 2), (x - w / 2, y + h / 2)],
                                   close=True, dxfattribs={"layer": "CUT_INNER"})
            if note:
                msp.add_text(note, height=4, dxfattribs={"layer": "TEXT"}).set_placement((x + w / 2 + 3, y + 3))
        msp.add_text("%s · %d off · %g × %g mm · 5 mm cast PMMA · layer CUT_OUTLINE = outline, CUT_INNER = cut-outs, TEXT = do not cut"
                     % (name, qty, A, B), height=6, dxfattribs={"layer": "TEXT"}).set_placement((0, -14))
        os.makedirs(outdir, exist_ok=True)
        doc.saveas(os.path.join(outdir, safe(name) + ".dxf"))
