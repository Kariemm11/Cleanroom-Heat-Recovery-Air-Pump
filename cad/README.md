# CAD model: clean-room heat-recovery air-pump test rig

| File | Contents |
|---|---|
| `cleanroom-rig-assembly.step` | The whole rig: AP214 STEP, millimetres, 9 sub-assemblies, 181 named parts (298 coloured bodies), 1 445 solids |
| `plant-system-AHU-and-air-pump-in-parallel.step` | **The plant on its own**: AHU + heat-recovery air-pump unit (working in parallel on one R32 circuit) + fresh-air compressor + exhaust safety train + ductwork |
| `step/*.step` | One file per sub-assembly, for working on a unit on its own |
| `parts/<sub-assembly>/*.step` | **One STEP file per part** (181), with its colours, at its position in the rig |
| `dwg/cleanroom-rig-assembly.dwg` | **3D DWG** (AutoCAD) of the whole rig: one layer per sub-assembly, one block per part, true colours, mm, Z up |
| `dwg/plant-system-AHU-and-air-pump-in-parallel.dwg` | **3D DWG** of the plant working in parallel (same parts as the plant STEP) |
| `dwg/sub-assemblies/*.dwg`, `dwg/parts/<sub-assembly>/*.dwg` | 3D DWG of every sub-assembly (9) and every part (181) |
| `dxf3d/…-3D.dxf` | The same 3D set as DXF (whole rig, plant system, 9 sub-assemblies, 181 parts) |
| `dxf/cleanroom-rig-assembly.dxf` | 2D general arrangement of the whole rig: front, top and right-side views (first-angle), hidden lines dashed |
| `dxf/plant-system-AHU-and-air-pump-in-parallel.dxf` | 2D front, top and side views of the plant system |
| `dxf/sub-assemblies/*.dxf` | The same three 2D views for each of the 9 sub-assemblies |
| `dxf/parts/<sub-assembly>/*.dxf` | The three 2D views of every part (181 DXF files) |
| `dxf/enclosure-panels/*.dxf` | Flat **cutting profiles** for the 9 acrylic panels (outline + every cut-out), 1:1 in mm, for a laser cutter |
| `drawings/rig-2D-views.pdf` | All the 2D view sheets (assembly + sub-assemblies) in one PDF; the sheets are also in `drawings/views/*.svg` |
| `BOM.csv` | Every part: sub-assembly, body count, bounding size (mm), material / finish |
| `drawings/enclosure-GA.pdf` / `.svg` | Acrylic enclosure fabrication drawing, A3 at 1:6: panel views, cut-out positions and cut list |
| `rig-geometry.json` | The source geometry exported from the simulator; the STEP is rebuilt from it |

Overall size: **1057 × 626 × 561 mm** (with the HEPA-bypass roof stack, the exhaust-terminal-3 housing outside the right wall and collector C outside the back wall). That is the 1000 × 500 × 500 mm acrylic box, plus the aluminium base frame and feet, the fresh-air intake hood, the HMI and the pass box on the front face.

## Opening it in SolidWorks

1. **File → Open**, set the file type to *STEP AP203/214/242 (\*.step; \*.stp)*, and choose `cleanroom-rig-assembly.step`.
2. Under **Options…**, keep the default *Import multiple bodies as parts* setting, so that each STEP part becomes a SolidWorks part. Then click **Open**.
3. If SolidWorks offers *Import Diagnostics*, you can answer **No**. All bodies are closed, valid solids.
4. The tree shows `Cleanroom_HR_AirPump_Rig`, then the 9 sub-assemblies, then the parts, e.g. *AHU → Coil preheat*, *PCB wiring harness → PCB strip TT-109 copper*.
5. To keep native files, use **File → Save As → Assembly (\*.sldasm)** and let it save the parts as external `.sldprt` files. *Pack and Go* also works.

Orientation matches SolidWorks: **Y is up**, and the rig's **front face points to +Z**, so the *Front* view shows the HMI side. The plant room is at −X and the clean room at +X, with the partition at X = 0.

Notes:
- STEP carries colours but not transparency. Apply a clear-acrylic appearance to the *Acrylic enclosure* parts, and clear plastic to *Ductwork*, to see inside.
- Imported parts are solid bodies without a feature history. To edit them parametrically, run **FeatureWorks** (Insert → FeatureWorks → Recognize Features) on a part, or sketch on its faces.
- The AHU and the heat-recovery air-pump unit are the units from the project's earlier 3D model, at 1.1 cm per model unit. Their internals (fins, pleats, coil tubes) are therefore fine. Simplify them before 3D-printing parts of the rig.

## Opening the 3D DWG / DXF in AutoCAD

Open `dwg/cleanroom-rig-assembly.dwg` (or the plant, a sub-assembly or a part). The model is in **millimetres with Z up** (AutoCAD's convention): X runs along the rig (plant room at −X, clean room at +X), +Y is the back wall, Z is height. Set a 3D view (**View → 3D Views → SW Isometric**) and a shaded visual style.

- Every part is a **block**, on the layer of its sub-assembly: freeze a layer to hide a sub-assembly, or click a part to select it.
- The geometry is a **mesh** of the exact CAD solid (AutoCAD MESH entities). For a true 3D solid, select it and run **CONVTOSOLID**, or **IMPORT** the matching STEP file, which gives exact 3DSOLIDs.
- The DWG and STEP files share the same parts and positions, so they can be overlaid.

## Rebuilding the model

The simulator is the single source of geometry, so the CAD always matches what the 3D simulation shows.

```bash
# 1. dump the simulator's solids (needs Node 18+ and Playwright + Chromium)
npm i -D playwright && npx playwright install chromium
node tools/export_geometry.js cad/rig-geometry.json

# 2. rebuild the STEP files, the BOM and the DXF drawings (needs Python 3.10+, CadQuery 2.6+ and ezdxf)
pip install cadquery
python tools/build_cad.py cad/rig-geometry.json cad

# 3. redraw the enclosure drawing
python tools/make_drawings.py

# 4. the 3D DXF and 3D DWG sets (ezdxf; Node 22 with the pinned packages in tools/package.json)
python tools/export_mesh.py cad/rig-geometry.json cad/rig-mesh.json 0.08 0.3
python tools/make_dxf3d.py cad/rig-mesh.json cad/dxf3d
(cd tools && npm ci) && node tools/make_dwg.mjs cad/rig-mesh.json cad/dwg
```

`build_cad.py` turns each primitive into an exact B-rep solid: boxes, cylinders, cones and tori. Ducts are rectangular: each straight section becomes a hollow box with a 1.5 mm wall, overlapping at the corners like mitred elbows. Refrigerant lines become splines swept with a circle. It then groups the solids by part and colour, and writes the assembly, sub-assembly and per-part STEP files and `BOM.csv`. `cad_2d.py` then projects every part, sub-assembly and the whole rig into front, top and right-side views with hidden-line removal (OpenCascade HLR) and writes them as DXF (ezdxf) and SVG.

`export_mesh.py` tessellates the same exact solids into triangles (0.08 mm chord, 0.3 rad angle); `make_dxf3d.py` and `make_dwg.mjs` write them as 3D DXF and 3D DWG with one layer per sub-assembly, one block per part and Z up.
