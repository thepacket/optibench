import { createInstrumentWorkspace } from "./instrument-ui.js";
import { bindWorkspaceLayout } from "./workspace-layout.js";
import { bindResultsSplitter } from "./results-splitter.js";
import { createPracticeWorkspace } from "./alignment-practice-ui.js";
import { createGuidedWorkspace } from "./guided-ui.js";
import { createAcceptanceWorkspace } from "./acceptance-ui.js";
import { TaskWorker } from "./task-worker.js";
import { createProjectNavigator } from "./project-navigator-ui.js";
import { createLayout } from "./project-navigator.js";
import { archiveStore } from "./run-store.js";
import { createAlignmentStudyWorkspace } from "./alignment-study-ui.js";
import { createSimulationWorkspace } from "./simulation-ui.js";
import { createValidationCenter } from "./validation-ui.js";
import {
  mountModels,
  mechanicalChecks,
  alignmentTargets,
  pairAlignment,
  stageMove,
} from "./alignment.js";
import { createMetrologyWorkspace } from "./metrology-ui.js";
import { catalog, categories, sources, instantiate } from "./catalog.js";
import {
  makeProject,
  templates,
  validateProject,
  resampleImage,
  ENGINE_VERSION,
} from "./project.js";
import {
  trace,
  beamRadius,
  waistInfo,
  layoutChecks,
  clamp,
  distance,
  monteCarlo,
  designExpander,
} from "./optics.js";
import { coherentField, measureFringes, phaseScan } from "./interferometry.js";
import { cameraResponse } from "./wave.js";
import { icon, typeIcon } from "./icons.js";
const $ = (s) => document.querySelector(s),
  esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
const fmt = (v, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : "—");
const pct = (v) => fmt(v * 100, 1) + "%";
const storeKey = "optibench-lab-v2";
let project = validateProject(makeProject()),
  restoreMessage = "";
try {
  const saved = localStorage.getItem(storeKey);
  if (saved) {
    project = validateProject(JSON.parse(saved));
    restoreMessage = "Restored this browser’s last project.";
  }
} catch {
  restoreMessage =
    "The saved draft could not be restored. Your project file can still be opened.";
}
let activeBranch = null;
let sideAxis = "x",
  alignmentAngleStep = 0.01,
  alignmentPositionStep = 0.1;
let fringeCache = null,
  fringeScan = null;
let selected = new Set([project.items[1]?.id].filter(Boolean)),
  mode = project.solver || "Gaussian",
  running = true,
  tool = "select",
  query = "",
  category = "All components",
  brand = "All manufacturers",
  scope = "All entries",
  sort = "recommended",
  resultTab = project.solver === "Alignment" ? "alignment" : "detector",
  activeDetector = null,
  result,
  rayResult,
  waveResult = null,
  waveError = "",
  waveBusy = false,
  job = 0,
  worker = null,
  history = [],
  redo = [],
  view = { x: -80, y: -80, w: 1660, h: 1060 },
  compare = new Set(),
  pendingPart = null,
  measureStart = null,
  showRays = true,
  showEnvelope = true,
  showLabels = true,
  showGrid = true,
  showResults = typeof innerHeight === "undefined" || innerHeight >= 700,
  logScale = false,
  noise = true,
  autoTimer,
  toastTimer,
  frame,
  dragState = null,
  saveStatus = "Saved in this browser";
try {
  worker = new Worker("./wave-worker.js", { type: "module" });
  worker.onmessage = (e) => {
    if (e.data.job !== job) return;
    waveBusy = false;
    waveError = e.data.error || "";
    waveResult = e.data.result || null;
    renderResults();
    renderStatus();
  };
  worker.onerror = () => {
    waveBusy = false;
    waveError =
      "The Fourier worker could not start. Reload the app and try again.";
    renderResults();
  };
} catch {
  waveError = "This browser cannot run the Fourier worker.";
}
function snapshot() {
  return JSON.stringify(project);
}
function checkpoint() {
  history.push(snapshot());
  if (history.length > 50) history.shift();
  redo = [];
}
function saveLocal() {
  try {
    localStorage.setItem(storeKey, snapshot());
    saveStatus = "Saved in this browser";
  } catch {
    saveStatus = "Local storage full — download your project";
  }
  $("#save-state").textContent = saveStatus;
}
function commit() {
  project = validateProject(project);
  saveLocal();
  waveResult = null;
  waveError = "";
  compute();
  renderPanels();
  if (mode === "Fourier") scheduleWave();
}
function notify(message) {
  $("#toast").textContent = message;
  $("#toast").classList.add("visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $("#toast").classList.remove("visible"), 3800);
}
function button(action, label, ico = "", cls = "", extra = "") {
  return `<button type="button" data-action="${action}" class="${cls}" ${extra}>${ico ? icon(ico) : ""}${label ? `<span>${label}</span>` : ""}</button>`;
}
function iconButton(action, label, ico, cls = "") {
  return button(
    action,
    "",
    ico,
    `icon-button ${cls}`,
    `title="${esc(label)}" aria-label="${esc(label)}"`,
  );
}
function selectedItem() {
  return project.items.find((c) => selected.has(c.id));
}
function nextId() {
  return Math.max(0, ...project.items.map((c) => c.id)) + 1;
}
function compute(force = false) {
  if (!force && !running && result) return;
  result = trace(project);
  rayResult = mode === "Rays" ? trace(project, { rays: true }) : null;
  const valid = project.items.filter(
    (c) => ["screen", "camera", "power"].includes(c.type) && c.enabled,
  );
  if (!valid.some((c) => c.id === activeDetector))
    activeDetector = valid[0]?.id ?? null;
}
function fit() {
  const ratio =
    ($("#stage")?.clientWidth || 900) / ($("#stage")?.clientHeight || 450);
  const w = project.table.width + 120,
    h = project.table.height + 120;
  view = { x: -60, y: -60, w, h };
  if (w / h < ratio) {
    view.w = h * ratio;
    view.x = (project.table.width - view.w) / 2;
  } else {
    view.h = w / ratio;
    view.y = (project.table.height - view.h) / 2;
  }
  drawBench();
}
function mount() {
  document.title = "OptiBench · Laboratory workspace";
  $("#app").innerHTML =
    `<header class="app-header"><a class="brand" href="#" aria-label="OptiBench">${icon("lens", 31)}<strong>opti<span>bench</span></strong><small>LAB</small></a><div class="project-heading">${icon("folder")}<button data-action="project">${esc(project.title)}</button><span class="local-badge">LOCAL PROJECT</span></div><div class="top-actions">${button("open", "Open", "folder")}${button("save", "Save file", "save", "outline")}${iconButton("guide", "Model documentation & keyboard shortcuts", "book")}</div></header><div class="app-layout"><nav class="rail" aria-label="Workspace navigation">${[
      ["bench", "table", "Bench"],
      ["projects", "folder", "Projects"],
      ["first-experiment", "play", "First lab"],
      ["instrument-lab", "grid", "Experiment"],
      ["alignment-practice", "target", "Practice"],
      ["templates", "book", "Setups"],
      ["design", "bolt", "Design"],
      ["analysis", "chart", "Analysis"],
      ["simulation-runs", "play", "Simulate"],
      ["measurements", "camera", "Measure"],
      ["validation", "info", "Validate"],
      ["bom", "parts", "Parts"],
    ]
      .map(([a, i, t]) => button(a, t, i, a === "bench" ? "active" : ""))
      .join(
        "",
      )}<div class="rail-spacer"></div>${button("table", "Table", "settings")}${button("guide", "Guide", "info")}</nav><aside class="library panel" id="library-panel"><div class="panel-title"><h2>Component inventory</h2></div><div class="inventory-summary"><strong>${catalog.length}</strong> entries <span>·</span> <strong>${catalog.filter((c) => c.provenance !== "ideal").length}</strong> manufacturer references</div><label class="searchbox">${icon("search")}<input id="search" aria-label="Search inventory" placeholder="Part number or component…" value="${esc(query)}"><kbd>⌘K</kbd></label><div class="library-filters"><select id="category" aria-label="Component category">${categories.map((c) => `<option ${category === c ? "selected" : ""}>${c}</option>`).join("")}</select><select id="brand" aria-label="Manufacturer">${["All manufacturers", "Thorlabs", "Edmund Optics", "Newport", "OptiBench", "Custom"].map((c) => `<option ${brand === c ? "selected" : ""}>${c}</option>`).join("")}</select><select id="scope" aria-label="Catalog provenance">${["All entries", "Manufacturer references", "Ideal designs"].map((c) => `<option ${scope === c ? "selected" : ""}>${c}</option>`).join("")}</select></div><div class="inventory-sort"><span id="catalog-count"></span><select id="sort" aria-label="Sort inventory"><option value="recommended">Recommended</option><option value="focal">Focal length ↑</option><option value="diameter">Diameter ↑</option><option value="part">Part number</option></select></div><div id="catalog-list" class="catalog-list"></div><div class="library-footer">${button("custom", "Custom component", "plus")}${button("compare", "Compare (0)", "parts", "", 'id="compare-button"')}${button("import-catalog", "Import catalog JSON", "folder")}</div></aside><main class="workspace"><div class="workspace-heading"><div><p class="eyebrow">OPTICAL DESIGN WORKSPACE</p><h1 id="project-title">${esc(project.title)}</h1></div><div class="workspace-actions">${iconButton("undo", "Undo · Ctrl/Cmd Z", "undo")}${iconButton("redo", "Redo · Ctrl/Cmd Shift Z", "redo")}<span class="separator"></span>${button("run", "Pause", "pause", "accent", 'id="run-button"')}</div></div><div class="workbar"><div class="tools" role="group" aria-label="Table tools">${iconButton("tool-select", "Select & move · V", "cursor", "active")}${iconButton("tool-pan", "Pan table · H / middle-drag", "hand")}${iconButton("tool-measure", "Measure distance · M", "ruler")}<span class="separator"></span>${iconButton("fit", "Fit entire table · F", "fit")}${iconButton("grid", "Toggle mounting holes", "grid", "active")}</div><div class="mode-controls"><select id="mode" aria-label="Physics engine"><option>Gaussian</option><option>Rays</option><option>Fourier</option><option>Interferometry</option><option>Alignment</option></select><span class="mode-indicator" id="mode-indicator">ABCD + 2D PATH</span></div><div class="panel-toggles" role="group" aria-label="Side panels">${button("library", "Inventory", "lens", "compact inventory-toggle", 'aria-controls="library-panel" aria-pressed="false"')}${button("inspect", "Inspector", "settings", "compact inspector-toggle", 'aria-controls="inspector-panel" aria-pressed="false"')}</div></div><div class="bench-stage" id="stage"><svg id="bench" xmlns="http://www.w3.org/2000/svg" aria-label="Laboratory optical table" tabindex="0"></svg><div class="canvas-top"><span id="table-label"></span><span id="coordinate-readout">X — &nbsp; Y — mm</span></div><div class="canvas-bottom"><div class="view-options"><label><input type="checkbox" id="envelope" checked>Envelope</label><label><input type="checkbox" id="labels" checked>Labels</label><button data-action="table">Table settings</button></div><div class="zoom-control">${button("zoom-out", "−")}<span id="zoom-readout">100%</span>${button("zoom-in", "+")}${iconButton("fit", "Fit table", "fit")}</div></div><div id="placement-hint" class="placement-hint" hidden></div></div><div id="results-splitter" role="separator" tabindex="0" aria-orientation="horizontal" aria-label="Resize workbench and detector results" aria-controls="results-panel" title="Drag to resize · Arrow keys to adjust · Double-click to reset"><span></span></div><section class="results-panel" id="results-panel"><div class="results-heading"><div class="result-tabs">${[
      ["detector", "Detector"],
      ["envelope", "Propagation"],
      ["alignment", "Alignment"],
      ["paths", "Optical path"],
      ["checks", "Design checks"],
    ]
      .map(
        ([a, t]) =>
          `<button data-action="result-${a}" class="${a === resultTab ? "active" : ""}">${t}<span id="${a === "checks" ? "check-count" : "unused-" + a}"></span></button>`,
      )
      .join(
        "",
      )}</div><div class="results-tools"><select id="detector-select" aria-label="Active detector"></select>${iconButton("export-results", "Export numerical results", "download")}${iconButton("collapse-results", "Collapse or expand results", "chevron")}</div></div><div id="results-body" tabindex="0" role="region" aria-label="Detector and propagation results"></div></section><footer><span id="trace-status"></span><span id="save-state">${saveStatus}</span><span>OptiBench · engine ${ENGINE_VERSION}</span></footer></main><aside class="inspector panel" id="inspector-panel"><div class="panel-title"><h2>Component inspector</h2></div><div id="inspector-body"></div></aside></div><div id="toast" role="status"></div><div id="drawer-scrim" hidden></div><dialog id="dialog"><div class="dialog-heading"><h2 id="dialog-title"></h2>${iconButton("close-dialog", "Close dialog", "close")}</div><div id="dialog-body"></div></dialog><input hidden id="project-file" type="file" accept=".json,application/json"><input hidden id="catalog-file" type="file" accept=".json,application/json"><input hidden id="image-file" type="file" accept="image/png,image/jpeg,image/webp">`;
  bind();
  bindResultsSplitter({workspace: $(".workspace"), panel: $("#results-panel"), handle: $("#results-splitter"), expand: () => { if (!showResults) { showResults = true; renderResults(); } }});
  bindWorkspaceLayout({root: $(".app-layout"), panel: $("#results-panel")});
  compute();
  renderPanels();
  requestAnimationFrame(fit);
  if (restoreMessage) {
    notify(restoreMessage);
    restoreMessage = "";
  }
}
function renderCatalog() {
  const list = catalog.filter(
    (c) =>
      (category === "All components" || c.category === category) &&
      (brand === "All manufacturers" || c.brand === brand) &&
      (scope === "All entries" ||
        (scope === "Manufacturer references" && c.provenance !== "ideal") ||
        (scope === "Ideal designs" && c.provenance === "ideal")) &&
      `${c.part} ${c.name} ${c.brand} ${c.f || ""} ${c.diameter} ${c.coating || ""}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  if (sort === "focal")
    list.sort((a, b) => (a.f ?? Infinity) - (b.f ?? Infinity));
  if (sort === "diameter") list.sort((a, b) => a.diameter - b.diameter);
  if (sort === "part") list.sort((a, b) => a.part.localeCompare(b.part));
  $("#catalog-count").textContent = `${list.length} results`;
  $("#catalog-list").innerHTML = list.length
    ? list
        .map(
          (c) =>
            `<article class="catalog-card" draggable="true" data-part="${esc(c.id)}"><div class="catalog-icon ${c.type}">${icon(typeIcon(c.type), 27)}</div><div class="catalog-details"><button class="part-title" data-action="catalog-info" data-part="${esc(c.id)}">${esc(c.name)}</button><span class="part-number">${esc(c.part)}</span><span class="catalog-meta">${esc(c.brand)} <span>·</span> ${c.f ? "f " + c.f + " mm" : c.wavelength ? c.wavelength + " nm" : "Ø " + c.diameter + " mm"}</span></div><div class="catalog-card-actions"><button data-action="add" data-part="${esc(c.id)}" class="add-component" title="Place on table" aria-label="Place ${esc(c.part)}">${icon("plus", 16)}</button><label class="compare-check" title="Compare this component"><input type="checkbox" data-compare="${esc(c.id)}" ${compare.has(c.id) ? "checked" : ""} aria-label="Compare ${esc(c.part)}"></label></div></article>`,
        )
        .join("")
    : '<div class="empty-state">No matching entries.<br>Try a part number, focal length, or another manufacturer.</div>';
  $("#compare-button span").textContent = `Compare (${compare.size})`;
}
function allChecks() {
  return [
    ...layoutChecks(project),
    ...mechanicalChecks(project),
    ...(result?.warnings || []),
  ];
}
function renderPanels() {
  renderCatalog();
  renderInspector();
  drawBench();
  renderResults();
  renderStatus();
  $("#project-title").textContent = project.title;
  $(".project-heading button").textContent = project.title;
  $("#mode").value = mode;
  $("#run-button").innerHTML =
    icon(running ? "pause" : "play") +
    `<span>${running ? "Pause" : "Run"}</span>`;
  $("#run-button").classList.toggle("paused", !running);
  document
    .querySelectorAll('[data-action^="tool-"]')
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.action === "tool-" + tool),
    );
  $("#placement-hint").hidden = !pendingPart && !measureStart;
  if (pendingPart)
    $("#placement-hint").textContent =
      `Click the table to place ${pendingPart.part} · Esc to cancel`;
  else if (measureStart)
    $("#placement-hint").textContent =
      "Select the second measurement point · Esc to cancel";
}
function renderStatus() {
  const warnings = allChecks();
  $("#trace-status").innerHTML =
    `<span class="status-dot ${running ? "" : "paused"}"></span>${running ? "Live" : "Paused — frozen results"} · ${project.items.length} components · ${result?.segments.length || 0} segments`;
  $("#mode-indicator").textContent =
    mode === "Fourier"
      ? waveBusy
        ? "CALCULATING…"
        : "ANGULAR SPECTRUM"
      : mode === "Rays"
        ? "2D PARAXIAL RAYS"
        : mode === "Interferometry"
          ? "COHERENT TWO-ARM"
          : mode === "Alignment"
            ? "XY + PARAXIAL Z"
            : "ABCD + 2D PATH";
  $("#check-count").textContent = warnings.length ? " " + warnings.length : "";
  $("#table-label").textContent =
    `${project.table.width} × ${project.table.height} mm · ${project.table.thread} / ${project.table.pitch} mm`;
}
function opticalGlyph(c) {
  const d = c.diameter || 25.4,
    body = Math.max(18, d),
    type = c.type;
  let geom = "";
  if (type === "lens")
    geom = `<path d="M0 ${-d / 2} Q${c.f > 0 ? -d * 0.22 : d * 0.15} 0 0 ${d / 2} Q${c.f > 0 ? d * 0.22 : -d * 0.15} 0 0 ${-d / 2}Z" fill="#87c7fa66" stroke="#b7dfff" stroke-width="1.4"/>`;
  if (type === "source" || type === "image")
    geom = `<rect x="-40" y="-17" width="66" height="34" rx="4" fill="#33423d" stroke="#899e91"/><path d="M-30-12v24M-23-12v24M-16-12v24M-9-12v24" stroke="#5e7968"/><rect x="26" y="-6" width="12" height="12" fill="#b9ef71"/><text x="0" y="4" fill="#b5d691" font-size="10" text-anchor="middle">${type === "image" ? "IMG" : "λ"}</text>`;
  if (type === "mirror")
    geom = `<path d="M-3 ${-d / 2}v${d}" stroke="#929fae" stroke-width="7"/><path d="M1 ${-d / 2}v${d}" stroke="#e3eeff" stroke-width="2"/>`;
  if (type === "splitter")
    geom = `<rect x="${-d * 0.4}" y="${-d * 0.4}" width="${d * 0.8}" height="${d * 0.8}" rx="2" fill="#8ec8ff22" stroke="#6b99af"/><path d="M0 ${-d * 0.55}v${d * 1.1}" stroke="#b8dfff" stroke-width="2"/>`;
  if (["aperture", "slit", "polarizer", "filter"].includes(type))
    geom = `<rect x="-5" y="${-body / 2}" width="10" height="${body}" rx="2" fill="${type === "filter" ? "#945c7955" : type === "polarizer" ? "#ab9ada66" : "#788694"}" stroke="#c2cad5"/><path d="M-5 ${-Math.min(c.aperture || 6, body) / 2}h10v${Math.min(c.aperture || 6, body)}H-5Z" fill="#141b22"/>`;
  if (["screen", "camera", "power"].includes(type))
    geom = `<rect x="-10" y="${-body / 2}" width="23" height="${body}" rx="3" fill="#3d364b" stroke="#b7a2e1"/><path d="M-11 ${-body * 0.36}v${body * 0.72}" stroke="#cab8ed" stroke-width="4"/>`;
  if (type === "stop")
    geom = `<rect x="-15" y="-20" width="30" height="40" rx="4" fill="#171d24" stroke="#718093"/><path d="M-9-12L9 12M-9 12L9-12" stroke="#697586"/>`;
  if (type === "mechanical")
    geom = `<rect x="${-body / 2}" y="${-body / 2}" width="${body}" height="${body}" rx="4" fill="#414b58" stroke="#8c99a9"/><circle r="${Math.min(7, body / 4)}" fill="#1c2631" stroke="#8a98a9"/>`;
  return geom;
}
function wavelengthColor(w) {
  if (w < 400 || w > 740) return "#bb9cff";
  if (w < 490) return "#6dbdff";
  if (w < 550) return "#b9ef73";
  if (w < 600) return "#ffe085";
  return "#ff8f84";
}
function drawBench() {
  const svg = $("#bench");
  if (!svg) return;
  svg.setAttribute("viewBox", `${view.x} ${view.y} ${view.w} ${view.h}`);
  const t = project.table,
    scale = svg.clientWidth / view.w || 1,
    labelSize = 12 / scale;
  let segments = (mode === "Rays" ? rayResult : result)?.segments || [];
  const defs = `<defs><pattern id="metal" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#303943"/><path d="M0 1h6M0 4h6" stroke="#323c46" stroke-width=".4"/></pattern><pattern id="holes" x="${t.border}" y="${t.border}" width="${t.pitch}" height="${t.pitch}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="3.8" fill="#55606c"/><circle cx="0" cy="0" r="2.8" fill="#121a23"/><path d="M-2-2a3 3 0 0 1 4 0" stroke="#81909e" stroke-width=".7" fill="none"/></pattern><clipPath id="tableClip"><rect width="${t.width}" height="${t.height}" rx="12"/></clipPath><marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5 0 10" fill="none" stroke="#d0bc86"/></marker></defs>`;
  let ruler = "";
  for (let x = 0; x <= t.width; x += 100)
    ruler += `<path d="M${x}-12v-9" stroke="#6c7886"/><text x="${x}" y="-30" text-anchor="middle" font-size="${labelSize}" fill="#929eac">${x}</text>`;
  for (let y = 0; y <= t.height; y += 100)
    ruler += `<path d="M-12 ${y}h-9" stroke="#6c7886"/><text x="-32" y="${y + 4}" text-anchor="end" font-size="${labelSize}" fill="#929eac">${y}</text>`;
  const beamPaths = segments
    .map((s) => {
      let dx = (s.to.x - s.from.x) / (s.length || 1),
        dy = (s.to.y - s.from.y) / (s.length || 1),
        color = wavelengthColor(s.wavelength),
        points = [];
      const samples = 24;
      for (let i = 0; i <= samples; i++) {
        const z = (s.length * i) / samples,
          w = beamRadius({ re: s.q.re + z, im: s.q.im }, s.wavelength, s.m2),
          vis = Math.min(w, t.height);
        points.push({ x: s.from.x + dx * z, y: s.from.y + dy * z, w: vis });
      }
      const envelope =
        points
          .map((p, i) => `${i ? "L" : "M"}${p.x - dy * p.w} ${p.y + dx * p.w}`)
          .join(" ") +
        points
          .slice()
          .reverse()
          .map((p) => `L${p.x + dy * p.w} ${p.y - dx * p.w}`)
          .join(" ") +
        "Z";
      return `${showEnvelope && !s.ray ? `<path d="${envelope}" fill="${color}" fill-opacity=".15" stroke="${color}" stroke-opacity=".55" stroke-width="${0.7 / scale}"/>` : ""}<path d="M${s.from.x} ${s.from.y}L${s.to.x} ${s.to.y}" stroke="${color}" stroke-width="${(s.ray ? 0.7 : 1.3) / scale}" opacity="${s.ray ? 0.45 : 0.85}"/>`;
    })
    .join("");
  const components = project.items
    .map((c) => {
      const chosen = selected.has(c.id),
        foot = c.footprint || 40,
        r = foot / 2,
        opacity = c.enabled ? 1 : 0.3;
      return `<g data-component="${c.id}" class="bench-component" transform="translate(${c.x} ${c.y})" opacity="${opacity}" tabindex="0" role="button" aria-label="${esc(c.label)}"><title>${esc(c.label)} · ${esc(c.part)} · ${c.x}, ${c.y} mm</title>${t.showMounts ? `<rect x="${-r}" y="${-r}" width="${foot}" height="${foot}" rx="5" fill="#1e2832" stroke="#607080" stroke-width="1"/><path d="M${-r + 5} ${r - 5}H${r - 5}" stroke="#526171"/>${[-1, 1].map((a) => `<circle cx="${a * (r - 7)}" cy="${r - 7}" r="2.2" fill="#101822" stroke="#778696"/>`).join("")}` : ""}<rect x="${-Math.max(r + 6, 14 / scale)}" y="${-Math.max(r + 6, 14 / scale)}" width="${Math.max(foot + 12, 28 / scale)}" height="${Math.max(foot + 12, 28 / scale)}" fill="transparent" stroke="${chosen ? "#c4f28b" : "transparent"}" stroke-width="${1.3 / scale}" stroke-dasharray="${chosen ? 4 / scale + " " + 3 / scale : "0"}" rx="4"/><g transform="rotate(${c.angle})">${opticalGlyph(c)}</g>${showLabels ? `<g transform="translate(0 ${-r - 18 / scale})"><text text-anchor="middle" fill="${chosen ? "#c9f29a" : "#d8e1e9"}" font-size="${labelSize}" style="paint-order:stroke;stroke:#1b2530;stroke-width:${3 / scale}px">${esc(scale < 0.65 && !chosen ? c.label.split(" · ")[0].slice(0, 12) : c.label.length > 25 ? c.label.slice(0, 23) + "…" : c.label)}</text></g>` : ""}<text y="${r + 18 / scale}" text-anchor="middle" fill="#8e9bad" font-size="${10 / scale}">${c.locked ? "⌑ " : ""}${c.f ? "f " + c.f + " mm" : c.type === "source" ? c.wavelength + " nm" : c.type === "splitter" ? Math.round(c.reflectivity * 100) + "% R" : c.id}</text></g>`;
    })
    .join("");
  const measurements = project.measurements
    .map(
      (m) =>
        `<g><path d="M${m.a.x} ${m.a.y}L${m.b.x} ${m.b.y}" stroke="#d0bc86" stroke-dasharray="5 4" stroke-width="${1 / scale}" marker-start="url(#arrow)" marker-end="url(#arrow)"/><text x="${(m.a.x + m.b.x) / 2}" y="${(m.a.y + m.b.y) / 2 - 10 / scale}" fill="#dfca98" text-anchor="middle" font-size="${labelSize}">${fmt(distance(m.a, m.b), 1)} mm</text></g>`,
    )
    .join("");
  svg.innerHTML =
    defs +
    `<rect x="${view.x}" y="${view.y}" width="${view.w}" height="${view.h}" fill="#18212b"/><rect x="0" y="8" width="${t.width}" height="${t.height}" rx="12" fill="#0c121a"/><rect width="${t.width}" height="${t.height}" rx="12" fill="url(#metal)" stroke="#788594" stroke-width="2"/>${showGrid ? `<rect width="${t.width}" height="${t.height}" rx="12" fill="url(#holes)"/>` : ""}${ruler}<g clip-path="url(#tableClip)">${beamPaths}</g>${components}${measurements}${measureStart ? `<circle cx="${measureStart.x}" cy="${measureStart.y}" r="${5 / scale}" fill="none" stroke="#dfca98"/>` : ""}`;
  $("#zoom-readout").textContent =
    Math.round(((t.width + 120) / view.w) * 100) + "%";
  svg.style.cursor = pendingPart
    ? "copy"
    : tool === "pan"
      ? "grab"
      : tool === "measure"
        ? "crosshair"
        : "default";
}
function inputField(
  label,
  key,
  value,
  { unit = "", min = -10000, max = 10000, step = "any", readonly = false } = {},
) {
  return `<label class="field"><span>${label}</span><div class="field-input"><input data-field="${key}" type="number" value="${value ?? 0}" min="${min}" max="${max}" step="${step}" ${readonly ? "disabled" : ""}><span>${unit}</span></div></label>`;
}
function renderInspector() {
  const c = selectedItem(),
    wrap = $("#inspector-body");
  if (!c) {
    wrap.innerHTML = `<div class="empty-inspector">${icon("cursor", 38)}<h3>Select a component</h3><p>Inspect its placement, optical parameters and catalog reference.</p>${button("table", "Configure optical table", "settings", "outline")}</div><div class="selection-list"><h3>On this table</h3>${project.items.map((c) => `<button data-action="select" data-id="${c.id}">${icon(typeIcon(c.type))}<span>${esc(c.label)}</span><small>${c.id}</small></button>`).join("")}</div>`;
    return;
  }
  const reference = catalog.find((p) => p.id === c.catalogId),
    src = sources[c.provenance] || sources.ideal;
  const overrides =
    (reference &&
      [
        "f",
        "diameter",
        "aperture",
        "transmission",
        "reflectivity",
        "waist",
        "wavelength",
      ].filter((k) => reference[k] !== undefined && c[k] !== reference[k])) ||
    [];
  let optical = "";
  if (c.type === "lens")
    optical =
      inputField("Effective focal length", "f", c.f, {
        unit: "mm",
        min: -10000,
        max: 10000,
      }) +
      inputField("Clear aperture · assumed", "aperture", c.aperture, {
        unit: "mm",
        min: 0.001,
        max: c.diameter,
      }) +
      inputField("Power transmission · model", "transmission", c.transmission, {
        unit: "0–1",
        min: 0,
        max: 1,
      });
  if (["source", "image"].includes(c.type))
    optical =
      inputField("Wavelength", "wavelength", c.wavelength, {
        unit: "nm",
        min: 200,
        max: 20000,
      }) +
      inputField("Waist radius · 1/e²", "waist", c.waist, {
        unit: "mm",
        min: 0.001,
        max: 100,
      }) +
      inputField("Optical power", "power", c.power, {
        unit: "mW",
        min: 1e-12,
        max: 1e6,
      }) +
      inputField("Beam quality", "m2", c.m2, { unit: "M²", min: 1, max: 100 }) +
      inputField("Linear polarization", "polarization", c.polarization, {
        unit: "°",
        min: -360,
        max: 360,
      }) +
      inputField(
        "Coherence length · 1/e",
        "coherenceLength",
        c.coherenceLength ?? 1000,
        { unit: "mm", min: 0.000001, max: 1e9 },
      ) +
      (c.type === "image"
        ? `<label class="field"><span>Field at source plane</span><select data-field="pattern">${[
            ["bars", "Resolution bars"],
            ["double-slit", "Double slit"],
            ["pinhole", "Circular opening"],
            ["image", "Uploaded image"],
          ]
            .map(
              ([v, t]) =>
                `<option value="${v}" ${c.pattern === v ? "selected" : ""}>${t}</option>`,
            )
            .join(
              "",
            )}</select></label>${button("upload-image", project.image ? "Replace source image" : "Upload source image", "download", "outline full")}<p class="field-note">${project.image ? esc(project.image.name) : "Images are treated as coherent amplitude targets."}</p>`
        : "");
  if (["aperture", "slit"].includes(c.type))
    optical = inputField(
      c.type === "slit" ? "Slit width" : "Opening diameter",
      "aperture",
      c.aperture,
      {
        unit: "mm",
        min: c.apertureMin || 0.001,
        max: c.apertureMax || c.diameter,
      },
    );
  if (["mirror", "splitter"].includes(c.type))
    optical = inputField(
      "Power reflectivity · model",
      "reflectivity",
      c.reflectivity,
      { min: 0, max: 1, unit: "0–1" },
    );
  if (c.type === "mirror")
    optical += inputField(
      "Normal piston · phase only",
      "pistonNm",
      c.pistonNm ?? 0,
      { unit: "nm", min: -1e6, max: 1e6, step: 1 },
    );
  if (["filter", "splitter"].includes(c.type))
    optical += inputField(
      "Power transmission · model",
      "transmission",
      c.transmission,
      { min: 0, max: 1, unit: "0–1" },
    );
  if (c.type === "polarizer")
    optical = inputField("Transmission axis", "axis", c.axis, {
      unit: "°",
      min: -360,
      max: 360,
    });
  if (c.type === "screen")
    optical = `<label class="checkbox-row"><input data-field="terminate" type="checkbox" ${c.terminate ? "checked" : ""}>Terminate the beam at this screen</label>`;
  if (c.type === "camera")
    optical = [
      ["Exposure", "exposure", "ms", 0.000001, 1e6],
      ["Pixel pitch", "pixelPitch", "µm", 0.1, 100],
      ["Sensor width", "pixelsX", "px", 16, 20000],
      ["Sensor height", "pixelsY", "px", 16, 20000],
      ["Quantum efficiency · model", "qe", "0–1", 0, 1],
      ["Read noise · model", "readNoise", "e⁻ RMS", 0, 1000],
      ["Dark current · model", "darkCurrent", "e⁻/s", 0, 1e6],
      ["Full well · model", "fullWell", "e⁻", 1, 1e8],
      ["ADC bit depth · model", "bits", "bits", 1, 24],
      ["Digital gain · model", "gain", "×", 0.01, 1000],
    ]
      .map(([label, k, unit, min, max]) =>
        inputField(label, k, c[k], {
          unit,
          min,
          max,
          step: ["pixelsX", "pixelsY", "bits"].includes(k) ? 1 : "any",
        }),
      )
      .join("");
  const mechanics = `<div class="inspector-section"><h4>Height & optomechanics</h4>${inputField("Optic axis above table", "z", c.z ?? project.table.heightAbove, { unit: "mm", min: 1, max: 1000 })}${["source", "image", "mirror", "splitter"].includes(c.type) ? inputField(c.type === "source" || c.type === "image" ? "Source elevation" : "Mirror normal elevation", "pitch", c.pitch ?? 0, { unit: "°", min: -1, max: 1 }) : ""}<label class="field"><span>Parametric mounting assembly</span><select data-field="mountType">${Object.entries(
    mountModels,
  )
    .map(
      ([id, m]) =>
        `<option value="${id}" ${(c.mountType || "none") === id ? "selected" : ""}>${m.name}</option>`,
    )
    .join(
      "",
    )}</select></label>${c.mountType && c.mountType !== "none" ? `${inputField("Post length", "postLength", c.postLength, { unit: "mm", min: 0, max: 1000 })}<label class="field"><span>Base thread</span><select data-field="mountThread">${[...new Set(["M6", "¼″–20", c.mountThread || project.table.thread])].map((t) => `<option ${c.mountThread === t ? "selected" : ""}>${t}</option>`).join("")}</select></label><p class="field-note">Holder extension ${fmt(c.z - c.postLength - mountModels[c.mountType].base, 2)} mm / 0–50 mm. ${c.mountType === "xyz" ? "Stage base: 15 mm." : ""}</p>` : ""}${c.mountType === "xyz" ? `${inputField("XYZ half travel", "stageTravel", c.stageTravel, { unit: "±mm", min: 0.01, max: 100 })}<p class="field-note">Stage zero: X ${fmt(c.stageOriginX, 2)}, Y ${fmt(c.stageOriginY, 2)}, Z ${fmt(c.stageOriginZ, 2)} mm. Offsets: ${fmt(c.x - c.stageOriginX, 3)}, ${fmt(c.y - c.stageOriginY, 3)}, ${fmt(c.z - c.stageOriginZ, 3)} mm.</p>${button("stage-rebase", "Relocate stage base to current position", "settings", "outline full")}` : ""}<p class="field-note">Ideal mechanical models. Holder travel, footprint and thread checks do not verify manufacturer-specific fit.</p>${button("show-alignment", "Open alignment instruments", "ruler", "outline full")}</div>`;
  const at = result?.hits.find((h) => h.id === c.id);
  wrap.innerHTML = `<div class="inspector-summary"><div class="inspector-glyph ${c.type}">${icon(typeIcon(c.type), 35)}</div><span class="eyebrow">${esc(c.brand)} ${selected.size > 1 ? "· " + selected.size + " selected" : ""}</span><h3>${esc(c.name)}</h3><code>${esc(c.part)}</code><span class="provenance ${c.provenance === "ideal" ? "ideal" : ""}">${c.provenance === "ideal" ? "PARAMETRIC DESIGN" : "CATALOG REFERENCE"}</span></div><div class="inspector-section"><label class="field"><span>Component label</span><input data-field="label" maxlength="100" value="${esc(c.label)}"></label><div class="two-col">${inputField("X position", "x", c.x, { unit: "mm", min: 0, max: project.table.width })}${inputField("Y position", "y", c.y, { unit: "mm", min: 0, max: project.table.height })}</div>${inputField("Optical normal / source direction", "angle", c.angle, { unit: "°", min: -3600, max: 3600 })}<div class="inline-checks"><label><input data-field="enabled" type="checkbox" ${c.enabled ? "checked" : ""}>Enabled</label><label><input data-field="locked" type="checkbox" ${c.locked ? "checked" : ""}>Lock position</label></div><div class="inspector-buttons">${button("rotate", "Rotate 15°", "rotate")}${button("duplicate", "Duplicate", "copy")}</div></div>${optical ? `<div class="inspector-section"><h4>Optical parameters</h4>${optical}${c.assumptions ? `<p class="field-note">${esc(c.assumptions)}</p>` : ""}</div>` : ""}<div class="inspector-section"><h4>Mechanical envelope</h4>${inputField("Optic / active diameter", "diameter", c.diameter, { unit: "mm", min: 0.001, max: 500 })}${inputField("Mount footprint · estimate", "footprint", c.footprint, { unit: "mm", min: 1, max: 500 })}<p class="field-note">Footprint checks use an adjustable envelope. Use Height & optomechanics for posts, stages and vertical alignment.</p></div>${mechanics}${at ? `<div class="inspector-section"><h4>Incident field</h4><dl class="specs"><dt>Beam radius</dt><dd>${fmt(at.radius, 4)} mm</dd><dt>Power</dt><dd>${fmt(at.power, 6)} mW</dd><dt>Path length</dt><dd>${fmt(at.distance, 2)} mm</dd><dt>Decenter</dt><dd>${fmt(at.offset, 4)} mm</dd><dt>Incidence</dt><dd>${fmt(at.incidence, 2)}°</dd></dl></div>` : ""}<div class="inspector-section"><h4>Catalog & assumptions</h4>${overrides.length ? `<p class="override-note">Model overrides: ${overrides.join(", ")}.</p>` : ""}<dl class="specs"><dt>Diameter</dt><dd>${reference?.diameter ?? c.diameter} mm</dd>${reference?.f ? `<dt>Nominal EFL</dt><dd>${reference.f} mm</dd>` : ""}${c.bfl ? `<dt>Catalog BFL</dt><dd>${c.bfl} mm</dd>` : ""}${c.coating ? `<dt>Coating</dt><dd>${esc(c.coating)}</dd>` : ""}${c.glass ? `<dt>Material</dt><dd>${esc(c.glass)}</dd>` : ""}${c.thread ? `<dt>Thread</dt><dd>${esc(c.thread)}</dd>` : ""}</dl><p class="field-note">${esc(src.status)}. Lens simulation uses ideal principal planes; catalog BFL does not shift the modeled plane.</p>${src.url ? `<a class="source-link" target="_blank" rel="noopener" href="${esc(src.url)}">Manufacturer source ${icon("external", 14)}</a>` : ""}${button("replace", "Find equivalent lenses", "search", "outline full")}${button("reset-component", "Reset optical parameters", "undo", "full")}</div><div class="inspector-section"><label class="field"><span>Component notes</span><textarea data-field="notes" maxlength="2000" rows="3">${esc(c.notes)}</textarea></label>${button("remove", "Remove selected", "trash", "danger full")}</div>`;
  wrap.querySelector('[data-field="mountType"]').value = c.mountType || "none";
}
function detectorHit() {
  const list = result?.detectors.filter((d) => d.id === activeDetector) || [];
  return list.find((d) => d.branch === activeBranch) || list[0];
}
function gaussianImage(hit, n = 128, width = 6) {
  const values = new Float64Array(n * n),
    dx = width / n;
  if (hit) {
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const xx = (x + 0.5 - n / 2) * dx - hit.offset,
          yy = (y + 0.5 - n / 2) * dx + (hit.verticalOffset || 0);
        values[y * n + x] =
          ((2 * hit.power) / (Math.PI * hit.radius * hit.radius)) *
          Math.exp((-2 * (xx * xx + yy * yy)) / (hit.radius * hit.radius)) *
          dx *
          dx;
      }
  }
  return { values, n, width, power: hit?.power || 0 };
}
function renderResults() {
  const body = $("#results-body");
  if (!body) return;
  const dets = project.items.filter((c) =>
    ["screen", "camera", "power"].includes(c.type),
  );
  $("#detector-select").innerHTML =
    dets
      .map(
        (c) =>
          `<option value="${c.id}" ${activeDetector === c.id ? "selected" : ""}>${esc(c.label)}</option>`,
      )
      .join("") || "<option>No detectors</option>";
  document
    .querySelectorAll('[data-action^="result-"]')
    .forEach((b) =>
      b.classList.toggle("active", b.dataset.action === "result-" + resultTab),
    );
  $("#results-panel").classList.toggle("collapsed", !showResults);
  if (!showResults) return;
  if (resultTab === "alignment") return renderAlignment(body);
  if (resultTab === "checks") {
    const checks = allChecks();
    body.innerHTML = `<div class="checks-list">${checks.length ? checks.map((w) => `<button data-action="select" data-id="${w.id || ""}" class="check ${w.level}">${icon(w.level === "error" ? "warning" : "info")}<span>${esc(w.text)}</span>${icon("chevron", 14)}</button>`).join("") : `<div class="check success">${icon("check")}<span>No placement or path issues detected within the supported model.</span></div>`}<p class="field-note">Checks cover approximate footprints, table bounds, beam interception, coating-range metadata and paraxial incidence. They do not certify mechanical fit or damage thresholds.</p></div>`;
    return;
  }
  if (resultTab === "paths") {
    body.innerHTML = `<div class="data-scroll"><table><thead><tr><th>Component</th><th>Source / branch</th><th>Path (mm)</th><th>Radius (mm)</th><th>Incident power (mW)</th><th>Offset (mm)</th></tr></thead><tbody>${(result?.hits || []).map((h) => `<tr data-action="select" data-id="${h.id}"><td>${esc(project.items.find((c) => c.id === h.id)?.label)}</td><td>${h.source} / ${h.branch}</td><td>${fmt(h.distance, 3)}</td><td>${fmt(h.radius, 5)}</td><td>${fmt(h.power, 6)}</td><td>${fmt(h.offset, 3)}</td></tr>`).join("")}</tbody></table></div>`;
    return;
  }
  if (resultTab === "envelope") {
    const lines = result?.segments || [],
      points = [];
    let maxS = 1,
      maxW = 0.01;
    for (const s of lines)
      for (let i = 0; i <= 20; i++) {
        const z = (s.length * i) / 20,
          w = beamRadius({ re: s.q.re + z, im: s.q.im }, s.wavelength, s.m2);
        maxW = Math.max(w, maxW);
        maxS = Math.max(maxS, s.s + z);
        points.push({ s: s.s + z, w, branch: s.branch });
      }
    body.innerHTML = `<div class="propagation-chart"><svg viewBox="0 0 800 180" preserveAspectRatio="none"><path d="M45 10v135h730" fill="none" stroke="#526171"/>${[0, 0.5, 1].map((f) => `<text x="35" y="${145 - f * 120}" fill="#9dacbd" font-size="11" text-anchor="end">${fmt(maxW * f, 2)}</text><path d="M45 ${145 - f * 120}h730" stroke="#334252" stroke-dasharray="4 6"/>`).join("")}${[
      ...new Set(points.map((p) => p.branch)),
    ]
      .map(
        (branch) =>
          `<path d="${points
            .filter((p) => p.branch === branch)
            .map(
              (p, i) =>
                `${i ? "L" : "M"}${45 + (p.s / maxS) * 730} ${145 - (p.w / maxW) * 120}`,
            )
            .join(
              " ",
            )}" fill="none" stroke="${branch % 2 ? "#95c7f6" : "#baf181"}" stroke-width="2"/>`,
      )
      .join(
        "",
      )}<text x="45" y="165" fill="#9dacbd" font-size="11">0</text><text x="390" y="175" fill="#9dacbd" font-size="11">Optical path length (mm) · Gaussian radius (mm)</text><text x="750" y="165" fill="#9dacbd" font-size="11">${fmt(maxS, 0)}</text></svg></div>`;
    return;
  }
  const incoming =
    result?.detectors.filter((d) => d.id === activeDetector) || [];
  const h = detectorHit(),
    det = project.items.find((c) => c.id === activeDetector);
  if (!det) {
    body.innerHTML =
      '<div class="empty-state">Place a screen, camera or power meter to inspect a detector plane.</div>';
    return;
  }
  if (mode === "Interferometry") return renderInterferometry(body, det);
  let wave = mode === "Fourier",
    field = wave
      ? waveResult
      : gaussianImage(h, 128, Math.max(0.1, h?.radius * 7 || 6)),
    wi = h ? waistInfo(h.q, h.wavelength, h.m2) : null;
  const error = wave
    ? waveError
    : !h
      ? "No beam reaches this detector. Check the optical path."
      : "";
  body.innerHTML = `<div class="detector-layout"><div class="detector-image-wrap"><canvas id="detector-canvas" width="256" height="256" aria-label="Calculated detector irradiance"></canvas><span class="image-caption">${det.type === "camera" ? "SAMPLED SENSOR RESPONSE" : wave ? "NUMERICAL IRRADIANCE" : "GAUSSIAN IRRADIANCE"}</span>${waveBusy ? '<div class="canvas-message">Calculating field…</div>' : error ? `<div class="canvas-message error">${esc(error)}</div>` : ""}</div><div class="profile-section"><div class="profile-heading"><span>${incoming.length > 1 ? `<select id="branch-select" aria-label="Incident beam path">${incoming.map((h) => `<option value="${h.branch}" ${h.branch === detectorHit()?.branch ? "selected" : ""}>Source ${h.source} / path ${h.branch}</option>`).join("")}</select>` : "Horizontal cross-section"}</span><label><input id="logscale" type="checkbox" ${logScale ? "checked" : ""}>Log</label></div><svg id="profile-plot" viewBox="0 0 340 110"></svg><div class="field-options">${wave ? `<label>Grid<select id="wave-n">${[128, 256, 512, 1024].map((n) => `<option ${n === project.wave.n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Field mm<input id="wave-width" type="number" min=".1" max="100" step=".1" value="${project.wave.width}"></label>${button("solve-wave", "Solve", "play", "outline")}` : `<span>1/e² radius · ${mode === "Rays" ? "Gaussian reference beside ray trace" : "ABCD propagated field"}</span>`}</div>${det.type === "camera" ? `<label class="noise-toggle"><input id="noise" type="checkbox" ${noise ? "checked" : ""}>Shot + read noise · fixed seed</label>` : ""}<p class="field-note" id="detector-note">${wave ? esc(waveResult?.warnings?.join(" ") || "Scalar angular-spectrum propagation. Check sampling when changing optics.") : det.type === "camera" ? "Sensor model uses editable QE and noise assumptions. Preview samples native-pixel response." : "Power is computed along the selected path; screens may transmit without absorbing."}</p></div><div class="detector-metrics"><div><span>${wave ? "D4σ width X" : "Beam diameter · 1/e²"}</span><strong>${fmt(wave ? field?.moments?.wx * 2 : h?.radius * 2, 4)} <small>mm</small></strong></div><div><span>Incident optical power</span><strong>${fmt(field?.power, 6)} <small>mW</small></strong></div><div><span>${wave ? "Field transmission" : "Distance to waist"}</span><strong>${wave ? fmt((field?.power / (field?.sourcePower || 1)) * 100, 2) : fmt(wi?.distance, 2)} <small>${wave ? "%" : "mm"}</small></strong></div><div><span>${wave ? "Sampling interval" : "Waist radius"}</span><strong>${fmt(wave ? field?.dx * 1000 : wi?.waist, 4)} <small>${wave ? "µm" : "mm"}</small></strong></div></div></div>`;
  if (field) {
    let display = field;
    if (det.type === "camera") {
      const camera = cameraResponse(
        field.values,
        field.n,
        field.width,
        det,
        h?.wavelength ||
          project.items.find((c) => c.type === "source" || c.type === "image")
            ?.wavelength ||
          532,
        { noise, offset: wave ? field.offset : 0 },
      );
      display = { ...field, values: camera.values, width: camera.sensorWidth };
      $("#detector-note").textContent =
        `${fmt(camera.saturated * 100, 2)}% of sampled pixels reach full well. Peak signal ${fmt(camera.peakElectrons, 0)} e⁻. ${waveResult?.warnings?.join(" ") || ""} Native-pixel response on a decimated preview; noise parameters are assumptions.`;
      paintField(display, det.type === "camera");
      plotProfile(display);
    } else {
      paintField(display);
      plotProfile(display);
    }
  }
}
function renderAlignment(body) {
  const targets = alignmentTargets(project, result),
    pair = pairAlignment(targets),
    c = selectedItem(),
    axis = sideAxis,
    limit = axis === "x" ? project.table.width : project.table.height;
  const zmax = Math.max(
    150,
    ...project.items.map(
      (c) => (c.z ?? project.table.heightAbove) + c.diameter / 2 + 20,
    ),
    ...result.segments.map((s) => (s.z1 ?? 100) + 20),
    ...project.items
      .filter((c) => c.mountType && c.mountType !== "none")
      .map((c) => c.postLength + mountModels[c.mountType].base + 20),
  );
  const px = (v) => 45 + (v / limit) * 800,
    pz = (z) => 175 - (z / zmax) * 150;
  const sideMount = (o) => {
    const x = px(o[axis]),
      z = o.z ?? project.table.heightAbove;
    if (!o.mountType || o.mountType === "none")
      return `<path d="M${x} 175V${pz(z)}" stroke="#435361" stroke-width="3" stroke-dasharray="3 3"/>`;
    const base = mountModels[o.mountType].base,
      top = base + o.postLength;
    return `${o.mountType === "xyz" ? `<rect x="${px(o[axis === "x" ? "stageOriginX" : "stageOriginY"]) - 14}" y="${pz(base)}" width="28" height="${175 - pz(base)}" fill="#425c70" stroke="#8aafc9"/>` : ""}<path d="M${x} ${pz(base)}V${pz(top)}" stroke="#909da9" stroke-width="5"/><path d="M${x} ${pz(top)}V${pz(z)}" stroke="#5f91a7" stroke-width="8"/>`;
  };
  const svg = `<svg id="alignment-side-svg" viewBox="0 0 900 205" role="img" aria-label="${axis.toUpperCase()} Z side elevation of optical table"><rect x="45" y="175" width="800" height="8" fill="#657585"/>${[0, 0.5, 1].map((f) => `<path d="M45 ${pz(f * zmax)}H845" stroke="#344757" stroke-dasharray="4 5"/><text x="38" y="${pz(f * zmax) + 4}" text-anchor="end" fill="#a7bbc9" font-size="12">${fmt(f * zmax, 0)}</text>`).join("")}${project.items
    .filter((o) => o.enabled !== false)
    .map(
      (o) =>
        `<g data-action="select" data-id="${o.id}" style="cursor:pointer"><title>${esc(o.label)} · Z ${fmt(o.z ?? project.table.heightAbove, 3)} mm</title>${sideMount(o)}<rect x="${px(o[axis]) - 7}" y="${pz(o.z ?? project.table.heightAbove) - Math.max(4, (o.diameter / zmax) * 75)}" width="14" height="${Math.max(8, (o.diameter / zmax) * 150)}" fill="#263b4b" stroke="${selected.has(o.id) ? "#c5ed96" : "#9aaebd"}"/><text x="${px(o[axis])}" y="${pz(o.z ?? project.table.heightAbove) - (o.diameter / zmax) * 75 - 7}" text-anchor="middle" fill="#c6d8e5" font-size="12">${o.id}</text></g>`,
    )
    .join(
      "",
    )}${result.segments.map((s) => `<path d="M${px(s.from[axis])} ${pz(s.z0 ?? 100)}L${px(s.to[axis])} ${pz(s.z1 ?? 100)}" stroke="${s.branch % 2 ? "#8ccaf6" : "#c3ec87"}" stroke-width="1.5" fill="none"/>`).join("")}<text x="45" y="202" fill="#9fb3c4" font-size="12">0</text><text x="390" y="202" fill="#9fb3c4" font-size="12">${axis.toUpperCase()} position (mm) · Z above table (mm)</text><text x="845" y="202" text-anchor="end" fill="#9fb3c4" font-size="12">${limit}</text></svg>`;
  const cards = targets
    .slice(0, 6)
    .map((t) => {
      const radius = t.radius,
        scale = 32 / Math.max(radius, 0.01),
        x = 50 + clamp(t.dx || 0, -radius * 1.2, radius * 1.2) * scale,
        z = 50 - clamp(t.dz || 0, -radius * 1.2, radius * 1.2) * scale;
      return `<button class="alignment-target" data-action="select" data-id="${t.component.id}"><span>${esc(t.component.label)}</span><svg viewBox="0 0 100 100" aria-label="Horizontal and vertical beam centroid target"><circle cx="50" cy="50" r="32" fill="#14202c" stroke="#698295"/><path d="M10 50H90M50 10V90" stroke="#486173"/>${t.h ? `<circle cx="${x}" cy="${z}" r="4" fill="${t.status === "Centred" ? "#bdf68f" : "#edc089"}"/>` : ""}</svg><strong>${t.status}</strong><small>H ${fmt(t.dx, 3)} / V ${fmt(t.dz, 3)} mm</small><small>1/e² edge margin ${fmt(t.clearance, 3)} mm</small>${t.arrivals.length > 1 ? "<small>First arrival shown · multiple paths</small>" : ""}</button>`;
    })
    .join("");
  const adjust = (axis, label) =>
    `<div><span>${label}</span><button data-action="alignment-nudge" data-axis="${axis}" data-sign="-1" aria-label="Decrease ${label}">−</button><button data-action="alignment-nudge" data-axis="${axis}" data-sign="1" aria-label="Increase ${label}">+</button></div>`;
  body.innerHTML = `<div class="alignment-instruments"><div class="alignment-elevation"><div class="alignment-heading"><strong>Synchronized side elevation</strong><select id="side-axis" aria-label="Side elevation axis"><option value="x" ${axis === "x" ? "selected" : ""}>X–Z</option><option value="y" ${axis === "y" ? "selected" : ""}>Y–Z</option></select>${button("export-alignment", "Mount CSV", "download", "outline")}</div>${svg}<p class="field-note">Side view projects all branches onto the selected axis. Vertical rays use a first-order small-angle model (±1°); horizontal distances drive propagation.</p></div><div class="alignment-targets">${cards || "<p>Add two iris apertures to inspect beam centring, or open the Two-mirror alignment setup.</p>"}</div><div class="alignment-summary">${pair ? `<strong>Dual iris: ${pair.centred ? "centred within 0.05 mm" : "adjust mirrors"}</strong><span>Relative target slope H ${fmt(pair.horizontalMrad, 4)} / V ${fmt(pair.verticalMrad, 4)} mrad · separation ${fmt(pair.separation, 1)} mm</span>` : "<span>Dual-iris slope requires two parallel irises reached by the same optical branch.</span>"}</div><div class="alignment-adjust"><strong>${c ? esc(c.label) : "Select a component for fine adjustment"}</strong><label>Angle step<input id="alignment-angle-step" type="number" min=".001" max="10" step=".001" value="${alignmentAngleStep}">mrad</label><label>Position step<input id="alignment-position-step" type="number" min=".001" max="10" step=".001" value="${alignmentPositionStep}">mm</label>${c ? `${["source", "image", "mirror", "splitter"].includes(c.type) ? adjust("angle", "Yaw") + adjust("pitch", "Elevation") : ""}${adjust("z", "Height")}${c.mountType === "xyz" ? adjust("x", "Stage X") + adjust("y", "Stage Y") : ""}` : ""}</div><p class="field-note">Walk the beam through the near and far irises with alternating mirror adjustments. A negative edge margin indicates potential clipping. Fine stage controls enforce travel; other edits report out-of-travel positions in Design checks.</p></div>`;
}
function getFringes(det) {
  const key = snapshot() + det.id + noise;
  if (fringeCache?.key === key) return fringeCache;
  const field = coherentField(project, det.id);
  fringeCache = { key, field, measured: measureFringes(field, { noise }) };
  return fringeCache;
}
function renderInterferometry(body, det) {
  if (!running) {
    body.innerHTML =
      '<div class="empty-state">Interferometry paused. Resume to calculate the current setup.</div>';
    return;
  }
  try {
    const { field: f, measured: m, key } = getFringes(det),
      fit = m.fit;
    const mirrors = project.items.filter(
      (c) => c.type === "mirror" && c.enabled,
    );
    const scan = fringeScan?.key === key ? fringeScan.rows : null;
    body.innerHTML = `<div class="detector-layout interferometry-layout"><div class="detector-image-wrap"><canvas id="detector-canvas" aria-label="Coherently recombined simulated fringes"></canvas><span class="image-caption">${det.type === "camera" ? "SIMULATED CAMERA" : "COHERENT IRRADIANCE"}</span></div><div class="profile-section"><div class="profile-heading"><strong>${scan ? "Mirror piston scan · central pixel" : "Fringe profile · central sensor row"}</strong><span>${f.paths.length} paths</span></div><svg id="profile-plot" viewBox="0 0 340 110"></svg><div class="field-options"><label>Scan mirror<select id="scan-mirror">${mirrors.map((c) => `<option value="${c.id}" ${fringeScan?.mirrorId === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label>${button("phase-scan", "Scan 2λ", "play", "outline")}${button("fringe-export", "CSV", "download", "outline")}</div>${det.type === "camera" ? `<label class="noise-toggle"><input id="noise" type="checkbox" ${noise ? "checked" : ""}>Shot + read noise · reproducible</label>` : ""}<p class="field-note" id="fringe-quality">${esc(m.reason || `Valid row fit · RMS residual ${fmt(Math.sqrt(fit.mse), 4)} · ${m.samples.length} illuminated samples`)} ${fmt(m.saturated * 100, 2)}% clipped.</p><p class="field-note">Model-normalized simulated data. Phase origin: sensor centre. Adjust arm mirror angle for fringe spacing; piston for phase. ${scan ? "Scan covers 65 positions; CSV includes the full scan." : ""}</p></div><div class="detector-metrics"><div><span>Measured fringe period</span><strong>${fmt(fit?.period, 4)} <small>mm</small></strong></div><div><span>Measured visibility / phase</span><strong>${fit ? fmt(fit.visibility * 100, 1) + "% / " + fmt(fit.phase, 3) : "—"} <small>rad</small></strong></div><div><span>Predicted OPD · path 2 − 1</span><strong>${fmt(f.opd === null ? null : f.opd * 1e6, 2)} <small>nm</small></strong></div><div><span>Predicted coherence / period</span><strong>${fmt(f.coherence * 100, 1)}% / ${f.carrier > 0 ? fmt(1 / f.carrier, 4) : "∞"} <small>mm</small></strong></div></div></div>`;
    paintField(m, det.type === "camera");
    if (scan) {
      const max = Math.max(...scan.map((r) => r.signal), 1e-30);
      $("#profile-plot").innerHTML =
        `<path d="${scan.map((r, i) => `${i ? "L" : "M"}${15 + (i / 64) * 310} ${85 - (r.signal / max) * 70}`).join(" ")}" stroke="#bbef84" fill="none" stroke-width="1.6"/><text x="15" y="107" fill="#9caaba" font-size="11">${fmt(scan[0].piston, 1)} nm</text><text x="250" y="107" fill="#9caaba" font-size="11">${fmt(scan.at(-1).piston, 1)} nm</text>`;
    } else plotProfile(m);
  } catch (error) {
    body.innerHTML = `<div class="empty-state error">${esc(error.message)}<p>Use Setups → Michelson or Mach–Zehnder to start an aligned experiment.</p></div>`;
  }
}
function exportFringes() {
  try {
    const det = project.items.find((c) => c.id === activeDetector),
      { field: f, measured: m, key } = getFringes(det);
    const rows = [
      ["OptiBench simulated fringe measurement", ENGINE_VERSION],
      ["detector", det.label],
      ["wavelength_nm", f.wavelength],
      ["noise", noise],
      ["measurement_status", m.reason || "valid"],
      ["opd_nm", f.opd === null ? "" : f.opd * 1e6],
      ["fit_period_mm", m.fit?.period ?? ""],
      ["fit_visibility", m.fit?.visibility ?? ""],
      ["fit_phase_rad", m.fit?.phase ?? ""],
      ["fit_rms", m.fit ? Math.sqrt(m.fit.mse) : ""],
      ["predicted_coherence", f.coherence],
      ["sensor_clipped_fraction", m.saturated],
      [],
      ["x_mm", "envelope_normalized_signal"],
      ...m.samples.map((p) => [p.x, p.y]),
      [],
      [
        "sample_x_mm",
        det.type === "camera" ? "adc_fraction" : "sample_power_mw",
      ],
      ...Array.from({ length: m.n }, (_, i) => [
        ((i + 0.5) / m.n - 0.5) * m.width,
        m.values[Math.floor(m.n / 2) * m.n + i],
      ]),
    ];
    if (fringeScan?.key === key)
      rows.push(
        [],
        ["mirror_id", fringeScan.mirrorId],
        [
          "piston_nm",
          "predicted_irradiance_mw_mm2",
          "simulated_central_signal",
        ],
        ...fringeScan.rows.map((r) => [r.piston, r.irradiance, r.signal]),
      );
    download("optibench-interferometry.csv", csv(rows), "text/csv");
    notify("Fringe data and current phase scan exported.");
  } catch (error) {
    notify(error.message);
  }
}
function paintField(field, camera = false) {
  const canvas = $("#detector-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d"),
    n = field.n;
  canvas.width = n;
  canvas.height = n;
  const img = ctx.createImageData(n, n);
  let max = 0;
  for (const v of field.values) max = Math.max(max, v);
  for (let i = 0; i < n * n; i++) {
    let v = camera ? field.values[i] : field.values[i] / (max || 1);
    if (logScale) v = Math.log10(1 + 999 * v) / 3;
    const q = clamp(v, 0, 1);
    img.data[i * 4] = camera ? q * 255 : Math.min(255, q * 330);
    img.data[i * 4 + 1] = camera ? q * 255 : Math.min(255, q * 370);
    img.data[i * 4 + 2] = camera ? q * 255 : Math.min(200, q * 180);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}
function plotProfile(field) {
  const row = Array.from(
      field.values.slice(
        Math.floor(field.n / 2) * field.n,
        (Math.floor(field.n / 2) + 1) * field.n,
      ),
    ),
    max = Math.max(...row, 1e-30),
    path = row
      .map((v, i) => {
        let norm = v / max;
        if (logScale) norm = Math.log10(1 + 999 * norm) / 3;
        return `${i ? "L" : "M"}${15 + (i / (field.n - 1)) * 310} ${85 - norm * 70}`;
      })
      .join(" ");
  $("#profile-plot").innerHTML =
    `<path d="M15 15h310M15 50h310M15 85h310" stroke="#3a4654" stroke-dasharray="3 5"/><path d="${path}" stroke="#bbef84" fill="none" stroke-width="1.6"/><text x="15" y="107" fill="#9caaba" font-size="11">−${fmt(field.width / 2, 2)}</text><text x="166" y="107" fill="#9caaba" font-size="11">0</text><text x="285" y="107" fill="#9caaba" font-size="11">${fmt(field.width / 2, 2)} mm</text>`;
}
function scheduleWave() {
  clearTimeout(autoTimer);
  job++;
  waveResult = null;
  if (!running || mode !== "Fourier") return;
  waveBusy = true;
  renderResults();
  autoTimer = setTimeout(solve, 180);
}
function solve() {
  if (!worker) {
    waveError = "Web Workers are unavailable in this browser.";
    renderResults();
    return;
  }
  waveBusy = true;
  waveError = "";
  job++;
  worker.postMessage({
    job,
    project,
    options: {
      n: project.wave.n,
      width: project.wave.width,
      detectorId: activeDetector,
      imageData: project.items.some(
        (c) => c.type === "image" && c.pattern === "image",
      )
        ? resampleImage(project.image, project.wave.n)
        : null,
    },
  });
  renderResults();
  renderStatus();
}
function worldPoint(e) {
  const svg = $("#bench"),
    m = svg.getScreenCTM();
  if (!m) return { x: 0, y: 0 };
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
  return { x: p.x, y: p.y };
}
function snapPoint(p) {
  if (project.table.snapToHoles) {
    const t = project.table,
      lastX =
        t.border + Math.floor((t.width - 2 * t.border) / t.pitch) * t.pitch,
      lastY =
        t.border + Math.floor((t.height - 2 * t.border) / t.pitch) * t.pitch;
    return {
      x: clamp(
        t.border + Math.round((p.x - t.border) / t.pitch) * t.pitch,
        t.border,
        lastX,
      ),
      y: clamp(
        t.border + Math.round((p.y - t.border) / t.pitch) * t.pitch,
        t.border,
        lastY,
      ),
    };
  }
  const grid = project.table.snap;
  return {
    x: clamp(
      grid ? Math.round(p.x / grid) * grid : p.x,
      0,
      project.table.width,
    ),
    y: clamp(
      grid ? Math.round(p.y / grid) * grid : p.y,
      0,
      project.table.height,
    ),
  };
}
function closeDialog() {
  $("#dialog").close();
  $("#dialog-body").innerHTML = "";
}
function modal(title, body, wide = false) {
  $("#dialog-title").textContent = title;
  $("#dialog-body").innerHTML = body;
  $("#dialog").classList.toggle("wide", wide);
  if (!$("#dialog").open) $("#dialog").showModal();
}
function setProject(p) {
  project = validateProject(p);
  mode = project.solver;
  selected.clear();
  activeDetector = null;
  waveResult = null;
  result = null;
  job++;
  compute();
  saveLocal();
  renderPanels();
  fit();
  if (mode === "Fourier") scheduleWave();
}
function placePart(part, p) {
  if (project.items.length >= 300)
    return notify("This project supports up to 300 components.");
  checkpoint();
  const c = instantiate(part, nextId(), p.x, p.y);
  c.label = `${{ lens: "L", source: "S", image: "O", mirror: "M", splitter: "BS", camera: "D", screen: "D", power: "PM", aperture: "A", filter: "F", polarizer: "P" }[c.type] || "C"}${c.id} · ${c.name}`;
  project.items.push(c);
  selected = new Set([c.id]);
  pendingPart = null;
  tool = "select";
  commit();
}
function zoom(factor, p = { x: view.x + view.w / 2, y: view.y + view.h / 2 }) {
  const next = clamp(view.w * factor, 150, project.table.width * 4),
    ratio = next / view.w;
  view.x = p.x - (p.x - view.x) * ratio;
  view.y = p.y - (p.y - view.y) * ratio;
  view.w = next;
  view.h *= ratio;
  drawBench();
}
function download(filename, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function csv(rows) {
  return rows
    .map((row) =>
      row
        .map((v) => {
          let s = String(v ?? "");
          if (/^[=+@\-]/.test(s) && !/^[-+]?[0-9.]+$/.test(s)) s = "'" + s;
          return '"' + s.replace(/"/g, '""') + '"';
        })
        .join(","),
    )
    .join("\r\n");
}
function bind() {
  document.addEventListener("click", handleClick);
  document.addEventListener("change", handleChange);
  document.addEventListener("input", (e) => {
    if (e.target.id === "search") {
      query = e.target.value;
      renderCatalog();
    }
  });
  document.addEventListener("submit", handleSubmit);
  $("#dialog").addEventListener("cancel", () => {
    pendingPart = null;
  });
  $("#bench").addEventListener("pointerdown", (e) => {
    if (e.button === 2) return;
    e.preventDefault();
    const p = worldPoint(e);
    if (pendingPart) {
      placePart(pendingPart, snapPoint(p));
      return;
    }
    if (tool === "measure" && e.button === 0) {
      if (!measureStart) {
        measureStart = snapPoint(p);
        renderPanels();
      } else {
        checkpoint();
        project.measurements.push({ a: measureStart, b: snapPoint(p) });
        measureStart = null;
        commit();
      }
      return;
    }
    const el = e.target.closest("[data-component]");
    if ((tool === "pan" || e.button === 1 || e.altKey) && !pendingPart) {
      dragState = {
        kind: "pan",
        start: { x: e.clientX, y: e.clientY },
        view: { ...view },
      };
    } else if (el) {
      const id = +el.dataset.component,
        c = project.items.find((c) => c.id === id);
      if (e.shiftKey) {
        if (selected.has(id)) selected.delete(id);
        else selected.add(id);
      } else if (!selected.has(id)) selected = new Set([id]);
      dragState = {
        kind: "component",
        start: p,
        items: project.items
          .filter((c) => selected.has(c.id) && !c.locked)
          .map((c) => ({ id: c.id, x: c.x, y: c.y })),
        saved: false,
        moved: false,
      };
      renderInspector();
      drawBench();
      if (resultTab === "alignment") renderResults();
    } else {
      if (!e.shiftKey) selected.clear();
      renderInspector();
      drawBench();
      if (resultTab === "alignment") renderResults();
    }
    if (dragState) $("#bench").setPointerCapture(e.pointerId);
  });
  $("#bench").addEventListener("pointermove", (e) => {
    const p = worldPoint(e);
    $("#coordinate-readout").textContent =
      `X ${fmt(p.x, 1)}  Y ${fmt(p.y, 1)} mm`;
    if (!dragState) return;
    const d = dragState;
    if (d.kind === "pan") {
      const rect = $("#bench").getBoundingClientRect(),
        scale = d.view.w / rect.width;
      view.x = d.view.x - (e.clientX - d.start.x) * scale;
      view.y = d.view.y - (e.clientY - d.start.y) * scale;
      drawBench();
      return;
    }
    if (!d.items.length) return;
    const delta = { x: p.x - d.start.x, y: p.y - d.start.y };
    if (Math.hypot(delta.x, delta.y) < 0.01) return;
    if (!d.saved) {
      checkpoint();
      d.saved = true;
    }
    d.moved = true;
    const snap = project.table.snap,
      anchor = d.items[0],
      snapped = project.table.snapToHoles
        ? snapPoint({ x: anchor.x + delta.x, y: anchor.y + delta.y })
        : null,
      dx = snapped
        ? snapped.x - anchor.x
        : snap
          ? Math.round(delta.x / snap) * snap
          : delta.x,
      dy = snapped
        ? snapped.y - anchor.y
        : snap
          ? Math.round(delta.y / snap) * snap
          : delta.y;
    const minX = Math.min(...d.items.map((c) => c.x)),
      maxX = Math.max(...d.items.map((c) => c.x)),
      minY = Math.min(...d.items.map((c) => c.y)),
      maxY = Math.max(...d.items.map((c) => c.y));
    for (const initial of d.items) {
      const c = project.items.find((c) => c.id === initial.id);
      c.x = initial.x + clamp(dx, -minX, project.table.width - maxX);
      c.y = initial.y + clamp(dy, -minY, project.table.height - maxY);
    }
    if (!frame)
      frame = requestAnimationFrame(() => {
        frame = null;
        compute();
        drawBench();
        renderResults();
        renderStatus();
      });
  });
  $("#bench").addEventListener("pointerup", () => {
    if (dragState?.kind === "component") {
      const moved = dragState.moved;
      if (moved) commit();
    }
    dragState = null;
  });
  $("#bench").addEventListener("pointercancel", () => {
    if (dragState?.saved) commit();
    dragState = null;
  });
  $("#bench").addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      zoom(e.deltaY > 0 ? 1.1 : 1 / 1.1, worldPoint(e));
    },
    { passive: false },
  );
  document.addEventListener("dragstart", (e) => {
    const el = e.target.closest("[data-part]");
    if (el && e.dataTransfer)
      e.dataTransfer.setData("application/x-optibench-part", el.dataset.part);
  });
  $("#bench").addEventListener("dragover", (e) => e.preventDefault());
  $("#bench").addEventListener("drop", (e) => {
    e.preventDefault();
    const part = catalog.find(
      (c) => c.id === e.dataTransfer.getData("application/x-optibench-part"),
    );
    if (part) placePart(part, snapPoint(worldPoint(e)));
  });
  window.addEventListener("keydown", (e) => {
    if (document.querySelector("#measurement-workspace:not([hidden])")) return;
    const editing = ["INPUT", "TEXTAREA", "SELECT"].includes(
      document.activeElement.tagName,
    );
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      saveFile();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
      e.preventDefault();
      ($("#library-panel").getClientRects().length ? $("#search") : $(".inventory-toggle")).focus();
      return;
    }
    if (e.key === "Escape") {
      pendingPart = null;
      measureStart = null;
      drawBench();
      renderPanels();
      return;
    }
    if (editing || $("#dialog").open) return;
    if ((e.metaKey || e.ctrlKey) && e.key === "z") {
      e.preventDefault();
      undo(e.shiftKey);
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      removeSelected();
      return;
    }
    if (e.key.toLowerCase() === "f") fit();
    if (e.key.toLowerCase() === "v") {
      tool = "select";
      renderPanels();
    }
    if (e.key.toLowerCase() === "h") {
      tool = "pan";
      renderPanels();
    }
    if (e.key.toLowerCase() === "m") {
      tool = "measure";
      renderPanels();
    }
    if (e.key.toLowerCase() === "r") rotateSelected();
    if (
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key) &&
      selected.size
    ) {
      e.preventDefault();
      checkpoint();
      const step = (project.table.snap || 1) * (e.shiftKey ? 10 : 1);
      for (const c of project.items.filter(
        (c) => selected.has(c.id) && !c.locked,
      )) {
        c.x = clamp(
          c.x +
            (e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0),
          0,
          project.table.width,
        );
        c.y = clamp(
          c.y +
            (e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0),
          0,
          project.table.height,
        );
      }
      commit();
    }
  });
  new ResizeObserver(() => {
    const stage = $("#stage");
    if (!stage.clientWidth || !stage.clientHeight) return;
    const ratio = stage.clientWidth / stage.clientHeight;
    const tableWidth = project.table.width + 120;
    const tableHeight = project.table.height + 120;
    // Keep the user's zoom relative to Fit while adapting to the new panel shape.
    const zoom = view.w / Math.max(tableWidth, tableHeight * view.w / view.h);
    const width = Math.max(tableWidth, tableHeight * ratio) * zoom;
    const height = width / ratio;
    view = {
      x: view.x + (view.w - width) / 2,
      y: view.y + (view.h - height) / 2,
      w: width,
      h: height,
    };
    drawBench();
  }).observe($("#stage"));
  $("#project-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 12e6)
        throw Error("Project files must be smaller than 12 MB.");
      const p = validateProject(JSON.parse(await f.text()));
      checkpoint();
      setProject(p);
      notify("Project opened. Previous state is available with Undo.");
    } catch (error) {
      notify(error.message);
    }
    e.target.value = "";
  };
  $("#catalog-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 2e6) throw Error("Catalog file is too large.");
      const rows = JSON.parse(await f.text());
      if (!Array.isArray(rows) || rows.length > 200)
        throw Error("Catalog import expects an array of up to 200 components.");
      const validated = rows.map(
        (c, i) =>
          validateProject({
            ...makeProject("empty"),
            items: [{ ...c, id: i + 1, x: 100, y: 100 }],
          }).items[0],
      );
      for (const c of validated) {
        const id = "CUSTOM-" + c.part;
        if (!catalog.some((p) => p.id === id))
          catalog.unshift({
            ...c,
            id,
            provenance: "ideal",
            brand: "Custom",
            category: categories.includes(c.category)
              ? c.category
              : "Optomechanics",
          });
      }
      persistCustomCatalog();
      renderCatalog();
      notify(
        `${validated.length} custom entries imported; all are user-supplied specifications.`,
      );
    } catch (error) {
      notify(error.message);
    }
    e.target.value = "";
  };
  $("#image-file").onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      if (f.size > 15e6) throw Error("Use an image smaller than 15 MB.");
      const bitmap = await createImageBitmap(f);
      const n = 256,
        canvas = document.createElement("canvas");
      canvas.width = n;
      canvas.height = n;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, n, n);
      const factor = Math.min(n / bitmap.width, n / bitmap.height),
        w = bitmap.width * factor,
        h = bitmap.height * factor;
      ctx.drawImage(bitmap, (n - w) / 2, (n - h) / 2, w, h);
      bitmap.close();
      const data = ctx.getImageData(0, 0, n, n).data,
        values = [];
      for (let i = 0; i < n * n; i++)
        values.push(
          (0.2126 * data[i * 4] +
            0.7152 * data[i * 4 + 1] +
            0.0722 * data[i * 4 + 2]) /
            255,
        );
      checkpoint();
      project.image = { n, name: f.name, values };
      const c = selectedItem();
      if (c?.type === "image") c.pattern = "image";
      commit();
      notify("Coherent image source loaded and included in project files.");
    } catch (error) {
      notify(error.message);
    }
    e.target.value = "";
  };
}
function saveFile() {
  download(
    (project.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "optibench") +
      ".optibench.json",
    JSON.stringify({ ...project, savedAt: new Date().toISOString() }, null, 2),
  );
  notify(
    "Project file downloaded, including table, components and source image.",
  );
}
function undo(forward = false) {
  const stack = forward ? redo : history;
  if (!stack.length)
    return notify(forward ? "No changes to redo." : "No changes to undo.");
  (forward ? history : redo).push(snapshot());
  setProject(JSON.parse(stack.pop()));
}
function removeSelected() {
  if (!selected.size) return;
  checkpoint();
  project.items = project.items.filter((c) => !selected.has(c.id) || c.locked);
  selected.clear();
  commit();
}
function rotateSelected() {
  if (!selected.size) return;
  checkpoint();
  for (const c of project.items)
    if (selected.has(c.id) && !c.locked) c.angle = (c.angle + 15) % 360;
  commit();
}
function handleClick(e) {
  const b = e.target.closest("[data-action]");
  if (!b) return;
  const a = b.dataset.action,
    id = +b.dataset.id,
    part = catalog.find((c) => c.id === b.dataset.part);
  if (a.startsWith("tool-")) {
    tool = a.slice(5);
    pendingPart = null;
    measureStart = null;
    renderPanels();
    return;
  }
  if (a.startsWith("result-")) {
    resultTab = a.slice(7);
    showResults = true;
    renderResults();
    return;
  }
  switch (a) {
    case "show-alignment":
      resultTab = "alignment";
      showResults = true;
      renderResults();
      break;
    case "stage-rebase": {
      const c = selectedItem();
      if (!c) return;
      if (c.locked)
        return notify("Unlock the component before relocating its base.");
      checkpoint();
      c.stageOriginX = c.x;
      c.stageOriginY = c.y;
      c.stageOriginZ = c.z;
      commit();
      break;
    }
    case "alignment-nudge": {
      const c = selectedItem();
      if (!c) return notify("Select a source, mirror or mounted optic first.");
      const axis = b.dataset.axis,
        delta =
          +b.dataset.sign *
          (["angle", "pitch"].includes(axis)
            ? (alignmentAngleStep * 180) / Math.PI / 1000
            : alignmentPositionStep),
        before = snapshot();
      try {
        const next = stageMove(c, axis, delta);
        project.items = project.items.map((o) => (o.id === c.id ? next : o));
        project = validateProject(project);
        history.push(before);
        redo = [];
        commit();
      } catch (error) {
        project = JSON.parse(before);
        notify(error.message);
      }
      break;
    }
    case "export-alignment":
      download(
        "optibench-alignment.csv",
        csv([
          [
            "id",
            "label",
            "x_mm",
            "y_mm",
            "z_mm",
            "normal_deg",
            "elevation_deg",
            "mount",
            "post_mm",
            "thread",
            "stage_x_offset_mm",
            "stage_y_offset_mm",
            "stage_z_offset_mm",
          ],
          ...project.items.map((c) => [
            c.id,
            c.label,
            c.x,
            c.y,
            c.z,
            c.angle,
            c.pitch,
            c.mountType,
            c.postLength,
            c.mountThread,
            c.x - c.stageOriginX,
            c.y - c.stageOriginY,
            c.z - c.stageOriginZ,
          ]),
        ]),
        "text/csv",
      );
      break;
    case "validation":
      validationCenter.open();
      break;
    case "alignment-practice":
      practiceWorkspace.open();
      break;
    case "instrument-lab":
      instrumentWorkspace.open();
      break;
    case "first-experiment":
      guidedWorkspace.open();
      break;
    case "projects":
      projectNavigator.open();
      break;
    case "simulation-runs":
      simulationWorkspace.open();
      break;
    case "measurements":
      measurementWorkspace.open();
      break;
    case "bench":
      fit();
      break;
    case "library":
    case "inspect":
      $(".app-layout").dispatchEvent(new document.defaultView.CustomEvent("toggle-panel", {detail:{name:a === "library" ? "inventory" : "inspector"}}));
      break;
    case "close-dialog":
      closeDialog();
      break;
    case "fit":
      fit();
      break;
    case "zoom-in":
      zoom(1 / 1.25);
      break;
    case "zoom-out":
      zoom(1.25);
      break;
    case "grid":
      showGrid = !showGrid;
      b.classList.toggle("active", showGrid);
      drawBench();
      break;
    case "undo":
      undo();
      break;
    case "redo":
      undo(true);
      break;
    case "run":
      running = !running;
      if (running) {
        compute();
        if (mode === "Fourier") scheduleWave();
      } else {
        clearTimeout(autoTimer);
        job++;
        waveBusy = false;
      }
      renderPanels();
      break;
    case "open":
      $("#project-file").click();
      break;
    case "save":
      saveFile();
      break;
    case "project":
      projectDialog();
      break;
    case "table":
      tableDialog();
      break;
    case "templates":
      templateDialog();
      break;
    case "template":
      checkpoint();
      mode = ["relay", "diffraction"].includes(b.dataset.template)
        ? "Fourier"
        : ["michelson", "mach-zehnder"].includes(b.dataset.template)
          ? "Interferometry"
          : "Gaussian";
      showResults = true;
      resultTab = "detector";
      closeDialog();
      setProject(makeProject(b.dataset.template));
      if (b.dataset.template === "alignment") {
        resultTab = "alignment";
        renderResults();
      }
      break;
    case "phase-scan":
      try {
        const mirrorId = +$("#scan-mirror").value;
        fringeScan = {
          key: snapshot() + activeDetector + noise,
          rows: phaseScan(project, activeDetector, mirrorId, { noise }),
          mirrorId,
        };
        renderResults();
      } catch (error) {
        notify(error.message);
      }
      break;
    case "fringe-export":
      exportFringes();
      break;
    case "guide":
      guideDialog();
      break;
    case "bom":
      bomDialog();
      break;
    case "export-bom":
      exportBom();
      break;
    case "export-svg":
      exportSvg();
      break;
    case "export-results":
      exportResults();
      break;
    case "collapse-results":
      showResults = !showResults;
      renderResults();
      break;
    case "add":
      if (part) {
        pendingPart = part;
        tool = "select";
        if ($("#dialog").open) closeDialog();
        renderPanels();
      }
      break;
    case "catalog-info":
      if (part) catalogDialog(part);
      break;
    case "compare":
      compareDialog();
      break;
    case "custom":
      customDialog();
      break;
    case "import-catalog":
      $("#catalog-file").click();
      break;
    case "catalog-template":
      download(
        "optibench-catalog-template.json",
        JSON.stringify(
          [
            {
              ...instantiate("DESIGN-LENS-25.4-100", 1, 100, 100),
              part: "MY-LENS-100",
              name: "Custom 100 mm lens",
              brand: "Custom",
              category: "Lenses",
            },
          ],
          null,
          2,
        ),
      );
      break;
    case "select":
      if (project.items.some((c) => c.id === id)) {
        selected = new Set([id]);
        if ($("#dialog").open) closeDialog();
        renderInspector();
        drawBench();
        if (resultTab === "alignment") renderResults();
      }
      break;
    case "rotate":
      rotateSelected();
      break;
    case "duplicate": {
      if (!selected.size || project.items.length + selected.size > 300) break;
      checkpoint();
      let id = nextId();
      const copies = project.items
        .filter((c) => selected.has(c.id))
        .map((c) => ({
          ...structuredClone(c),
          id: id++,
          x: clamp(c.x + 50, 0, project.table.width),
          y: clamp(c.y + 50, 0, project.table.height),
          locked: false,
          label: c.label + " copy",
        }));
      project.items.push(...copies);
      selected = new Set(copies.map((c) => c.id));
      commit();
      break;
    }
    case "remove":
      removeSelected();
      break;
    case "reset-component": {
      const c = selectedItem(),
        base = catalog.find((p) => p.id === c?.catalogId);
      if (base) {
        checkpoint();
        for (const key of [
          "f",
          "diameter",
          "aperture",
          "transmission",
          "reflectivity",
          "waist",
          "wavelength",
          "m2",
          "power",
          "axis",
        ])
          if (base[key] !== undefined) c[key] = base[key];
        commit();
      }
      break;
    }
    case "replace":
      replaceDialog();
      break;
    case "replace-with": {
      const c = selectedItem();
      if (c && part) {
        checkpoint();
        const newC = instantiate(part, c.id, c.x, c.y, {
          angle: c.angle,
          label: c.label,
          notes: c.notes,
        });
        project.items[project.items.findIndex((x) => x.id === c.id)] = newC;
        closeDialog();
        commit();
      }
      break;
    }
    case "upload-image":
      $("#image-file").click();
      break;
    case "solve-wave":
      solve();
      break;
    case "analysis":
      analysisDialog();
      break;
    case "design":
      designDialog();
      break;
    case "apply-design":
      applyDesign(+b.dataset.index);
      break;
    case "clear-measures":
      checkpoint();
      project.measurements = [];
      measureStart = null;
      commit();
      notify("Measurements cleared.");
      break;
    case "export-tolerance":
      if (lastTolerance)
        download(
          "optibench-tolerance.csv",
          csv([
            ["diameter_mm", "power_mw", "offset_mm"],
            ...lastTolerance.samples.map((s) => [
              s.diameter,
              s.power,
              s.offset,
            ]),
          ]),
          "text/csv",
        );
      break;
    case "apply-sweep":
      if (lastSweep) {
        checkpoint();
        const c = project.items.find((c) => c.id === lastSweep.componentId);
        if (c) {
          c[lastSweep.parameter] = lastSweep.best.value;
          closeDialog();
          commit();
        }
      }
      break;
  }
}
function handleChange(e) {
  const el = e.target;
  if (el.id === "side-axis") {
    sideAxis = el.value;
    renderResults();
    return;
  }
  if (el.id === "alignment-angle-step" || el.id === "alignment-position-step") {
    if (!el.checkValidity()) {
      el.reportValidity();
      return;
    }
    if (el.id === "alignment-angle-step") alignmentAngleStep = +el.value;
    else alignmentPositionStep = +el.value;
    return;
  }
  if (el.dataset.compare) {
    if (el.checked && compare.size >= 4) {
      el.checked = false;
      return notify("Compare up to four components.");
    }
    if (el.checked) compare.add(el.dataset.compare);
    else compare.delete(el.dataset.compare);
    $("#compare-button span").textContent = `Compare (${compare.size})`;
    return;
  }
  if (el.dataset.field) {
    const c = selectedItem();
    if (!c) return;
    if (
      c.locked &&
      ["x", "y", "z", "pitch", "angle", "mountType", "postLength"].includes(
        el.dataset.field,
      )
    ) {
      renderInspector();
      return notify("Unlock this component before moving it.");
    }
    if (!el.checkValidity()) {
      el.reportValidity();
      return;
    }
    const before = snapshot(),
      value =
        el.type === "checkbox"
          ? el.checked
          : el.type === "number"
            ? +el.value
            : el.value;
    c[el.dataset.field] = value;
    if (el.dataset.field === "mountType" && value !== "none") {
      c.z ??= project.table.heightAbove;
      c.postLength = Math.max(0, c.z - mountModels[value].base - 25);
      c.mountThread = project.table.thread;
      if (value === "xyz") {
        c.stageOriginX = c.x;
        c.stageOriginY = c.y;
        c.stageOriginZ = c.z;
        c.footprint = Math.max(c.footprint, 60);
      }
    }
    try {
      const p = validateProject(project);
      history.push(before);
      redo = [];
      project = p;
      commit();
    } catch (error) {
      project = JSON.parse(before);
      renderInspector();
      notify(error.message);
    }
    return;
  }
  if (["category", "brand", "scope", "sort"].includes(el.id)) {
    if (el.id === "category") category = el.value;
    if (el.id === "brand") brand = el.value;
    if (el.id === "scope") scope = el.value;
    if (el.id === "sort") sort = el.value;
    renderCatalog();
  }
  if (el.id === "mode") {
    mode = el.value;
    if (mode === "Alignment") {
      resultTab = "alignment";
      showResults = true;
    }
    project.solver = mode;
    saveLocal();
    waveResult = null;
    compute(true);
    if (mode === "Fourier") scheduleWave();
    renderPanels();
  }
  if (el.id === "detector-select") {
    activeDetector = +el.value;
    if (mode === "Fourier") scheduleWave();
    renderResults();
  }
  if (el.id === "envelope") {
    showEnvelope = el.checked;
    drawBench();
  }
  if (el.id === "labels") {
    showLabels = el.checked;
    drawBench();
  }
  if (el.id === "branch-select") {
    activeBranch = +el.value;
    renderResults();
  }
  if (el.id === "logscale") {
    logScale = el.checked;
    renderResults();
  }
  if (el.id === "noise") {
    noise = el.checked;
    renderResults();
  }
  if (el.id === "wave-n" || el.id === "wave-width") {
    if (!el.checkValidity()) return el.reportValidity();
    checkpoint();
    project.wave[el.id === "wave-n" ? "n" : "width"] = +el.value;
    commit();
  }
}
function projectDialog() {
  modal(
    "Project settings",
    `<form data-form="project"><label class="field"><span>Experiment name</span><input name="title" maxlength="100" required value="${esc(project.title)}"></label><label class="field"><span>Experiment notes</span><textarea name="notes" rows="6" maxlength="10000">${esc(project.notes)}</textarea></label><p class="dialog-note">Automatic recovery is local to this browser. Download a project file for a portable copy, including uploaded source images.</p><div class="dialog-actions"><button class="accent" type="submit">Save project settings</button>${button("save", "Download project", "download", "outline")}</div></form>`,
  );
}
function tableDialog() {
  const t = project.table;
  modal(
    "Laboratory optical table",
    `<form data-form="table"><p class="dialog-note">An orthographic layout in millimetres. Hole centers and component positions share the same coordinate system.</p><div class="two-col"><label class="field"><span>Width (mm)</span><input name="width" type="number" min="300" max="6000" required value="${t.width}"></label><label class="field"><span>Depth (mm)</span><input name="height" type="number" min="300" max="4000" required value="${t.height}"></label></div><label class="field"><span>Thread and hole layout</span><select name="standard"><option value="metric" ${t.thread === "M6" ? "selected" : ""}>M6 · 25 mm centers · 12.5 mm border</option><option value="imperial" ${t.thread !== "M6" ? "selected" : ""}>¼″–20 · 25.4 mm centers · 12.7 mm border</option></select></label><div class="two-col"><label class="field"><span>Movement snap (mm; 0 = free)</span><input name="snap" type="number" step="any" min="0" max="100" value="${t.snap}" required></label><label class="field"><span>Default height for new optics (mm)</span><input name="heightAbove" type="number" min="1" max="1000" value="${t.heightAbove}" required></label></div><label class="checkbox-row"><input name="snapToHoles" type="checkbox" ${t.snapToHoles ? "checked" : ""}>Snap the selected anchor to mounting-hole centers</label><label class="checkbox-row"><input name="showMounts" type="checkbox" ${t.showMounts ? "checked" : ""}>Show mounting envelopes</label><p class="dialog-note">Changing the default height does not move existing optics. Set each optic’s height and mount in the inspector; use Alignment to inspect the first-order elevation trace.</p><a class="source-link" href="https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=7154&pn=B1824F" target="_blank" rel="noopener">Manufacturer hole-spacing reference ${icon("external", 14)}</a><div class="dialog-actions"><button type="submit" class="accent">Apply table settings</button>${button("clear-measures", "Clear measurements", "trash", "outline")}</div></form>`,
  );
}
function templateDialog() {
  modal(
    "Experiment library",
    `<p class="dialog-note">Each setup is editable and uses the same optical solvers. Loading a setup preserves the current project in Undo.</p><div class="template-grid">${templates.map(([id, title, desc, solver], i) => `<button data-action="template" data-template="${id}" class="template-card"><span class="template-number">${String(i + 1).padStart(2, "0")} <small>${solver}</small></span><h3>${title}</h3><p>${desc}</p><span class="template-open">Open setup ${icon("chevron", 14)}</span></button>`).join("")}</div>`,
    true,
  );
}
function catalogDialog(c) {
  const src = sources[c.provenance] || sources.ideal;
  modal(
    c.part,
    `<div class="catalog-detail-heading"><div class="inspector-glyph">${icon(typeIcon(c.type), 40)}</div><div><span class="eyebrow">${esc(c.brand)}</span><h3>${esc(c.name)}</h3><span class="provenance">${c.provenance === "ideal" ? "PARAMETRIC DESIGN" : "MANUFACTURER REFERENCE"}</span></div></div><dl class="specs dialog-specs">${[
      ["Diameter", c.diameter + " mm"],
      ["Focal length", c.f ? c.f + " mm" : null],
      ["Back focal length", c.bfl ? c.bfl + " mm" : null],
      ["Coating", c.coating],
      ["Glass", c.glass],
      ["Thread", c.thread],
      ["Wavelength", c.wavelength ? c.wavelength + " nm" : null],
      ["Reference checked", src.checked],
    ]
      .filter(([, v]) => v)
      .map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`)
      .join(
        "",
      )}</dl><p class="dialog-note">${esc(src.status)}. Nominal EFL is used in an ideal thin-lens model. Mount footprint, clear aperture, loss and sensor-noise defaults are editable assumptions unless explicitly sourced. No live pricing or stock feed is connected.</p>${src.url ? `<a class="source-link" href="${esc(src.url)}" target="_blank" rel="noopener">Open manufacturer source ${icon("external", 14)}</a>` : ""}<div class="dialog-actions">${button("add", "Place on table", "plus", "accent", `data-part="${esc(c.id)}"`)}</div>`,
  );
}
function compareDialog() {
  const rows = catalog.filter((c) => compare.has(c.id));
  if (!rows.length)
    return notify(
      "Select the small checkboxes on inventory cards to compare components.",
    );
  modal(
    "Component comparison",
    `<div class="data-scroll"><table class="compare-table"><thead><tr><th>Specification</th>${rows.map((c) => `<th>${esc(c.part)}</th>`).join("")}</tr></thead><tbody>${[
      ["Manufacturer", "brand"],
      ["Type", "name"],
      ["Focal length (mm)", "f"],
      ["Diameter (mm)", "diameter"],
      ["BFL (mm)", "bfl"],
      ["Coating", "coating"],
      ["Thread", "thread"],
    ]
      .map(
        ([label, key]) =>
          `<tr><th>${label}</th>${rows.map((c) => `<td>${esc(c[key] ?? "Not specified")}</td>`).join("")}</tr>`,
      )
      .join(
        "",
      )}<tr><th>Action</th>${rows.map((c) => `<td>${button("add", "Place", "plus", "outline", `data-part="${esc(c.id)}"`)}</td>`).join("")}</tr></tbody></table></div>`,
    true,
  );
}
function customDialog() {
  modal(
    "Custom inventory component",
    `<form data-form="custom"><p class="dialog-note">Custom entries carry user-supplied specifications and are saved in this browser. They are never marked as manufacturer-verified.</p><div class="two-col"><label class="field"><span>Part number</span><input name="part" required maxlength="60" placeholder="LAB-LENS-100"></label><label class="field"><span>Display name</span><input name="name" required maxlength="100" placeholder="Custom lens"></label></div><label class="field"><span>Component model</span><select name="base">${["DESIGN-LENS-25.4-100", "DESIGN-MIRROR-25.4", "DESIGN-BS-50", "DESIGN-IRIS-5", "DESIGN-ND-1", "DESIGN-POL-0", "DESIGN-CAMERA", "DESIGN-LASER-532", "DESIGN-BASE-50"].map((id) => `<option value="${id}">${esc(catalog.find((c) => c.id === id).name)}</option>`).join("")}</select></label><p class="dialog-note">Choose a starting model, place it, then set its precise optical and mechanical values in the inspector. Use catalog JSON for bulk import.</p><div class="dialog-actions"><button type="submit" class="accent">Create component</button>${button("catalog-template", "Download import template", "download", "outline")}</div></form>`,
  );
}
function persistCustomCatalog() {
  try {
    localStorage.setItem(
      "optibench-custom-catalog",
      JSON.stringify(catalog.filter((c) => c.brand === "Custom")),
    );
  } catch {
    notify(
      "Custom catalog could not be saved locally. Export a project file to preserve placed components.",
    );
  }
}
function bomRows() {
  const groups = new Map();
  for (const c of project.items) {
    const key = [
      c.part,
      c.enabled,
      c.f,
      c.diameter,
      c.aperture,
      c.transmission,
      c.reflectivity,
    ].join("|");
    if (!groups.has(key)) groups.set(key, { ...c, qty: 0, labels: [] });
    groups.get(key).qty++;
    groups.get(key).labels.push(c.label);
  }
  return [...groups.values()];
}
function bomDialog() {
  const rows = bomRows();
  modal(
    "Bill of materials",
    `<div class="dialog-intro-row"><p class="dialog-note">${project.items.length} placed components · ${rows.length} line items. Optical elements and separately placed mechanical parts are listed; unplaced mounting hardware is not inferred.</p>${button("export-bom", "Export CSV", "download", "accent")}</div><div class="data-scroll"><table><thead><tr><th>Qty</th><th>Component / part</th><th>Manufacturer</th><th>Model EFL</th><th>Status</th><th>Reference</th></tr></thead><tbody>${rows.map((c) => `<tr><td>${c.qty}</td><td><strong>${esc(c.name)}</strong><small>${esc(c.part)}</small></td><td>${esc(c.brand)}</td><td>${c.f ? c.f + " mm" : "—"}</td><td>${c.enabled ? "Enabled" : "Disabled"}</td><td>${sources[c.provenance]?.url ? `<a class="source-link" target="_blank" rel="noopener" href="${esc(sources[c.provenance].url)}">Source ↗</a>` : "Custom / ideal"}</td></tr>`).join("")}</tbody></table></div><p class="dialog-note">Manufacturer references are sourced catalog entries, including legacy entries. Check current availability, coatings, clear apertures, mount compatibility and damage thresholds before procurement.</p><div class="dialog-actions">${button("export-svg", "Export table drawing (SVG)", "download", "outline")}${button("save", "Download complete project", "save", "outline")}</div>`,
    true,
  );
}
function exportBom() {
  download(
    "optibench-bill-of-materials.csv",
    csv([
      [
        "qty",
        "name",
        "part",
        "manufacturer",
        "enabled",
        "model_efl_mm",
        "diameter_mm",
        "clear_aperture_mm_assumed",
        "transmission_model",
        "reflectivity_model",
        "source",
        "checked",
        "labels",
      ],
      ...bomRows().map((c) => [
        c.qty,
        c.name,
        c.part,
        c.brand,
        c.enabled,
        c.f,
        c.diameter,
        c.aperture,
        c.transmission,
        c.reflectivity,
        sources[c.provenance]?.url || "",
        sources[c.provenance]?.checked || "",
        c.labels.join("; "),
      ]),
    ]),
    "text/csv",
  );
}
function exportSvg() {
  const clone = $("#bench").cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", "1800");
  clone.setAttribute("height", String(Math.round((1800 * view.h) / view.w)));
  download(
    "optibench-table.svg",
    new XMLSerializer().serializeToString(clone),
    "image/svg+xml",
  );
}
function exportResults() {
  if (mode === "Interferometry") return exportFringes();
  const rows = [
    [
      "component_id",
      "source_id",
      "branch",
      "path_mm",
      "radius_mm",
      "power_mw",
      "decenter_mm",
      "incidence_degrees",
    ],
    ...(result?.hits || []).map((h) => [
      h.id,
      h.source,
      h.branch,
      h.distance,
      h.radius,
      h.power,
      h.offset,
      h.incidence,
    ]),
  ];
  download("optibench-optical-path.csv", csv(rows), "text/csv");
  if (mode === "Fourier" && waveResult) {
    const f = waveResult;
    download(
      "optibench-wave-cross-section.csv",
      csv([
        ["x_mm", "power_per_sample_mw"],
        ...Array.from({ length: f.n }, (_, i) => [
          ((i - f.n / 2) * f.width) / f.n,
          f.values[Math.floor(f.n / 2) * f.n + i],
        ]),
      ]),
      "text/csv",
    );
  }
}
let lastTolerance = null,
  lastSweep = null,
  designMatches = [];
function analysisDialog() {
  const dets = project.items.filter((c) =>
      ["screen", "camera", "power"].includes(c.type),
    ),
    lenses = project.items.filter((c) => c.type === "lens");
  if (!dets.length) return notify("Add a detector before running analysis.");
  modal(
    "Tolerance & optimization",
    `<div class="analysis-columns"><section><h3>Monte Carlo tolerances</h3><p class="dialog-note">Independent uniform perturbations, evaluated with the 2D Gaussian model. A fixed seed makes results reproducible.</p><form data-form="tolerance"><label class="field"><span>Detector</span><select name="detector">${dets.map((c) => `<option value="${c.id}" ${c.id === activeDetector ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label><div class="two-col">${formNumber("X/Y position ± mm", "position", 0.1, 0, 20)}${formNumber("Rotation ± degrees", "angle", 0.05, 0, 5)}${formNumber("Focal length ± %", "focal", 0.5, 0, 20)}${formNumber("Random seed", "seed", 42, 1, 999999, 1)}</div><label class="field"><span>Trials</span><select name="trials"><option>200</option><option>500</option><option>1000</option></select></label><button type="submit" class="accent">Run tolerance analysis</button></form><div id="tolerance-output"></div></section><section><h3>One-parameter optimization</h3><p class="dialog-note">Sample 41 settings and find the smallest detected Gaussian beam diameter. Inspect the result before applying.</p><form data-form="sweep"><label class="field"><span>Component</span><select name="component">${lenses.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></label><label class="field"><span>Parameter</span><select name="parameter"><option value="x">X position (mm)</option><option value="f">Focal length (mm)</option></select></label><div class="two-col">${formNumber("Minimum", "min", lenses[0] ? Math.max(1, lenses[0].x - 25) : 100, 1, 6000)}${formNumber("Maximum", "max", lenses[0] ? lenses[0].x + 25 : 200, 1, 6000)}</div><button type="submit" class="outline" ${lenses.length ? "" : "disabled"}>Run parameter sweep</button></form><div id="sweep-output"></div></section></div>`,
    true,
  );
}
function formNumber(label, name, value, min, max, step = "any") {
  return `<label class="field"><span>${label}</span><input name="${name}" type="number" value="${value}" min="${min}" max="${max}" step="${step}" required></label>`;
}
function designDialog() {
  modal(
    "Reverse design · beam expander",
    `<p class="dialog-note">Search compatible positive or negative input lenses and positive output lenses. The solver uses f₂/f₁ and f₁ + f₂, filters catalog coating ranges when known, and reserves a 1.5× aperture margin.</p><form data-form="design"><div class="four-col">${formNumber("Input diameter (mm)", "input", 1.2, 0.01, 100)}${formNumber("Target diameter (mm)", "target", 10, 0.01, 100)}${formNumber("Max separation (mm)", "length", 1000, 10, 4000)}${formNumber("Wavelength (nm)", "wavelength", 532, 200, 20000)}</div><label class="checkbox-row"><input name="reference" type="checkbox" checked>Search manufacturer references only</label><button type="submit" class="accent">Find lens pairs</button></form><div id="design-output"></div>`,
    true,
  );
}
function applyDesign(index) {
  const m = designMatches[index];
  if (!m) return;
  checkpoint();
  const p = makeProject("empty"),
    width = Math.max(1500, Math.ceil((m.separation + 650) / 100) * 100);
  p.title = `${fmt(m.mag, 2)}× ${m.a.f < 0 ? "Galilean" : "Keplerian"} beam expander`;
  p.table.width = width;
  p.items = [
    instantiate("DESIGN-LASER-532", 1, 150, 450, {
      waist: m.input / 2,
      wavelength: m.wavelength,
      label: "S1 · Input beam",
    }),
    instantiate(m.a, 2, 350, 450, { label: "L1 · Input optic" }),
    instantiate(m.b, 3, 350 + m.separation, 450, {
      label: "L2 · Output optic",
    }),
    instantiate("DESIGN-SCREEN-50", 4, 550 + m.separation, 450, {
      label: "D1 · Output plane",
      diameter: Math.max(50, m.output * 2),
      terminate: true,
    }),
  ];
  mode = "Gaussian";
  closeDialog();
  setProject(p);
  notify("Lens pair placed. Inspect the simulated output and design checks.");
}
async function handleSubmit(e) {
  const form = e.target.closest("[data-form]");
  if (!form) return;
  e.preventDefault();
  const data = new FormData(form),
    num = (k) => Number(data.get(k));
  try {
    switch (form.dataset.form) {
      case "project":
        checkpoint();
        project.title = String(data.get("title")).trim();
        project.notes = String(data.get("notes"));
        closeDialog();
        commit();
        break;
      case "table": {
        const standard = data.get("standard") === "metric";
        const t = {
          ...project.table,
          width: num("width"),
          height: num("height"),
          thread: standard ? "M6" : "¼″–20",
          pitch: standard ? 25 : 25.4,
          border: standard ? 12.5 : 12.7,
          snap: num("snap"),
          heightAbove: num("heightAbove"),
          showMounts: data.has("showMounts"),
          snapToHoles: data.has("snapToHoles"),
        };
        const p = validateProject({ ...project, table: t });
        checkpoint();
        project = p;
        closeDialog();
        commit();
        fit();
        break;
      }
      case "custom": {
        const base = catalog.find((c) => c.id === data.get("base")),
          part = String(data.get("part")).trim(),
          name = String(data.get("name")).trim();
        if (catalog.some((c) => c.id === "CUSTOM-" + part))
          throw Error(
            "A custom component with that part number already exists.",
          );
        const c = {
          ...structuredClone(base),
          id: "CUSTOM-" + part,
          part,
          name,
          brand: "Custom",
          provenance: "ideal",
        };
        catalog.unshift(c);
        persistCustomCatalog();
        closeDialog();
        renderCatalog();
        pendingPart = c;
        renderPanels();
        break;
      }
      case "design": {
        designMatches = designExpander(
          catalog.filter(
            (c) => !data.has("reference") || c.provenance !== "ideal",
          ),
          num("input"),
          num("target"),
          num("length"),
          num("wavelength"),
        ).map((m) => ({
          ...m,
          input: num("input"),
          wavelength: num("wavelength"),
        }));
        $("#design-output").innerHTML = designMatches.length
          ? `<div class="data-scroll"><table><thead><tr><th>Input lens</th><th>Output lens</th><th>Output Ø</th><th>Separation</th><th>Error</th><th></th></tr></thead><tbody>${designMatches.map((m, i) => `<tr><td>${esc(m.a.part)}<small>${m.a.f} mm · ${esc(m.a.brand)}</small></td><td>${esc(m.b.part)}<small>${m.b.f} mm · ${esc(m.b.brand)}</small></td><td>${fmt(m.output, 3)} mm</td><td>${fmt(m.separation, 1)} mm</td><td>${pct(m.error)}</td><td>${button("apply-design", "Build", "plus", "outline", `data-index="${i}"`)}</td></tr>`).join("")}</tbody></table></div><p class="dialog-note">Nominal afocal design assumes collimated input. Beam-waist curvature, lens aberrations and unknown coating data still require verification. Building a pair replaces the current table; Undo restores it.</p>`
          : '<div class="empty-state">No compatible lens pairs. Increase the permitted length or include ideal designs.</div>';
        break;
      }
      case "tolerance": {
        const submit = form.querySelector('[type="submit"]');
        submit.disabled = true;
        submit.textContent = "Running trials…";
        const params = {
          trials: num("trials"),
          position: num("position"),
          angle: num("angle"),
          focal: num("focal"),
          seed: num("seed"),
        };
        const analysisWorker = new TaskWorker("./analysis-worker.js", {
          type: "module",
        });
        const captured = structuredClone(project),
          detectorId = num("detector");
        analysisWorker.onmessage = (e) => {
          analysisWorker.terminate();
          submit.disabled = false;
          submit.textContent = "Run tolerance analysis";
          if (e.data.error) {
            notify(e.data.error);
            return;
          }
          lastTolerance = e.data.result;
          if (!$("#tolerance-output")) return;
          $("#tolerance-output").innerHTML =
            `<div class="analysis-summary"><div><span>Mean diameter</span><strong>${fmt(lastTolerance.mean, 4)} mm</strong></div><div><span>5th–95th percentile</span><strong>${fmt(lastTolerance.p05, 4)}–${fmt(lastTolerance.p95, 4)}</strong></div><div><span>Lost / missed detector</span><strong>${lastTolerance.missed} / ${lastTolerance.trials}</strong></div></div><p class="field-note">Seed ${lastTolerance.seed}. Statistics include successful detections only. Uniform X/Y, rotation and focal-length errors; no surface or refractive-index errors.</p>${button("export-tolerance", "Export trial data", "download", "outline")}`;
        };
        analysisWorker.onerror = () => {
          analysisWorker.terminate();
          submit.disabled = false;
          submit.textContent = "Run tolerance analysis";
          notify(
            "Tolerance analysis could not complete. Try fewer components or trials.",
          );
        };
        analysisWorker.postMessage({ project: captured, detectorId, params });
        break;
      }
      case "sweep": {
        const id = num("component"),
          parameter = String(data.get("parameter")),
          min = num("min"),
          max = num("max");
        if (max <= min) throw Error("Maximum must exceed minimum.");
        if (parameter === "x" && max > project.table.width)
          throw Error("Sweep positions must remain on the table.");
        const rows = [];
        for (let i = 0; i <= 40; i++) {
          const value = min + ((max - min) * i) / 40,
            p = {
              ...project,
              items: project.items.map((c) =>
                c.id === id ? { ...c, [parameter]: value } : c,
              ),
            },
            h = trace(p).detectors.find((h) => h.id === activeDetector);
          if (h && h.power > 1e-9)
            rows.push({ value, diameter: h.radius * 2, power: h.power });
        }
        const best = rows.slice().sort((a, b) => a.diameter - b.diameter)[0];
        if (!best) throw Error("No sweep settings reach the active detector.");
        lastSweep = { componentId: id, parameter, rows, best };
        $("#sweep-output").innerHTML =
          `<div class="analysis-summary"><div><span>Best sampled ${parameter}</span><strong>${fmt(best.value, 4)} mm</strong></div><div><span>Detector diameter</span><strong>${fmt(best.diameter, 5)} mm</strong></div></div><p class="field-note">${rows.length} / 41 settings reach the detector. This is a bounded grid search, not a global optimum. Changing focal length creates a model override.</p>${button("apply-sweep", "Apply best setting", "check", "accent")}`;
        break;
      }
    }
  } catch (error) {
    notify(error.message);
  }
}
function guideDialog() {
  modal(
    "Model reference & laboratory workflow",
    `<div class="guide"><section><h3>Laboratory table</h3><p>All positions and footprints are in millimetres. X increases to the right and Y down the screen. Angles specify the surface normal; a source angle specifies its direction. A mirror normal of 135° turns a rightward beam downward. Hole patterns support M6 on 25 mm centers or ¼″–20 on 25.4 mm centers.</p><p>Click + in the inventory, then click the table to place a component. You can also drag inventory cards onto it. Drag parts, Shift-click to select several, and edit coordinates precisely. Middle-drag or H pans; the wheel zooms around the pointer. M measures between two points. V selects. F fits the table. R rotates 15°. Arrow keys move by one snap interval, Shift by ten. Ctrl/Cmd-Z undoes; Ctrl/Cmd-Shift-Z redoes.</p></section><section><h3>Height, mounts and alignment</h3><p>Open Setups → Two-mirror alignment. The Alignment tab combines an X–Z or Y–Z side projection with near/far iris targets and fine adjustment controls. Coordinates use millimetres; positive elevation points upward. Source elevation and mirror-normal elevation are limited to ±1°. The vertical trace uses z′ = z + L·slope and the first-order reflected slope s′ = s − 2(d·n)·pitch. Thin lenses steer vertical decenter toward the focal plane. Plan-view path lengths remain the propagation distances.</p><p>Grey posts and blue holders depict editable parametric assemblies. Holder extension spans 0–50 mm; the XYZ stage has a 15 mm modeled base and editable symmetric travel. Fine stage controls enforce travel; direct edits outside travel generate design checks. Base threads, optic capacity and table clearance are checked, but these assemblies are not verified manufacturer parts.</p><p>Two parallel irises with one shared, uninterrupted branch define the relative pointing error. Green centring means centroid error below 0.05 mm. The edge margin subtracts the Gaussian 1/e² radius; a negative margin flags potential clipping. Wave solvers require coplanar components and zero elevation tilt; they do not claim three-dimensional coherent propagation.</p></section><section><h3>Gaussian model</h3><p>Complex q propagation in air: q′ = q + d, and q′ = q / (1 − q/f) at an ideal thin lens. Beam radius follows w² = M²λ|q|²/(π Im q). The initial source plane is a beam waist. Each surface is located by a two-dimensional intersection test. Plane mirrors reflect the propagation direction; splitters create separate power branches; polarizers apply Malus’ law.</p><p>Clear-aperture clipping uses a centered Gaussian estimate. Truncation, decenter, large lens incidence and catalog coating mismatches generate design checks. Lens incidence beyond 10° stops that path. Interfering branches are not coherently recombined by this solver. Source beams are traced independently.</p><a class="source-link" href="https://www.brown.edu/research/labs/mittleman/sites/brown.edu.research.labs.mittleman/files/uploads/lecture21_2.pdf" target="_blank" rel="noopener">Gaussian propagation reference ↗</a></section><section><h3>Interferometry</h3><p>Open a Michelson or Mach–Zehnder setup. This mode coherently combines up to two TEM00 paths from one laser. Plane mirrors, ideal reciprocal splitters (r = i√R, t = √T), ND filters and linear polarizers are supported. The model includes geometric path, Gaussian curvature, Gouy phase, mirror piston and Gaussian temporal coherence exp[−(OPD/Lc)²]. Piston changes phase by 4πd cos(incidence)/λ; it does not translate the mount.</p><p>The central-row fit estimates spatial frequency, visibility and phase from sampled simulated data after normalization by the modeled noninterfering envelope. The phase is relative to sensor x = 0 and cannot alone determine absolute path difference. Scan records the central pixel while moving one mirror through 2λ of piston. Camera noise and ADC settings apply. These are simulated measurements, not acquired laboratory frames. Lenses, clipped diffraction, coating-specific phase, vector polarization transport and environmental drift are outside this coherent folded-path model.</p><a class="source-link" href="https://web.physics.ucsb.edu/~lecturedemonstrations/Composer/Pages/84%5B1%5D.30a.html" target="_blank" rel="noopener">Michelson phase and visibility reference ↗</a></section><section><h3>Ray model</h3><p>Thirteen paraxial rays per source are traced in the table plane. Rays refract through thin lenses, reflect, split, or stop at apertures and detectors. The detector’s Gaussian cross-section remains a separate ABCD reference; a ray bundle is not a wave-optical PSF.</p></section><section><h3>Fourier model</h3><p>A 128², 256², 512² or 1024² scalar complex field is propagated using a two-dimensional FFT angular-spectrum operator. Thin-lens phase, circular apertures, slits, neutral-density transmission and linear polarizers operate on the sampled field. Uploaded image intensity becomes field amplitude via a square root. Only one coherent M² = 1 source and straight, parallel optical planes are supported. Folded or split wave paths fail explicitly.</p><p>The finite FFT grid is periodic. Warnings report significant edge energy and undersampled lens phase; choose field width and resolution carefully and check convergence. Reported D4σ widths are second-moment widths. The solver does not include vector electromagnetic fields, surface prescriptions, dispersion, nonlinear optics, grating orders or thick-lens aberrations.</p></section><section><h3>Camera model</h3><p>Native-pixel photoelectrons are computed from incident irradiance, pixel area, exposure, wavelength and QE. Optional Poisson photon/dark noise and Gaussian read noise precede full-well clipping, digital gain and ADC quantization. The displayed image samples this model onto a reduced preview grid; it is not a full-resolution readout. Catalog camera dimensions are sourced; QE, read noise, dark current, full well and gain are editable assumptions.</p></section><section><h3>Catalog provenance & project files</h3><p>Every manufacturer reference links to its source. Some are archived specifications. No live stock, price or measured coating feed is connected. Ideal and custom components are explicitly identified. Changing a catalog parameter is shown as a model override. A parts list is a starting point for procurement, not a verified assembly.</p><p>Projects autosave in this browser and can be exported as versioned JSON including source images. Keep downloaded backups for long-term retention. The app imports the earlier OptiBench project format. Table drawings export as SVG; bill of materials, optical path and tolerance samples export as CSV.</p></section></div>`,
    true,
  );
}
// Custom inventory remains explicitly device-local, with the same validation as project imports.
try {
  const extra = JSON.parse(
    localStorage.getItem("optibench-custom-catalog") || "[]",
  );
  if (Array.isArray(extra) && extra.length <= 200)
    for (const c of extra) {
      const valid = validateProject({
        ...makeProject("empty"),
        items: [{ ...c, id: 1, x: 100, y: 100 }],
      }).items[0];
      const id = "CUSTOM-" + valid.part;
      if (!catalog.some((p) => p.id === id))
        catalog.unshift({ ...valid, id, brand: "Custom", provenance: "ideal" });
    }
} catch {}
const validationCenter = createValidationCenter();
const measurementWorkspace = createMetrologyWorkspace({
  restoreBench: (p) => {
    checkpoint();
    setProject(p);
  },
  getProject: () => structuredClone(project),
  capture: (method) => {
    const field = coherentField(project, activeDetector);
    if (field.paths.length !== 2)
      throw Error(
        "Open a two-arm interferometer and select its fringe detector before capturing.",
      );
    const n = 256,
      width =
        field.detector.type === "camera"
          ? (Math.min(field.detector.pixelsX, field.detector.pixelsY) *
              field.detector.pixelPitch) /
            1000
          : field.width;
    const frames = Array.from(
      { length: method === "four-step" ? 4 : 1 },
      (_, j) => ({
        name: `Simulated ${j * 90}°`,
        width: n,
        height: n,
        origin: "Simulated linear irradiance",
        values: Float64Array.from(
          { length: n * n },
          (_, i) =>
            field.at(
              (((i % n) + 0.5 - n / 2) * width) / n,
              ((Math.floor(i / n) + 0.5 - n / 2) * width) / n,
              (j * Math.PI) / 2,
            ).intensity,
        ),
      }),
    );
    let max = 0;
    for (const f of frames) for (const v of f.values) max = Math.max(max, v);
    if (max <= 0) throw Error("No simulated intensity reaches this detector.");
    for (const f of frames)
      f.values = Float64Array.from(f.values, (v) => 0.02 + (0.9 * v) / max);
    return {
      frames,
      pixelUm: (width / n) * 1000,
      wavelength: field.wavelength,
      simulation: {
        version: "1.0.0",
        detectorId: activeDetector,
        n,
        widthMm: width,
        normalizationPeak: max,
        readout:
          "Ideal normalized intensity: 0.02 + 0.9 × irradiance / capture peak",
        phaseSteps: [0, 90, 180, 270],
        noiseSigma: 0,
      },
    };
  },
});
const alignmentStudyWorkspace = createAlignmentStudyWorkspace({
  onApply: async (base, proposal, evidence) => {
    if (JSON.stringify(project) !== JSON.stringify(base))
      throw Error(
        "The active bench differs from this study. Start a new study using the current bench before applying adjustments.",
      );
    const layout = createLayout(
      proposal,
      proposal.title + " · applied alignment",
      "Applied from alignment study " + evidence.id,
      evidence.id,
    );
    const saved = await archiveStore.list();
    if (!saved.some((r) => r.id === evidence.id))
      await archiveStore.save(evidence);
    await archiveStore.save(layout);
    history.push(snapshot());
    redo = [];
    project = validateProject(structuredClone(proposal));
    commit();
    return { evidenceSaved: true };
  },
});
const simulationWorkspace = createSimulationWorkspace({
  onAlignment: (base, detector, revision) =>
    alignmentStudyWorkspace.open(base, detector, revision),
  getProject: () => structuredClone(project),
  getDetector: () => activeDetector,
  onImport: (records) => measurementWorkspace.importSimulationRuns(records),
});
const practiceWorkspace = createPracticeWorkspace({onBench: p => {checkpoint(); setProject(p);}});
const instrumentWorkspace = createInstrumentWorkspace({
  onBench: p => { checkpoint(); setProject(p); },
  onMeasure: r => measurementWorkspace.openRecord(r),
});
const guidedWorkspace = createGuidedWorkspace({
  onBench: p => { checkpoint(); setProject(p); },
  onMeasure: r => measurementWorkspace.openRecord(r),
});
const acceptanceWorkspace = createAcceptanceWorkspace();
const projectNavigator = createProjectNavigator({
  onRequirements: (records) => acceptanceWorkspace.open(records),
  getProject: () => structuredClone(project),
  onOpen: async (r, records) => {
    if (
      ["optibench-requirements", "optibench-acceptance-report"].includes(
        r.format,
      )
    )
      return acceptanceWorkspace.openRecord(r, records);
    if (r.format === "optibench-layout") {
      checkpoint();
      setProject(r.project);
      document.querySelector("#app").inert = false;
      return;
    }
    if (r.format === "optibench-measurement")
      return measurementWorkspace.openRecord(r);
    if (r.format === "optibench-experiment")
      return measurementWorkspace.openArchive(r);
    if (r.format === "optibench-sweep-archive")
      return simulationWorkspace.openRecord(r);
    if (r.format === "optibench-alignment-study")
      return alignmentStudyWorkspace.openRecord(r);
    if (r.format === "optibench-study-comparison") {
      const left = records.find((x) => x.id === r.a.id),
        right = records.find((x) => x.id === r.b.id);
      if (!left || !right)
        throw Error(
          "Both source sweep revisions must be available to recompute this comparison. Import their project backup first.",
        );
      const w = new TaskWorker(
        new URL("./simulation-worker.js", import.meta.url),
        {
          type: "module",
        },
      );
      try {
        return await new Promise((resolve, reject) => {
          w.onmessage = ({ data }) =>
            data.error ? reject(Error(data.error)) : resolve(data.result);
          w.onerror = () => reject(Error("Comparison worker failed."));
          w.postMessage({ operation: "compare", left, right });
        });
      } finally {
        w.terminate();
      }
    }
  },
});
mount();
if (document.modelContext?.registerTool) {
  const lifecycle = new AbortController();
  const tools = [
    {
      name: "read_optical_bench",
      description:
        "Read the active local optical project, detected paths and model diagnostics.",
      inputSchema: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      annotations: { readOnlyHint: true },
      execute(input) {
        if (!input || Object.keys(input).length)
          throw Error("Expected empty object.");
        return {
          project: structuredClone(project),
          engine: mode,
          detectors: result.detectors.map((h) => ({
            id: h.id,
            source: h.source,
            radiusMm: h.radius,
            powerMw: h.power,
            pathMm: h.distance,
          })),
          checks: allChecks(),
        };
      },
    },
    {
      name: "set_component_position",
      description:
        "Set a component position in millimetres and optional normal angle, then recompute the visible optical layout.",
      inputSchema: {
        type: "object",
        properties: {
          componentId: { type: "number" },
          xMm: { type: "number" },
          yMm: { type: "number" },
          angleDegrees: { type: "number" },
        },
        required: ["componentId", "xMm"],
        additionalProperties: false,
      },
      annotations: { readOnlyHint: false },
      execute(input) {
        if (
          !input ||
          Object.keys(input).some(
            (k) => !["componentId", "xMm", "yMm", "angleDegrees"].includes(k),
          )
        )
          throw Error("Invalid arguments.");
        const c = project.items.find((c) => c.id === input.componentId);
        if (!c) throw Error("Component not found.");
        if (c.locked) throw Error("Component is locked.");
        const p = structuredClone(project),
          target = p.items.find((x) => x.id === c.id);
        target.x = input.xMm;
        if (input.yMm !== undefined) target.y = input.yMm;
        if (input.angleDegrees !== undefined) target.angle = input.angleDegrees;
        const valid = validateProject(p);
        checkpoint();
        project = valid;
        selected = new Set([c.id]);
        commit();
        return {
          id: c.id,
          xMm: target.x,
          yMm: target.y,
          angleDegrees: target.angle,
          checks: allChecks(),
        };
      },
    },
  ];
  for (const t of tools)
    try {
      Promise.resolve(
        document.modelContext.registerTool(t, { signal: lifecycle.signal }),
      ).catch(() => {});
    } catch {}
  window.addEventListener("pagehide", () => lifecycle.abort(), { once: true });
}
