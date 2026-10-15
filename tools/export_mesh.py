"""Tessellate the rig's exact CAD solids into a mesh JSON for the 3D DWG writer (tools/make_dwg.mjs).

The solids are the same ones build_cad.py writes to STEP (same primitives, same transforms, mm),
so the DWG and the STEP line up exactly. Each part keeps its bodies grouped by colour.

Usage:  python tools/export_mesh.py cad/rig-geometry.json cad/rig-mesh.json [linear_tol_mm] [angular_tol_rad]
Output: { "units": "mm", "axes": ..., "parts": [ { "asm", "part", "asm_file", "part_file",
          "bodies": [ { "color": [r, g, b, a], "v": [[x, y, z], ...], "f": [[i, j, k], ...] } ] } ] }
Axes are the STEP / simulator axes (Y up); the DWG writer turns them to AutoCAD's Z up.
"""
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_cad  # noqa: E402
import cad_2d  # noqa: E402


def tessellate(solids, tol, ang):
    verts, faces = [], []
    for s in solids:
        v, tri = s.tessellate(tol, ang)
        base = len(verts)
        verts += [[round(p.x, 3), round(p.y, 3), round(p.z, 3)] for p in v]
        faces += [[base + a, base + b, base + c] for a, b, c in tri]
    return verts, faces


def main(src, dst, tol=0.1, ang=0.35):
    t0 = time.time()
    tree, fails = build_cad.build_tree(json.load(open(src)))
    out = {"units": "mm",
           "axes": "STEP/simulator axes: X along the rig, Y up, Z towards the front; AutoCAD Z-up = (x, -z, y)",
           "tolerance": {"linear_mm": tol, "angular_rad": ang},
           "parts": []}
    ntri = 0
    for asm, parts in tree.items():
        for part, cols in parts.items():
            bodies = []
            for col, solids in cols.items():
                v, f = tessellate(solids, tol, ang)
                if f:
                    bodies.append({"color": list(col), "v": v, "f": f})
                    ntri += len(f)
            if bodies:
                out["parts"].append({"asm": asm, "part": part,
                                     "asm_file": cad_2d.safe(build_cad.ascii_name(asm)),
                                     "part_file": cad_2d.safe(build_cad.ascii_name(part)),
                                     "bodies": bodies})
    with open(dst, "w") as fh:
        json.dump(out, fh, separators=(",", ":"))
    print("parts %d · triangles %d · %.1f MB · %.0f s" % (len(out["parts"]), ntri, os.path.getsize(dst) / 1e6, time.time() - t0))
    for f_ in fails:
        print("  not built:", f_)


if __name__ == "__main__":
    a = sys.argv
    main(a[1] if len(a) > 1 else "cad/rig-geometry.json", a[2] if len(a) > 2 else "cad/rig-mesh.json",
         float(a[3]) if len(a) > 3 else 0.1, float(a[4]) if len(a) > 4 else 0.35)
