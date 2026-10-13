/* Dump the simulator's solids to JSON for tools/build_cad.py.
   Needs Node 18+ and Playwright with a Chromium build:
     npm i -D playwright && npx playwright install chromium
     node tools/export_geometry.js cad/rig-geometry.json
   Set CHROMIUM=/path/to/chrome to use a browser that is already installed. */
const http = require("http");
const fs = require("fs");
const path = require("path");
let chromium;
try { ({ chromium } = require("playwright")); }
catch (e) { ({ chromium } = require(path.join(process.env.NODE_PATH || "/opt/node22/lib/node_modules", "playwright"))); }

const root = path.resolve(__dirname, "..");
const out = path.resolve(process.argv[2] || path.join(root, "cad", "rig-geometry.json"));
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".json": "application/json" };

const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split("?")[0]));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(p)] || "application/octet-stream" });
  fs.createReadStream(p).pipe(res);
});

server.listen(0, async () => {
  const port = server.address().port;
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM || undefined,
    args: ["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"]
  });
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  page.on("pageerror", (e) => console.error("page error:", e.message));
  await page.goto(`http://localhost:${port}/index.html`, { waitUntil: "load" });
  await page.waitForFunction(() => typeof window.__rigExportCAD === "function", null, { timeout: 30000 });
  const data = await page.evaluate(() => window.__rigExportCAD());
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(data));
  console.log(`wrote ${data.length} solids to ${path.relative(root, out)}`);
  await browser.close();
  server.close();
});
