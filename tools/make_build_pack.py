"""Builds the derived build-pack files:
  - build-pack/10-simulator-standalone.html  (the simulator with all scripts inlined, works offline)
  - build-pack/*.pdf                          (calculations, commissioning, PCB/harness, wiring diagrams)
Needs: python-markdown, Node + Playwright with Chromium (CHROMIUM env var or /opt/pw-browsers/chromium).
Usage:  python3 tools/make_build_pack.py
"""
import os, re, subprocess, tempfile, json
import markdown

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BP = os.path.join(ROOT, "build-pack")
CHROMIUM = os.environ.get("CHROMIUM", "/opt/pw-browsers/chromium")
PW = os.environ.get("PLAYWRIGHT", "/opt/node22/lib/node_modules/playwright")


def standalone():
    html = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    def inline(m):
        src = m.group(1).split("?")[0]
        js = open(os.path.join(ROOT, src), encoding="utf-8").read().replace("</script", "<\\/script")
        return "<script>/* " + src + " */\n" + js + "\n</script>"
    html = re.sub(r'<script src="([^"]+)"></script>', inline, html)
    out = os.path.join(BP, "10-simulator-standalone.html")
    open(out, "w", encoding="utf-8").write(html)
    print("wrote", os.path.relpath(out, ROOT), f"{os.path.getsize(out) / 1e6:.1f} MB")


CSS = """
@page { size: A4; margin: 16mm 14mm; }
body { font: 10.5pt/1.45 "IBM Plex Sans", "DejaVu Sans", Arial, sans-serif; color: #111827; }
h1 { font-size: 19pt; margin: 0 0 8pt; } h2 { font-size: 14pt; margin: 16pt 0 6pt; border-bottom: 1px solid #d1d5db; padding-bottom: 3pt; }
h3 { font-size: 11.5pt; } table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; font-size: 8.6pt; page-break-inside: auto; }
th, td { border: 1px solid #d1d5db; padding: 3pt 4pt; vertical-align: top; } th { background: #f3f4f6; text-align: left; }
tr { page-break-inside: avoid; } pre { background: #f8fafc; border: 1px solid #e5e7eb; padding: 6pt 8pt; font-size: 8.4pt; white-space: pre-wrap; page-break-inside: avoid; }
code { font-family: "DejaVu Sans Mono", monospace; font-size: 8.8pt; } blockquote { border-left: 3px solid #b45309; margin: 8pt 0; padding: 2pt 10pt; background: #fffbeb; }
a { color: #0369a1; text-decoration: none; } .foot { color: #6b7280; font-size: 8pt; margin-top: 18pt; }
"""


def md_html(path, title):
    text = open(path, encoding="utf-8").read()
    body = markdown.markdown(text, extensions=["tables", "fenced_code"])
    return (f"<!doctype html><html><head><meta charset='utf-8'><title>{title}</title><style>{CSS}</style></head><body>{body}"
            f"<p class='foot'>Clean-room heat-recovery air-pump rig · Eng. Kariem Moussa · GIU · generated from {os.path.basename(path)}</p></body></html>")


def pdfs():
    jobs = []
    tmp = tempfile.mkdtemp()
    for md, title in [("07-engineering-calculations.md", "Engineering calculations"), ("08-build-and-commissioning.md", "Build and commissioning"),
                      ("04-pcb-and-harness.md", "PCB and harness")]:
        h = os.path.join(tmp, md.replace(".md", ".html"))
        open(h, "w", encoding="utf-8").write(md_html(os.path.join(BP, md), title))
        jobs.append({"src": h, "out": os.path.join(BP, md.replace(".md", ".pdf")), "a3": False})
    svgs = "".join(f"<div class='pg'>{open(os.path.join(BP, f), encoding='utf-8').read()}</div>" for f in ["03-wiring-power.svg", "03-wiring-controller.svg"])
    h = os.path.join(tmp, "wiring.html")
    open(h, "w", encoding="utf-8").write("<!doctype html><html><head><meta charset='utf-8'><style>@page{size:A3 landscape;margin:0}body{margin:0}"
                                         ".pg{width:420mm;height:297mm;page-break-after:always;overflow:hidden}.pg svg{width:420mm;height:297mm}</style></head><body>" + svgs + "</body></html>")
    jobs.append({"src": h, "out": os.path.join(BP, "03-wiring-diagrams.pdf"), "a3": True})
    # 2D views of the whole rig and of every sub-assembly (written by tools/build_cad.py), and the enclosure drawing
    vdir = os.path.join(ROOT, "cad", "drawings", "views")
    if os.path.isdir(vdir):
        svgs = "".join(f"<div class='pg'>{open(os.path.join(vdir, f), encoding='utf-8').read()}</div>" for f in sorted(os.listdir(vdir)) if f.endswith(".svg"))
        h = os.path.join(tmp, "views.html")
        open(h, "w", encoding="utf-8").write("<!doctype html><html><head><meta charset='utf-8'><style>@page{size:A3 landscape;margin:0}body{margin:0}"
                                             ".pg{width:420mm;height:297mm;page-break-after:always;overflow:hidden}.pg svg{width:420mm;height:297mm}</style></head><body>" + svgs + "</body></html>")
        jobs.append({"src": h, "out": os.path.join(ROOT, "cad", "drawings", "rig-2D-views.pdf"), "a3": True})
    ga = os.path.join(ROOT, "cad", "drawings", "enclosure-GA.svg")
    h = os.path.join(tmp, "ga.html")
    open(h, "w", encoding="utf-8").write("<!doctype html><html><head><meta charset='utf-8'><style>@page{size:A2 landscape;margin:0}body{margin:0}"
                                         "svg{width:594mm;height:420mm}</style></head><body>" + open(ga, encoding="utf-8").read() + "</body></html>")
    jobs.append({"src": h, "out": os.path.join(ROOT, "cad", "drawings", "enclosure-GA.pdf"), "a3": True})
    js = os.path.join(tmp, "pdf.js")
    open(js, "w").write(
        "const { chromium } = require(%s);\n(async () => {\n  const b = await chromium.launch({ executablePath: %s });\n"
        "  for (const j of %s) { const p = await b.newPage(); await p.goto('file://' + j.src); await p.waitForTimeout(300);\n"
        "    await p.pdf({ path: j.out, preferCSSPageSize: true, printBackground: true }); await p.close(); console.log('wrote ' + j.out); }\n"
        "  await b.close();\n})();\n" % (json.dumps(PW), json.dumps(CHROMIUM), json.dumps(jobs)))
    subprocess.run(["node", js], check=True)


if __name__ == "__main__":
    standalone()
    pdfs()
