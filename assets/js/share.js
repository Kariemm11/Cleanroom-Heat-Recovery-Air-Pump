/* Share bridge for the clean-room rig (adapted from the project site's sim bridge).
   - Reads settings from the URL (?season=summer&flow=8&oat=35 …) and applies them.
   - Builds a share link + QR code holding the current settings.
   - Adds a small toolbar (project site, share) when opened directly.
   Parameter names come from the control ids: segSeason → season, inFlow → flow,
   rngSpd → spd, unchecked boxes → hide=ribbon,arrows. */
(function () {
  "use strict";

  var CANON = "https://kariemm11.github.io/Cleanroom-Heat-Recovery-Air-Pump/";
  var PROJECT = "https://kariemm11.github.io/Sustainble-Heat-Recovery-Air-Pump-In-HVAC-Systems-On-Pharmaceutical-Facilities/";
  var embedded = false;
  try { embedded = window.self !== window.top; } catch (e) { embedded = true; }

  var file = location.pathname.split("/").pop() || "index.html";
  var root = document.documentElement;
  var params = new URLSearchParams(location.search);

  /* ---------------------------------------------------------------- theme */
  function setTheme(t) {
    if (t === "dark" || t === "light") root.setAttribute("data-theme", t);
  }
  var storedTheme = null;
  try { storedTheme = localStorage.getItem("hr-theme"); } catch (e) {}
  setTheme(params.get("theme") || storedTheme);
  window.addEventListener("message", function (e) {
    if (e.data && e.data.type === "hr-theme") setTheme(e.data.value);
  });

  /* ------------------------------------------------------- control lookup */
  function cap(k) { return k.charAt(0).toUpperCase() + k.slice(1); }
  function rail() { return document.getElementById("rail") || document; }
  function segs() { return Array.prototype.slice.call(rail().querySelectorAll(".seg[id^=seg]")); }
  function nums() { return Array.prototype.slice.call(rail().querySelectorAll("input[type=number][id^=in]")); }
  function ranges() { return Array.prototype.slice.call(rail().querySelectorAll("input[type=range][id^=rng]")); }
  function checks() { return Array.prototype.slice.call(rail().querySelectorAll("input[type=checkbox][id^=cb]")); }
  function segVal(s) { var b = s.querySelector('button[aria-pressed="true"]'); return b ? b.dataset.v : null; }
  function keyOf(el, prefix) { return el.id.slice(prefix.length).toLowerCase(); }

  function snapshot() {
    var s = { seg: {}, num: {}, rng: {}, cb: {} };
    segs().forEach(function (x) { s.seg[keyOf(x, "seg")] = segVal(x); });
    nums().forEach(function (x) { s.num[keyOf(x, "in")] = x.value; });
    ranges().forEach(function (x) { s.rng[keyOf(x, "rng")] = x.value; });
    checks().forEach(function (x) { s.cb[keyOf(x, "cb")] = x.checked; });
    return s;
  }
  var defaults = snapshot();

  /* ------------------------------------------------------ apply from URL */
  function applyParams(p) {
    var segKeys = segs().map(function (x) { return keyOf(x, "seg"); });
    // season first: it reloads the per-season design values
    segKeys.sort(function (a, b) { return (b === "season") - (a === "season"); });
    segKeys.forEach(function (k) {
      if (!p.has(k)) return;
      var seg = document.getElementById("seg" + cap(k));
      var btn = seg && seg.querySelector('button[data-v="' + CSS.escape(p.get(k)) + '"]');
      if (btn) btn.click();
    });
    nums().concat(ranges()).forEach(function (el) {
      var k = keyOf(el, el.type === "range" ? "rng" : "in");
      if (!p.has(k)) return;
      var v = parseFloat(p.get(k));
      if (isNaN(v)) return;
      el.value = v;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    function boxes(list, on) {
      (list || "").split(",").forEach(function (k) {
        var el = k && document.getElementById("cb" + cap(k.trim()));
        if (el && el.checked !== on) { el.checked = on; el.dispatchEvent(new Event("change", { bubbles: true })); }
      });
    }
    boxes(p.get("hide"), false);
    boxes(p.get("show"), true);
  }
  try { applyParams(params); } catch (e) { /* a bad link should never break the page */ }

  /* ------------------------------------------------------- share building */
  function pageURL() {
    var local = !/^https?:$/.test(location.protocol) || /^(localhost|127\.|0\.0\.0\.0|\[::1\])/.test(location.hostname);
    return local ? CANON : location.origin + location.pathname;
  }
  function shareURL() {
    var now = snapshot(), q = new URLSearchParams(), hide = [], show = [];
    Object.keys(now.seg).forEach(function (k) { if (now.seg[k] !== defaults.seg[k]) q.set(k, now.seg[k]); });
    // after a season change every design value is meaningful, so keep them all
    var seasonChanged = now.seg.season && now.seg.season !== defaults.seg.season;
    Object.keys(now.num).forEach(function (k) { if (seasonChanged || now.num[k] !== defaults.num[k]) q.set(k, now.num[k]); });
    Object.keys(now.rng).forEach(function (k) { if (now.rng[k] !== defaults.rng[k]) q.set(k, now.rng[k]); });
    Object.keys(now.cb).forEach(function (k) {
      if (now.cb[k] !== defaults.cb[k]) (now.cb[k] ? show : hide).push(k);
    });
    if (hide.length) q.set("hide", hide.join(","));
    if (show.length) q.set("show", show.join(","));
    var qs = q.toString();
    return pageURL() + (qs ? "?" + qs : "");
  }

  function drawQR(canvas, text, dark, light) {
    var qr = window.qrcode(0, "M");
    qr.addData(text); qr.make();
    var n = qr.getModuleCount(), quiet = 3, cell = Math.max(3, Math.floor(600 / (n + quiet * 2)));
    var size = cell * (n + quiet * 2);
    canvas.width = canvas.height = size;
    var c = canvas.getContext("2d");
    c.fillStyle = light; c.fillRect(0, 0, size, size);
    c.fillStyle = dark;
    for (var r = 0; r < n; r++) for (var k = 0; k < n; k++) {
      if (qr.isDark(r, k)) c.fillRect((k + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }

  window.SimBridge = { shareURL: shareURL, apply: applyParams, drawQR: drawQR, setTheme: setTheme };
  if (embedded) return;

  /* ------------------------------------------------------------ toolbar */
  var css = document.createElement("style");
  css.textContent = [
    ".hrbar{position:absolute;top:12px;left:50%;transform:translate(-50%,-8px);z-index:4;display:flex;gap:4px;align-items:center;",
    "background:var(--panel);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--line);border-radius:999px;padding:4px;",
    "box-shadow:var(--shadow);opacity:0;animation:hrIn .6s .3s cubic-bezier(.2,.8,.2,1) forwards;font-family:var(--f-body)}",
    "@keyframes hrIn{to{opacity:1;transform:translate(-50%,0)}}",
    ".hrbar a,.hrbar button{display:inline-flex;align-items:center;gap:6px;border:0;background:transparent;color:var(--ink);text-decoration:none;",
    "font-size:12px;font-weight:600;padding:6px 11px;border-radius:999px;cursor:pointer;white-space:nowrap;transition:background .2s,color .2s}",
    ".hrbar a:hover,.hrbar button:hover{background:var(--line-soft)}",
    ".hrbar .on{background:var(--ink);color:var(--panel-solid)}",
    ".hrbar .share{background:var(--fresh);color:#fff}",
    ".hrbar .share:hover{background:var(--fresh);filter:brightness(1.1)}",
    ".hrbar svg{width:14px;height:14px;flex:none}",
    ".hrbar .sims{display:flex;gap:2px}",
    "@media (max-width:1320px){.hrbar .sims{display:none}}",
    "@media (max-width:760px){.hrbar{top:auto;bottom:12px;left:12px;transform:translateY(8px)}@keyframes hrIn{to{opacity:1;transform:none}}}",
    ".hrmodal{position:fixed;inset:0;z-index:50;display:grid;place-items:center;padding:16px;background:rgba(5,10,16,.55);",
    "backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px);opacity:0;transition:opacity .25s}",
    ".hrmodal.open{opacity:1}",
    ".hrcard{width:min(380px,100%);background:var(--panel-solid);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:18px;",
    "box-shadow:0 30px 80px rgba(0,0,0,.4);transform:translateY(16px) scale(.97);transition:transform .35s cubic-bezier(.2,.8,.2,1);font-family:var(--f-body)}",
    ".hrmodal.open .hrcard{transform:none}",
    ".hrcard h3{margin:0 0 4px;font-family:var(--f-disp);font-size:20px;text-transform:uppercase;letter-spacing:.03em}",
    ".hrcard p{margin:0 0 12px;font-size:12px;color:var(--ink-dim);line-height:1.5}",
    ".hrcard canvas{width:100%;height:auto;border-radius:10px;display:block;image-rendering:pixelated}",
    ".hrcard .url{margin:12px 0;font-family:var(--f-mono);font-size:11px;padding:8px;border:1px solid var(--line);border-radius:8px;",
    "word-break:break-all;max-height:72px;overflow:auto;color:var(--ink-dim)}",
    ".hrcard .acts{display:grid;grid-template-columns:1fr 1fr;gap:6px}",
    ".hrcard .acts button{border:1px solid var(--line);background:transparent;border-radius:8px;padding:9px;font-size:12px;font-weight:600;cursor:pointer}",
    ".hrcard .acts button.pri{background:var(--ink);color:var(--panel-solid);border-color:var(--ink)}",
    ".hrcard .acts button.wide{grid-column:1/-1}"
  ].join("");
  document.head.appendChild(css);

  var ICON_HOME = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
  var ICON_QR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3"/></svg>';

  var bar = document.createElement("nav");
  bar.className = "hrbar";
  bar.setAttribute("aria-label", "Project navigation");
  bar.innerHTML = '<a href="' + PROJECT + '#simulators" target="_blank" rel="noopener">' + ICON_HOME + 'Project site</a>' +
    '<button class="share" type="button">' + ICON_QR + "Share / QR</button>";
  (document.getElementById("stage") || document.body).appendChild(bar);

  function openShare() {
    var url = shareURL();
    var m = document.createElement("div");
    m.className = "hrmodal";
    m.setAttribute("role", "dialog");
    m.setAttribute("aria-modal", "true");
    m.innerHTML = '<div class="hrcard"><h3>Share this setup</h3>' +
      "<p>Scan to open the rig simulator on a phone with the same settings, then keep adjusting the variables there.</p>" +
      '<canvas aria-label="QR code"></canvas><div class="url"></div>' +
      '<div class="acts"><button class="pri" data-a="copy">Copy link</button><button data-a="png">Download QR</button>' +
      (navigator.share ? '<button data-a="native">Share…</button>' : "") +
      '<button data-a="close"' + (navigator.share ? "" : ' class="wide"') + ">Close</button></div></div>";
    document.body.appendChild(m);
    m.querySelector(".url").textContent = url;
    var cv = m.querySelector("canvas");
    drawQR(cv, url, "#0b1622", "#ffffff");
    requestAnimationFrame(function () { m.classList.add("open"); });
    function close() { m.classList.remove("open"); setTimeout(function () { m.remove(); }, 260); document.removeEventListener("keydown", esc); }
    function esc(e) { if (e.key === "Escape") close(); }
    document.addEventListener("keydown", esc);
    m.addEventListener("click", function (e) {
      if (e.target === m) return close();
      var b = e.target.closest("button"); if (!b) return;
      var a = b.dataset.a;
      if (a === "close") close();
      if (a === "copy") {
        (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(
          function () { b.textContent = "Copied ✓"; },
          function () { b.textContent = "Select the link above"; });
      }
      if (a === "png") {
        var l = document.createElement("a");
        l.download = "cleanroom-rig-qr.png"; l.href = cv.toDataURL("image/png"); l.click();
      }
      if (a === "native") navigator.share({ title: document.title, url: url }).catch(function () {});
    });
    m.querySelector('[data-a="copy"]').focus();
  }
  bar.querySelector(".share").addEventListener("click", openShare);
})();
