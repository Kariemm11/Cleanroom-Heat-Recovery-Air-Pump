"""Write 3D DXF files of the rig from the mesh JSON made by tools/export_mesh.py.

Every body is a MESH entity (AutoCAD 2010+ subdivision mesh, level 0: exactly the facets of the
CAD solid); AutoCAD turns it into a 3D solid with CONVTOSOLID. Units mm, Z up (AutoCAD axes:
the STEP's (x, y, z) becomes (x, -z, y)). One layer per sub-assembly, one block per part, each
body in its own true colour, so parts can be picked and hidden by layer.

  python tools/make_dxf3d.py cad/rig-mesh.json cad/dxf3d

writes  cleanroom-rig-assembly-3D.dxf               the whole rig
        plant-system-AHU-and-air-pump-in-parallel-3D.dxf   AHU + air-pump unit + compressor + exhaust safety + ducts
        sub-assemblies/<sub-assembly>-3D.dxf
        parts/<sub-assembly>/<part>-3D.dxf
"""
import json
import os
import sys

import ezdxf

PLANT = ["AHU", "Heat-recovery air-pump unit", "Fresh-air compressor",
         "Exhaust safety: PT-102 + DV-101 + outer HEPA", "Ductwork"]
LAYER_ACI = [8, 1, 3, 5, 4, 6, 2, 30, 140, 200]


def zup(v):
    return (v[0], -v[2], v[1])


def new_doc(asms):
    doc = ezdxf.new("R2018", setup=True)
    doc.units = ezdxf.units.MM
    doc.header["$MEASUREMENT"] = 1
    for i, a in enumerate(asms):
        if a not in doc.layers:
            doc.layers.add(layer_name(a), color=LAYER_ACI[i % len(LAYER_ACI)])
    return doc


def layer_name(asm):
    return "".join(c if c.isalnum() or c in " -_" else "_" for c in asm)[:60]


def add_part(doc, part, layer, as_block=True):
    """the part's bodies as MESH entities, in a block inserted at the origin (or straight into model space)"""
    if as_block:
        name, n = part["part_file"][:60] or "part", 2
        while name in doc.blocks:
            name, n = "%s_%d" % (part["part_file"][:56], n), n + 1
        target = doc.blocks.new(name=name)
    else:
        target = doc.modelspace()
    for b in part["bodies"]:
        r, g, bl = (max(0, min(255, round(c * 255))) for c in b["color"][:3])
        mesh = target.add_mesh(dxfattribs={"layer": layer if not as_block else "0", "color": 256 if not as_block else 0})
        mesh.rgb = (r, g, bl)
        with mesh.edit_data() as md:
            md.vertices = [zup(v) for v in b["v"]]
            md.faces = [tuple(f) for f in b["f"]]
    if as_block:
        doc.modelspace().add_blockref(target.name, (0, 0, 0), dxfattribs={"layer": layer})


def write(path, parts, asms, blocks=True):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    doc = new_doc(asms)
    for p in parts:
        add_part(doc, p, layer_name(p["asm"]), as_block=blocks)
    doc.set_modelspace_vport(height=1200, center=(0, 0))
    doc.saveas(path)
    return os.path.getsize(path)


def main(src, outdir):
    m = json.load(open(src))
    parts = m["parts"]
    asms = list(dict.fromkeys(p["asm"] for p in parts))
    total = 0
    total += write(os.path.join(outdir, "cleanroom-rig-assembly-3D.dxf"), parts, asms)
    total += write(os.path.join(outdir, "plant-system-AHU-and-air-pump-in-parallel-3D.dxf"),
                   [p for p in parts if p["asm"] in PLANT], [a for a in asms if a in PLANT])
    for a in asms:
        sub = [p for p in parts if p["asm"] == a]
        total += write(os.path.join(outdir, "sub-assemblies", sub[0]["asm_file"] + "-3D.dxf"), sub, [a])
        for p in sub:
            total += write(os.path.join(outdir, "parts", p["asm_file"], p["part_file"] + "-3D.dxf"), [p], [a], blocks=False)
    print("3D DXF: %d parts, %d sub-assemblies, assembly + plant system · %.1f MB in %s" % (len(parts), len(asms), total / 1e6, outdir))


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "cad/rig-mesh.json", sys.argv[2] if len(sys.argv) > 2 else "cad/dxf3d")
