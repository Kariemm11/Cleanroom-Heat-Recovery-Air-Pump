# CAD model: clean-room heat-recovery air-pump test rig

| File | Contents |
|---|---|
| `cleanroom-rig-assembly.step` | The whole rig: AP214 STEP, millimetres, 8 sub-assemblies, 266 named and coloured parts, 1 507 solids |
| `step/*.step` | One file per sub-assembly, for working on a unit on its own |
| `BOM.csv` | Every part: sub-assembly, body count, bounding size (mm), material / finish |
| `drawings/enclosure-GA.pdf` / `.svg` | Acrylic enclosure fabrication drawing, A3 at 1:6: panel views, cut-out positions and cut list |
| `rig-geometry.json` | The source geometry exported from the simulator; the STEP is rebuilt from it |

Overall size: **1028 × 532 × 539 mm**. That is the 1000 × 500 × 500 mm acrylic box, plus the aluminium base frame and feet, the fresh-air intake hood, the HMI and the pass box on the front face.

## Opening it in SolidWorks

1. **File → Open**, set the file type to *STEP AP203/214/242 (\*.step; \*.stp)*, and choose `cleanroom-rig-assembly.step`.
2. Under **Options…**, keep the default *Import multiple bodies as parts* setting, so that each STEP part becomes a SolidWorks part. Then click **Open**.
3. If SolidWorks offers *Import Diagnostics*, you can answer **No**. All bodies are closed, valid solids.
4. The tree shows `Cleanroom_HR_AirPump_Rig`, then the 8 sub-assemblies, then the parts, e.g. *AHU → Coil preheat*, *PCB wiring harness → PCB strip TT-102 copper*.
5. To keep native files, use **File → Save As → Assembly (\*.sldasm)** and let it save the parts as external `.sldprt` files. *Pack and Go* also works.

Orientation matches SolidWorks: **Y is up**, and the rig's **front face points to +Z**, so the *Front* view shows the HMI side. The plant room is at −X and the clean room at +X, with the partition at X = 0.

Notes:
- STEP carries colours but not transparency. Apply a clear-acrylic appearance to the *Acrylic enclosure* parts, and clear plastic to *Ductwork*, to see inside.
- Imported parts are solid bodies without a feature history. To edit them parametrically, run **FeatureWorks** (Insert → FeatureWorks → Recognize Features) on a part, or sketch on its faces.
- The AHU and the heat-recovery air-pump unit are the units from the project's earlier 3D model, at 1.1 cm per model unit. Their internals (fins, pleats, coil tubes) are therefore fine. Simplify them before 3D-printing parts of the rig.

## Rebuilding the model

The simulator is the single source of geometry, so the CAD always matches what the 3D simulation shows.

```bash
# 1. dump the simulator's solids (needs Node 18+ and Playwright + Chromium)
npm i -D playwright && npx playwright install chromium
node tools/export_geometry.js cad/rig-geometry.json

# 2. rebuild the STEP files and the BOM (needs Python 3.10+ and CadQuery 2.6)
pip install cadquery
python tools/build_cad.py cad/rig-geometry.json cad

# 3. redraw the enclosure drawing
python tools/make_drawings.py
```

`build_cad.py` turns each primitive into an exact B-rep solid: boxes, cylinders, cones and tori. Ducts become straight tubes joined by tangent bends with a 1.5 mm wall. Refrigerant lines become splines swept with a circle. It then groups the solids by part and colour, and writes the assembly and sub-assembly STEP files and `BOM.csv`.
