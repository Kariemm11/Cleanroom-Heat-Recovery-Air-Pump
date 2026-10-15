#!/usr/bin/env node
/* Write 3D DWG files (AutoCAD) of the rig from the mesh JSON made by tools/export_mesh.py.

   Every body becomes one MESH entity (AcDbSubDMesh, AutoCAD 2010+, subdivision level 0, i.e. exactly
   the facets of the CAD solid; AutoCAD turns it into a 3D solid with CONVTOSOLID). Units mm, Z up:
   the STEP's (x, y, z) becomes AutoCAD's (x, -z, y). One layer per sub-assembly, one block per part
   (inserted once at the origin, on its sub-assembly's layer), each body in its own true colour, so
   parts can be picked, hidden and frozen in AutoCAD.

     cd tools && npm install            # once: installs the pinned @node-projects/acad-ts (MIT)
     node tools/make_dwg.mjs cad/rig-mesh.json cad/dwg [--version AC1032|AC1027|AC1024|AC1018]

   writes  <outdir>/cleanroom-rig-assembly.dwg                          the whole rig
           <outdir>/plant-system-AHU-and-air-pump-in-parallel.dwg       AHU + air-pump unit + compressor + exhaust safety + ducts
           <outdir>/sub-assemblies/<sub-assembly>.dwg
           <outdir>/parts/<sub-assembly>/<part>.dwg

   --version  DWG version to write: AC1032 = AutoCAD 2018 (default), AC1027 = 2013, AC1024 = 2010,
              AC1018 = 2004. MESH needs AC1024 or later; for AC1018 every body is written as
              POLYFACE MESH instead (split into pieces of at most 32767 vertices / faces).
   --polyface write POLYFACE MESH entities in any version (instead of MESH).
   --no-verify  skip reading every file back (by default each DWG is re-read with the acad-ts
              DwgReader and its layers, blocks, entities, vertices and faces are checked).
   Exits non-zero on any failure. */
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import {
  ACadVersion, BlockRecord, CadDocument, Color, DwgReader, DwgWriter, Insert, Layer, MeasurementUnits, Mesh,
  MeshEdge, PolyfaceMesh, Seqend, Transparency, UnitsType, VertexFaceMesh, VertexFaceRecord, VertexFlags, XY, XYZ,
} from '@node-projects/acad-ts';

const PLANT_ASMS = ['AHU', 'Heat-recovery air-pump unit', 'Fresh-air compressor',
  'Exhaust safety: PT-102 + DV-101 + outer HEPA', 'Ductwork'];
const ASSEMBLY_FILE = 'cleanroom-rig-assembly.dwg';
const PLANT_FILE = 'plant-system-AHU-and-air-pump-in-parallel.dwg';
const VERSIONS = { AC1032: 'AutoCAD 2018', AC1027: 'AutoCAD 2013', AC1024: 'AutoCAD 2010', AC1018: 'AutoCAD 2004' };
// layer colours (ACI), one per sub-assembly in order of first appearance; the first ten match tools/make_dxf3d.py
const LAYER_ACI = [8, 1, 3, 5, 4, 6, 2, 30, 140, 200, 40, 90, 170, 220, 250, 11, 51, 131, 191, 231];
const PFACE_LIMIT = 32767; // POLYFACE MESH vertex and face counts are 16-bit (BS) in DWG

// ---------------------------------------------------------------------------------------- arguments
function usage(msg) {
  if (msg) console.error(`make_dwg: ${msg}`);
  console.error('usage: node tools/make_dwg.mjs <mesh.json> <outdir> [--version AC1032|AC1027|AC1024|AC1018] [--polyface] [--no-verify]');
  process.exit(2);
}
const opts = { version: 'AC1032', polyface: false, verify: true, pfaceLimit: PFACE_LIMIT };
const positional = [];
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === '--version' || a === '-v') opts.version = String(process.argv[++i] || '').toUpperCase();
  else if (a.startsWith('--version=')) opts.version = a.slice(10).toUpperCase();
  else if (a === '--polyface') opts.polyface = true;
  else if (a === '--no-verify') opts.verify = false;
  else if (a.startsWith('--pface-limit=')) opts.pfaceLimit = Math.max(3, Math.min(PFACE_LIMIT, parseInt(a.slice(14), 10))); // testing aid
  else if (a === '-h' || a === '--help') usage();
  else if (a.startsWith('-')) usage(`unknown option ${a}`);
  else positional.push(a);
}
if (positional.length !== 2) usage('need <mesh.json> and <outdir>');
if (!VERSIONS[opts.version]) usage(`unsupported --version ${opts.version} (use ${Object.keys(VERSIONS).join(', ')})`);
const [meshPath, outDir] = positional;
const version = ACadVersion[opts.version];
const usePolyface = opts.polyface || version < ACadVersion.AC1024; // MESH (AcDbSubDMesh) exists from AutoCAD 2010 (AC1024)

// ------------------------------------------------------------------------- acad-ts 3.3.0 workarounds
// (1) The R2004+ file header must give the number of entries in the section page map. acad-ts writes
//     that number minus one; AutoCAD's own files (and LibreDWG's check) count every entry.
const acadDist = new URL('.', import.meta.resolve('@node-projects/acad-ts')).href;
try {
  const { DwgFileHeaderWriterAC18 } = await import(acadDist + 'IO/DWG/DwgStreamWriters/DwgFileHeaderWriterAC18.js');
  const writeRecords = DwgFileHeaderWriterAC18.prototype._writeRecords;
  if (typeof writeRecords !== 'function') throw new Error('_writeRecords not found');
  DwgFileHeaderWriterAC18.prototype._writeRecords = function patchedWriteRecords() {
    writeRecords.call(this);
    this.fileHeader.sectionAmount = this._localSectionsMaps.length;
  };
} catch (e) {
  console.warn(`make_dwg: warning: could not apply the section-count fix (${e.message}); files are still readable`);
}
// (2) A DWG true colour is the 32-bit value 0xC2RRGGBB (AutoCAD, LibreDWG, and acad-ts's own reader). acad-ts's
//     writer stores 0xC2BBGGRR, swapping red and blue, so it is given the colour with R and B exchanged.
try {
  const { DwgStreamWriterAC18 } = await import(acadDist + 'IO/DWG/DwgStreamWriters/DwgStreamWriterAC18.js');
  for (const name of ['writeEnColor', 'writeEnColorBook', 'writeCmColor']) {
    const write = DwgStreamWriterAC18.prototype[name];
    if (typeof write !== 'function') throw new Error(`${name} not found`);
    DwgStreamWriterAC18.prototype[name] = function patchedColorWrite(color, ...rest) {
      if (color && color.isTrueColor) { const [r, g, b] = color.getTrueColorRgb(); color = new Color(b, g, r); }
      return write.call(this, color, ...rest);
    };
  }
} catch (e) {
  console.error(`make_dwg: cannot apply the true-colour fix (${e.message}); colours would be wrong`);
  process.exit(1);
}
// (3) Polyline vertices / faces are not registered with the document by acad-ts, so they would be
//     written without handles. They are registered by hand through this (internal) method.
if (usePolyface && typeof CadDocument.prototype._addCadObject !== 'function') {
  console.error('make_dwg: this acad-ts version has no CadDocument._addCadObject; POLYFACE output is unavailable');
  process.exit(1);
}

// ---------------------------------------------------------------------------------------- naming
const TRANSLIT = {
  '→': 'to', '←': 'from', '↔': 'to', '≤': 'le', '≥': 'ge', 'µ': 'u', 'μ': 'u', '×': 'x', '°': 'deg', '±': 'pm',
  '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4', '²': '2', '³': '3', 'Δ': 'D', 'δ': 'd', 'Ø': 'dia', 'ø': 'dia',
  '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', 'ß': 'ss', 'Ω': 'Ohm', '·': '.',
};
function ascii(s) {
  return [...String(s)].map(c => TRANSLIT[c] ?? c).join('').normalize('NFKD').replace(/[̀-ͯ]/g, '');
}
function fileSafe(s) {
  return ascii(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'part';
}
function layerSafe(s) { // same rule as tools/make_dxf3d.py: letters, digits, space, '-' and '_'
  return [...String(s)].map(c => (/[\p{L}\p{N} _-]/u.test(c) ? c : '_')).join('').slice(0, 60).trim() || 'Layer';
}

// ---------------------------------------------------------------------------------------- input
const t0 = performance.now();
let mesh;
try { mesh = JSON.parse(fs.readFileSync(meshPath, 'utf8')); }
catch (e) { console.error(`make_dwg: cannot read ${meshPath}: ${e.message}`); process.exit(1); }
if (!mesh || !Array.isArray(mesh.parts) || mesh.parts.length === 0) { console.error('make_dwg: the mesh JSON has no "parts"'); process.exit(1); }
if (mesh.units && String(mesh.units).toLowerCase() !== 'mm') console.warn(`make_dwg: warning: units are "${mesh.units}", written as mm`);

/** weld identical vertices, map to Z-up, fan-triangulate polygons, drop degenerate triangles */
function prepareBody(b, where) {
  if (!Array.isArray(b.v) || !Array.isArray(b.f)) throw new Error(`${where}: body without "v"/"f" arrays`);
  const n = b.v.length;
  const remap = new Int32Array(n);
  const index = new Map();
  const xyz = [];
  for (let i = 0; i < n; i++) {
    const p = b.v[i];
    const x = +p[0], y = +p[1], z = +p[2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) throw new Error(`${where}: vertex ${i} is not a finite 3D point`);
    const key = `${x},${y},${z}`;
    let j = index.get(key);
    if (j === undefined) { j = xyz.length / 3; index.set(key, j); xyz.push(x, -z, y); } // (x, y, z) -> (x, -z, y)
    remap[i] = j;
  }
  const tri = [];
  let dropped = 0;
  for (let k = 0; k < b.f.length; k++) {
    const f = b.f[k];
    if (!Array.isArray(f) || f.length < 3) throw new Error(`${where}: face ${k} has fewer than 3 vertices`);
    for (const i of f) if (!Number.isInteger(i) || i < 0 || i >= n) throw new Error(`${where}: face ${k} has vertex index ${i} out of range 0..${n - 1}`);
    for (let t = 1; t + 1 < f.length; t++) {
      const a = remap[f[0]], c = remap[f[t]], d = remap[f[t + 1]];
      if (a === c || c === d || a === d) { dropped++; continue; }
      tri.push(a, c, d);
    }
  }
  const v = Float64Array.from(xyz);
  const faces = Uint32Array.from(tri);
  const col = Array.isArray(b.color) && b.color.length >= 3 ? b.color : null;
  const rgb = col ? col.slice(0, 3).map(c => Math.max(0, Math.min(255, Math.round(+c * 255)))) : null;
  const alpha = col && col.length > 3 ? +col[3] : 1;
  const transparency = alpha < 0.995 ? Math.max(0, Math.min(90, Math.round((1 - alpha) * 100))) : 0; // AutoCAD allows 0..90 %
  return { v, faces, rgb, transparency, dropped, srcVerts: n, srcFaces: b.f.length };
}

/** the mesh edges in AutoCAD's own order: every undirected edge once, in face order, (min, max) */
function meshEdges(faces, nv) {
  const seen = new Set();
  const out = [];
  for (let i = 0; i < faces.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      let a = faces[i + k], b = faces[i + (k + 1) % 3];
      if (a > b) [a, b] = [b, a];
      const key = a * nv + b;
      if (!seen.has(key)) { seen.add(key); out.push(a, b); }
    }
  }
  return Uint32Array.from(out);
}

const parts = [];
const asmOrder = [];
const asmInfo = new Map();
let inputErrors = 0;
for (const [pi, p] of mesh.parts.entries()) {
  const where = `part ${pi} "${p && p.part}"`;
  try {
    if (!p || typeof p.asm !== 'string' || typeof p.part !== 'string' || !Array.isArray(p.bodies)) throw new Error(`${where}: needs "asm", "part" and "bodies"`);
    if (!asmInfo.has(p.asm)) {
      const k = asmOrder.length;
      asmOrder.push(p.asm);
      asmInfo.set(p.asm, { name: p.asm, file: fileSafe(p.asm_file || p.asm), aci: LAYER_ACI[k % LAYER_ACI.length], layer: null });
    }
    const bodies = p.bodies.map((b, bi) => prepareBody(b, `${where} body ${bi}`)).filter(b => b.faces.length > 0);
    if (bodies.length === 0) { console.warn(`make_dwg: warning: ${where} has no faces, skipped`); continue; }
    if (p.asm_file) asmInfo.get(p.asm).file = fileSafe(p.asm_file);
    parts.push({ asm: p.asm, name: p.part, file: fileSafe(p.part_file || p.part), bodies });
  } catch (e) { console.error(`make_dwg: ${e.message}`); inputErrors++; }
}
mesh = null; // free the parsed JSON
if (inputErrors) { console.error(`make_dwg: ${inputErrors} part(s) could not be read; nothing written`); process.exit(1); }

// unique layer names (one per sub-assembly) and unique block names (one per part, the same in every file)
{
  const used = new Set();
  for (const a of asmOrder) {
    const info = asmInfo.get(a);
    let n = layerSafe(a), k = 2;
    const base = n;
    while (used.has(n.toLowerCase()) || n === '0' || n.toLowerCase() === 'defpoints') n = `${base}_${k++}`;
    used.add(n.toLowerCase());
    info.layer = n;
  }
  const count = new Map();
  for (const p of parts) count.set(p.file.toLowerCase(), (count.get(p.file.toLowerCase()) || 0) + 1);
  const blocks = new Set();
  for (const p of parts) {
    let n = count.get(p.file.toLowerCase()) > 1 ? `${asmInfo.get(p.asm).file}-${p.file}` : p.file; // e.g. two "Misc" parts
    const base = n;
    for (let k = 2; blocks.has(n.toLowerCase()); k++) n = `${base}_${k}`;
    blocks.add(n.toLowerCase());
    p.block = n;
  }
  const files = new Set(); // part file names, unique inside each sub-assembly folder
  for (const p of parts) {
    let n = p.file;
    const dir = asmInfo.get(p.asm).file;
    for (let k = 2; files.has(`${dir}/${n}`.toLowerCase()); k++) n = `${p.file}_${k}`;
    files.add(`${dir}/${n}`.toLowerCase());
    p.fileName = n;
  }
}
// edges for MESH, computed once
if (!usePolyface) for (const p of parts) for (const b of p.bodies) b.edges = meshEdges(b.faces, b.v.length / 3);
const tPrep = performance.now();

// ---------------------------------------------------------------------------------------- document
function bboxOf(list) {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (const p of list) for (const b of p.bodies) {
    const v = b.v;
    for (let i = 0; i < v.length; i += 3) for (let k = 0; k < 3; k++) {
      if (v[i + k] < lo[k]) lo[k] = v[i + k];
      if (v[i + k] > hi[k]) hi[k] = v[i + k];
    }
  }
  return { lo, hi };
}

/** the *Active viewport: south-west isometric view (front face, plant room on the left), zoomed to the model */
function setView(doc, box) {
  const vp = [...doc.vPorts].find(v => v.name.toLowerCase() === '*active');
  if (!vp) return;
  const c = [0, 1, 2].map(k => (box.lo[k] + box.hi[k]) / 2);
  const dir = [-1, -1, 1].map(x => x / Math.sqrt(3));
  const right = [1 / Math.SQRT2, -1 / Math.SQRT2, 0];
  const up = [dir[1] * right[2] - dir[2] * right[1], dir[2] * right[0] - dir[0] * right[2], dir[0] * right[1] - dir[1] * right[0]];
  let w = 0, h = 0;
  for (const x of [box.lo[0], box.hi[0]]) for (const y of [box.lo[1], box.hi[1]]) for (const z of [box.lo[2], box.hi[2]]) {
    const d = [x - c[0], y - c[1], z - c[2]];
    w = Math.max(w, Math.abs(d[0] * right[0] + d[1] * right[1] + d[2] * right[2]));
    h = Math.max(h, Math.abs(d[0] * up[0] + d[1] * up[1] + d[2] * up[2]));
  }
  const aspect = 1.6;
  vp.direction = new XYZ(dir[0], dir[1], dir[2]);
  vp.target = new XYZ(c[0], c[1], c[2]);
  vp.center = new XY(0, 0);
  vp.aspectRatio = aspect;
  vp.viewHeight = Math.max(2 * h, (2 * w) / aspect, 1) * 1.15;
  vp.showGrid = false;
}

/** one DWG document: the given parts, each a block inserted at the origin on its sub-assembly's layer */
function buildDocument(list, title) {
  const doc = new CadDocument();
  doc.header.version = version;
  // acad-ts 3.3.0 leaves out the dictionaries' default objects and the Model / Layout1 layouts; AutoCAD's files have them
  doc.updateCollections(true, true);
  if (doc.layouts) {
    for (const br of [doc.modelSpace, doc.paperSpace]) if (br && br.layout && !br.layout.document) doc.layouts.add(br.layout);
  }
  doc.header.insUnits = UnitsType.Millimeters; // $INSUNITS = 4
  doc.header.measurementUnits = MeasurementUnits.Metric; // $MEASUREMENT = 1
  const box = bboxOf(list);
  doc.header.modelSpaceExtMin = new XYZ(...box.lo);
  doc.header.modelSpaceExtMax = new XYZ(...box.hi);
  setView(doc, box);
  doc.summaryInfo.title = ascii(title);
  doc.summaryInfo.subject = 'Clean-room heat-recovery air-pump test rig: 3D model (MESH of the STEP solids), mm, Z up';
  doc.summaryInfo.keywords = 'clean room; heat recovery; air pump; AHU; R32; 3D';
  doc.summaryInfo.comments = 'One layer per sub-assembly, one block per part. Generated by tools/make_dwg.mjs from cad/rig-mesh.json.';

  const layers = new Map();
  for (const a of asmOrder) {
    if (!list.some(p => p.asm === a)) continue;
    const info = asmInfo.get(a);
    const L = new Layer(info.layer);
    L.color = new Color(info.aci);
    doc.layers.add(L);
    layers.set(a, L);
  }
  const stats = { blocks: 0, inserts: 0, entities: 0, vertices: 0, faces: 0, meshes: 0, polyfaces: 0 };
  const expect = new Map(); // block name -> what each of its entities must read back as
  const pfaceChildren = [];
  for (const p of list) {
    const L = layers.get(p.asm);
    const br = new BlockRecord(p.block);
    br.units = UnitsType.Millimeters;
    doc.blockRecords.add(br);
    stats.blocks++;
    const want = [];
    expect.set(p.block, want);
    for (const b of p.bodies) {
      const color = b.rgb ? new Color(b.rgb[0], b.rgb[1], b.rgb[2]) : null;
      const transparency = b.transparency ? new Transparency(b.transparency) : null;
      const style = e => { e.layer = L; if (color) e.color = color; if (transparency) e.transparency = transparency; };
      if (!usePolyface) {
        const m = new Mesh();
        m.version = 2; m.blendCrease = 0; m.subdivisionLevel = 0;
        const v = b.v, f = b.faces, ed = b.edges;
        const verts = new Array(v.length / 3);
        for (let i = 0, j = 0; i < v.length; i += 3, j++) verts[j] = new XYZ(v[i], v[i + 1], v[i + 2]);
        const faces = new Array(f.length / 3);
        for (let i = 0, j = 0; i < f.length; i += 3, j++) faces[j] = [f[i], f[i + 1], f[i + 2]];
        const edges = new Array(ed.length / 2);
        for (let i = 0, j = 0; i < ed.length; i += 2, j++) { const e = new MeshEdge(ed[i], ed[i + 1]); e.crease = 0; edges[j] = e; }
        m.vertices = verts; m.faces = faces; m.edges = edges;
        style(m);
        br.entities.add(m);
        stats.entities++; stats.meshes++; stats.vertices += verts.length; stats.faces += faces.length;
        want.push({ body: b, nv: verts.length, nf: faces.length });
      } else {
        // POLYFACE MESH: 1-based indices, at most 32767 vertices and 32767 faces per entity, so big bodies are split
        const v = b.v, f = b.faces;
        let i = 0;
        while (i < f.length) {
          const pf = new PolyfaceMesh();
          const local = new Map();
          const kids = [];
          let nf = 0;
          while (i < f.length && nf < opts.pfaceLimit) {
            let need = 0;
            for (let k = 0; k < 3; k++) if (!local.has(f[i + k])) need++;
            if (local.size + need > opts.pfaceLimit) break;
            const idx = [0, 0, 0];
            for (let k = 0; k < 3; k++) {
              const g = f[i + k];
              let j = local.get(g);
              if (j === undefined) {
                j = local.size + 1;
                local.set(g, j);
                const vx = new VertexFaceMesh(new XYZ(v[3 * g], v[3 * g + 1], v[3 * g + 2]));
                vx.flags = VertexFlags.PolygonMesh3D | VertexFlags.PolyfaceMeshVertex; // 0xC0, as AutoCAD writes it
                vx.owner = pf;
                pf.vertices.push(vx);
                kids.push(vx);
              }
              idx[k] = j;
            }
            const fr = new VertexFaceRecord();
            fr.index1 = idx[0]; fr.index2 = idx[1]; fr.index3 = idx[2]; fr.index4 = 0;
            fr.owner = pf;
            pf.faces.push(fr);
            kids.push(fr);
            nf++;
            i += 3;
          }
          if (nf === 0) throw new Error('polyface split made no progress');
          const se = new Seqend(pf);
          pf.vertices.seqend = se;
          kids.push(se);
          style(pf);
          br.entities.add(pf);
          pfaceChildren.push([kids, L, color, transparency]);
          stats.entities++; stats.polyfaces++; stats.vertices += local.size; stats.faces += nf;
          want.push({ body: b, nv: local.size, nf });
        }
      }
    }
    const ins = new Insert(br);
    ins.insertPoint = new XYZ(0, 0, 0);
    ins.layer = L;
    doc.modelSpace.entities.add(ins);
    stats.inserts++;
  }
  for (const [kids, L, color, transparency] of pfaceChildren) {
    for (const k of kids) {
      k.layer = L;
      if (color) k.color = color;
      if (transparency) k.transparency = transparency;
      doc._addCadObject(k);
    }
  }
  return { doc, stats, expect, layers: [...layers.values()].map(l => l.name) };
}

// ---------------------------------------------------------------------------------------- read-back check
/** re-read a written file with the acad-ts DwgReader and compare it, entity by entity, with what was written */
function verifyFile(file, expected, expect) {
  const buf = fs.readFileSync(file);
  const problems = [];
  const doc = DwgReader.readFromStream(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), () => {});
  if (doc.header.versionString !== opts.version) problems.push(`version ${doc.header.versionString}`);
  if (doc.header.insUnits !== UnitsType.Millimeters) problems.push(`$INSUNITS ${doc.header.insUnits}`);
  if (doc.header.measurementUnits !== MeasurementUnits.Metric) problems.push(`$MEASUREMENT ${doc.header.measurementUnits}`);
  const got = { blocks: 0, inserts: 0, entities: 0, vertices: 0, faces: 0 };
  const layerNames = new Set([...doc.layers].map(l => l.name));
  for (const l of expected.layerNames) if (!layerNames.has(l)) problems.push(`layer "${l}" missing`);
  const blockLayer = new Map();
  for (const br of doc.blockRecords) {
    if (br.name.startsWith('*')) continue;
    got.blocks++;
    const want = expect.get(br.name);
    if (!want) { problems.push(`unexpected block ${br.name}`); continue; }
    const ents = [...br.entities];
    if (ents.length !== want.length) problems.push(`${br.name}: ${ents.length} entities != ${want.length}`);
    ents.forEach((e, k) => {
      const w = want[k];
      const isMesh = e instanceof Mesh, isPface = e instanceof PolyfaceMesh;
      if (!isMesh && !isPface) { problems.push(`${br.name}: unexpected ${e.constructor.name}`); return; }
      got.entities++; got.vertices += e.vertices.length; got.faces += e.faces.length;
      if (!w) return;
      if (isMesh !== !usePolyface) problems.push(`${br.name}#${k}: ${e.constructor.name}`);
      if (e.vertices.length !== w.nv || e.faces.length !== w.nf) problems.push(`${br.name}#${k}: ${e.vertices.length}/${e.faces.length} vertices/faces != ${w.nv}/${w.nf}`);
      const b = w.body;
      if (isMesh && e.vertices.length === w.nv && e.faces.length === w.nf) { // every coordinate and index, exactly
        const v = b.v, f = b.faces;
        for (let i = 0; i < w.nv; i++) {
          const q = e.vertices[i];
          if (q.x !== v[3 * i] || q.y !== v[3 * i + 1] || q.z !== v[3 * i + 2]) { problems.push(`${br.name}#${k}: vertex ${i} differs`); break; }
        }
        for (let i = 0; i < w.nf; i++) {
          const g = e.faces[i];
          if (g.length !== 3 || g[0] !== f[3 * i] || g[1] !== f[3 * i + 1] || g[2] !== f[3 * i + 2]) { problems.push(`${br.name}#${k}: face ${i} differs`); break; }
        }
      }
      if (b.rgb) {
        const rgb = e.color.isTrueColor ? e.color.getTrueColorRgb() : null;
        if (!rgb || rgb.join() !== b.rgb.join()) problems.push(`${br.name}#${k}: colour ${rgb ? rgb.join() : 'ACI ' + e.color.index} != ${b.rgb.join()}`);
      }
      const tr = e.transparency && !e.transparency.isByLayer ? e.transparency.value : 0;
      if (Math.abs(tr - b.transparency) > 1) problems.push(`${br.name}#${k}: transparency ${tr} != ${b.transparency}`);
      blockLayer.set(br.name, e.layer && e.layer.name);
    });
  }
  for (const e of doc.modelSpace.entities) {
    if (!(e instanceof Insert)) { problems.push(`unexpected ${e.constructor.name} in model space`); continue; }
    got.inserts++;
    const n = e.block && e.block.name;
    if (!expect.has(n)) problems.push(`insert of unknown block ${n}`);
    else if (e.layer.name !== blockLayer.get(n)) problems.push(`insert of ${n} on layer ${e.layer.name}, its bodies on ${blockLayer.get(n)}`);
    if (e.insertPoint.x !== 0 || e.insertPoint.y !== 0 || e.insertPoint.z !== 0) problems.push(`insert of ${n} not at the origin`);
  }
  for (const k of ['blocks', 'inserts', 'entities', 'vertices', 'faces']) if (got[k] !== expected[k]) problems.push(`${k} ${got[k]} != ${expected[k]}`);
  return problems;
}

// ---------------------------------------------------------------------------------------- write everything
const jobs = [];
for (const a of asmOrder) {
  const info = asmInfo.get(a);
  const sub = parts.filter(p => p.asm === a);
  if (sub.length === 0) continue;
  for (const p of sub) jobs.push({ file: path.join(outDir, 'parts', info.file, `${p.fileName}.dwg`), list: [p], title: `${p.name} (${a})`, kind: 'part' });
  jobs.push({ file: path.join(outDir, 'sub-assemblies', `${info.file}.dwg`), list: sub, title: `Sub-assembly: ${a}`, kind: 'sub-assembly' });
}
const plant = parts.filter(p => PLANT_ASMS.includes(p.asm));
const missingPlant = PLANT_ASMS.filter(a => !asmInfo.has(a));
if (missingPlant.length) console.warn(`make_dwg: warning: plant sub-assemblies not in the mesh: ${missingPlant.join('; ')}`);
if (plant.length) jobs.push({ file: path.join(outDir, PLANT_FILE), list: plant, title: 'Plant system: AHU and air-pump unit in parallel', kind: 'plant' });
jobs.push({ file: path.join(outDir, ASSEMBLY_FILE), list: parts, title: 'Clean-room heat-recovery air-pump test rig', kind: 'assembly' });

const results = [];
let failures = plant.length ? 0 : 1;
if (!plant.length) console.error(`make_dwg: none of the plant sub-assemblies (${PLANT_ASMS.join('; ')}) is in the mesh; ${PLANT_FILE} not written`);
let tWrite = 0, tVerify = 0;
/** build, write and drop one document (so that it can be garbage-collected before the read-back) */
function writeJob(job) {
  const { doc, stats, expect, layers } = buildDocument(job.list, job.title);
  const buf = DwgWriter.writeToBuffer(doc);
  fs.mkdirSync(path.dirname(job.file), { recursive: true });
  fs.writeFileSync(job.file, buf);
  return { stats, expect, layers, bytes: buf.length };
}
for (const job of jobs) {
  const r = { ...job, list: undefined, bytes: 0, problems: [] };
  try {
    const t1 = performance.now();
    const { stats, expect, layers, bytes } = writeJob(job);
    Object.assign(r, stats, { bytes, layerNames: layers });
    const t2 = performance.now();
    tWrite += t2 - t1;
    if (opts.verify) {
      r.problems = verifyFile(job.file, r, expect);
      tVerify += performance.now() - t2;
    }
  } catch (e) {
    r.problems.push(String(e && e.stack || e));
  }
  if (r.problems.length) { failures++; console.error(`make_dwg: FAILED ${job.file}: ${r.problems.join('; ')}`); }
  results.push(r);
}

// ---------------------------------------------------------------------------------------- summary
const sum = (k, rs = results) => rs.reduce((s, r) => s + (r[k] || 0), 0);
const mb = n => (n / 1e6).toFixed(n < 1e5 ? 3 : 1) + ' MB';
const fmt = n => n.toLocaleString('en-US');
const entity = usePolyface ? 'POLYFACE MESH' : 'MESH (AcDbSubDMesh)';
console.log(`3D DWG ${opts.version} (${VERSIONS[opts.version]}), ${entity}, mm, Z up -> ${outDir}`);
for (const r of results.filter(r => r.kind !== 'part')) {
  console.log(`  ${path.relative(outDir, r.file).padEnd(64)} ${String(r.blocks || 0).padStart(4)} blocks ${String(fmt(r.entities || 0)).padStart(6)} entities ${String(fmt(r.vertices || 0)).padStart(9)} vertices ${String(fmt(r.faces || 0)).padStart(9)} faces ${mb(r.bytes).padStart(9)}${r.problems.length ? '  FAILED' : ''}`);
}
const partsRes = results.filter(r => r.kind === 'part');
console.log(`  ${('parts/<sub-assembly>/<part>.dwg x ' + partsRes.length).padEnd(64)} ${String(sum('blocks', partsRes)).padStart(4)} blocks ${String(fmt(sum('entities', partsRes))).padStart(6)} entities ${String(fmt(sum('vertices', partsRes))).padStart(9)} vertices ${String(fmt(sum('faces', partsRes))).padStart(9)} faces ${mb(sum('bytes', partsRes)).padStart(9)}`);
console.log(`  ${results.length} files, ${mb(sum('bytes'))}; ${parts.length} parts, ${asmOrder.length} sub-assemblies; ` +
  `prepare ${((tPrep - t0) / 1000).toFixed(1)} s, write ${(tWrite / 1000).toFixed(1)} s` +
  (opts.verify ? `, read-back check ${(tVerify / 1000).toFixed(1)} s (${failures ? failures + ' FAILED' : 'all OK'})` : ', not re-read (--no-verify)') +
  `; peak RSS ${Math.round(process.resourceUsage().maxRSS / 1024)} MB`);
if (failures) { console.error(`make_dwg: ${failures} failure(s)`); process.exit(1); }
