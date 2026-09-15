import { measurementQuality } from "./measurement-quality.js";
import { analyzeRepeats, repeatCSV, repeatMapCSV } from "./repeatability.js";
import { decodeTIFF, decodeNumericalImage } from "./scientific-images.js";
import {
  subtractReference,
  estimateTranslation,
  crossSection,
  differenceCSV,
} from "./reference-analysis.js";
import {
  defaultMeasurementSettings,
  analyzeMeasurement,
  validateFrame,
  validateMeasurementSettings,
  demoFrames,
  measurementCSV,
  METROLOGY_VERSION,
} from "./metrology.js";
import { runStore, serializable } from "./run-store.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v, n = 2) => (Number.isFinite(v) ? v.toFixed(n) : "—");
const download = (name, body, type = "application/json") => {
  const a = document.createElement("a"),
    url = URL.createObjectURL(new Blob([body], { type }));
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function numberField(label, key, value, min, max, step = "any") {
  return `<label>${label}<input data-setting="${key}" type="number" value="${value}" min="${min}" max="${max}" step="${step}"></label>`;
}
export function createMetrologyWorkspace({
  getProject,
  capture,
  store = runStore,
}) {
  let root = null,
    frames = [],
    dark = null,
    flat = null,
    settings = defaultMeasurementSettings(),
    result = null,
    runs = [],
    repeatIds = new Set(),
    study = null,
    repeatVerified = false,
    acquiredAt = "",
    acquisitionId = null,
    selectedRuns = new Set(),
    name = "Untitled measurement",
    notes = "",
    message = "",
    busy = false,
    importing = false,
    job = 0,
    sourceProject = null,
    view = "height",
    worker = null,
    reference = null,
    difference = null,
    registration = { dx: 0, dy: 0, verified: false },
    profile = { axis: "horizontal", index: 0, source: "sample" };
  const $ = (s) => root.querySelector(s);
  function status(text) {
    message = text;
    if (root) $("#measurement-status").textContent = text;
  }
  function invalidate() {
    result = null;
    difference = null;
    registration.verified = false;
    job++;
  }
  async function refreshRuns() {
    try {
      runs = (await store.list()).sort((a, b) =>
        b.createdAt.localeCompare(a.createdAt),
      );
      if (root) {
        renderRuns();
        renderAdvanced();
      }
    } catch (e) {
      status(e.message);
    }
  }
  function open() {
    const app = document.querySelector("#app");
    if (app) app.inert = true;
    if (root) {
      root.hidden = false;
      return;
    }
    root = document.createElement("section");
    root.id = "measurement-workspace";
    root.setAttribute("aria-label", "Fringe measurement workspace");
    document.body.appendChild(root);
    root.addEventListener("click", handleClick);
    root.addEventListener("change", handleChange);
    render();
    refreshRuns();
  }
  function render() {
    root.innerHTML = `<header class="measurement-header"><button data-measure="close">← Optical bench</button><div><span class="measurement-kicker">OPTIBENCH / METROLOGY</span><h1>Fringe measurements</h1></div><button data-measure="import-run">Open run JSON</button><button data-measure="export-run" ${result ? "" : "disabled"}>Export run</button><button data-measure="save" class="measurement-primary" ${result ? "" : "disabled"}>Save experiment</button></header><div class="measurement-grid"><aside class="measurement-controls"><section><h2>1. Image source</h2><label>Reconstruction<select data-setting="method"><option value="four-step" ${settings.method === "four-step" ? "selected" : ""}>Four frames · 0°, 90°, 180°, 270°</option><option value="fourier" ${settings.method === "fourier" ? "selected" : ""}>Single image · Fourier sideband</option></select></label><div class="measurement-buttons"><button data-measure="import-frames">Import ${settings.method === "four-step" ? "4 frames" : "image"}</button><button data-measure="capture">Capture simulation</button><button data-measure="demo">Load example</button></div><p class="measurement-help">TIFF · unsigned monochrome 8/16-bit; numerical JSON · full-precision samples. PNG/JPEG/WebP · decoded 8-bit luminance. 64–2048 px per side, no resizing. Use linear intensity. <button data-measure="image-template">Numerical JSON template</button></p><div class="measurement-frame-list">${frames.length ? frames.map((f, i) => `<div><b>${settings.method === "four-step" ? i * 90 + "°" : "Frame"}</b><span title="${esc(f.name)}">${esc(f.name)}<small>${f.width} × ${f.height} · ${esc(f.origin)} · ${esc(f.precision || "normalized intensity")}</small></span>${i ? `<button data-measure="frame-up" data-index="${i}" aria-label="Move frame earlier">↑</button>` : ""}</div>`).join("") : '<p class="measurement-help">No frames loaded. Import laboratory images or try the example.</p>'}</div><div class="measurement-buttons"><button data-measure="dark">${dark ? "Replace" : "Add"} dark</button><button data-measure="flat">${flat ? "Replace" : "Add"} flat</button>${dark || flat ? '<button data-measure="clear-calibration">Clear calibration</button>' : ""}</div><p class="measurement-help">${dark ? "Dark: " + esc(dark.name) : "No dark subtraction"}<br>${flat ? "Flat: " + esc(flat.name) : "No flat-field correction"}</p></section><section><h2>2. ROI & calibration</h2><label>Square ROI size<select data-setting="n">${[64, 128, 256, 512].map((n) => `<option ${n === settings.n ? "selected" : ""}>${n}</option>`).join("")}</select></label><div class="measurement-two">${numberField("Origin X · px", "x", settings.x, 0, 2047, 1)}${numberField("Origin Y · px", "y", settings.y, 0, 2047, 1)}</div>${numberField("Object-plane scale · µm / pixel", "pixelUm", settings.pixelUm, 0.000001, 100000)}${numberField("Wavelength · nm", "wavelength", settings.wavelength, 200, 20000)}<label>Conversion<select data-setting="geometry"><option value="opd" ${settings.geometry === "opd" ? "selected" : ""}>Optical path difference</option><option value="reflection" ${settings.geometry === "reflection" ? "selected" : ""}>Reflecting-surface height</option></select></label>${settings.geometry === "reflection" ? numberField("Incidence from surface normal · °", "incidence", settings.incidence, 0, 80) : ""}${numberField("Minimum visibility · 0–1", "minVisibility", settings.minVisibility, 0.01, 0.95, 0.01)}<label class="measurement-check"><input data-setting="removeTilt" type="checkbox" ${settings.removeTilt ? "checked" : ""}>Remove fitted tilt and piston</label><p class="measurement-help">${settings.removeTilt ? "Best-fit plane removed." : "Only mean phase removed."} Heights and OPD are relative; absolute fringe order is unknown.</p>${settings.method === "fourier" ? `<label class="measurement-check"><input data-setting="autoCarrier" type="checkbox" ${settings.autoCarrier ? "checked" : ""}>Find carrier automatically</label><div class="measurement-two">${numberField("Carrier X · bins", "carrierX", settings.carrierX, -256, 256)}${numberField("Carrier Y · bins", "carrierY", settings.carrierY, -256, 256)}</div>${numberField("Sideband radius · bins", "bandwidth", settings.bandwidth, 1, 32)}<p class="measurement-help">Manual signed carrier bins select the conjugate sideband and phase sign. A circular tapered filter must separate the sideband from DC.</p>` : ""}<button class="measurement-primary measurement-analyze" data-measure="analyze" ${busy ? "disabled" : ""}>${busy ? "Reconstructing…" : "Reconstruct phase"}</button></section></aside><main class="measurement-main"><div class="measurement-title"><label>Experiment name<input id="measurement-name" value="${esc(name)}" maxlength="120"></label><span class="measurement-badge">${frames.length ? esc(frames[0].origin) : "Awaiting image data"}</span></div><div class="measurement-status" id="measurement-status" role="status">${esc(message || "Import images, select a region and reconstruct phase.")}</div><div class="measurement-instruments"><article><header><h2>Input & region</h2><span>${frames[0] ? frames[0].width + " × " + frames[0].height + " px" : "—"}</span></header><canvas id="measurement-input" aria-label="Input fringe image and selected ROI"></canvas><p>ROI: (${settings.x}, ${settings.y}) · ${settings.n}² native pixels · ${fmt((settings.n * settings.pixelUm) / 1000, 3)} mm wide</p></article><article><header><h2>Reconstruction</h2><select id="measurement-view" aria-label="Map display">${[
      ["height", "Relative nm"],
      ["difference", "Sample − reference nm"],
      ["phase", "Unwrapped rad"],
      ["wrapped", "Wrapped rad"],
      ["visibility", "Visibility"],
      ["spectrum", "Fourier spectrum"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${view === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></header><canvas id="measurement-map" aria-label="Reconstructed phase or height map"></canvas><p id="measurement-map-scale">${result ? "" : "No result yet. Invalid pixels appear dark."}</p></article></div><label class="measurement-notes">Acquisition time · ISO 8601 with timezone<input id="measurement-acquired" value="${esc(acquiredAt)}" placeholder="2026-09-15T14:30:00-04:00"><small>Enter the actual camera acquisition time; leave blank when unknown.</small></label><div id="measurement-results"></div><div id="measurement-advanced"></div><label class="measurement-notes">Experiment notes<textarea id="measurement-notes" rows="3" placeholder="Sample, camera settings, calibration references and observations…">${esc(notes)}</textarea></label><section class="measurement-records"><header><h2>Saved experiments</h2><span>Stored on this browser · export JSON for backup</span></header><div id="measurement-runs"></div><div id="measurement-study"></div></section><details class="measurement-model"><summary>Methods, calibration and interpretation</summary><p>Four-step reconstruction assumes registered linear-intensity frames I(φ + δ), δ = 0°, 90°, 180°, 270°, with unchanged exposure. Phase is atan2(I270 − I90, I0 − I180). Dark is subtracted before optional division by flat − dark. A flat should be an unfringed illumination reference acquired at compatible settings.</p><p>Single-image analysis applies a Hann window and isolates a tapered Fourier sideband. The positive-half-plane automatic choice defines a sign convention; physical sign requires a known reference. Filtering limits spatial resolution. The outer 10% of the ROI is excluded. Adjust the sideband and check stability of the reconstruction.</p><p>Quality-guided unwrapping assumes adjacent valid phase differences below π. Only the strongest connected region is retained. Discontinuities and inconsistent edges can invalidate heights. OPD = λφ/(2π); reflecting height = λφ/(4π cos θ). Pixel scale must be calibrated at the sample plane. Reported PV and RMS describe the retained region after the selected plane removal; they are not uncertainty bounds.</p><p>PNG/JPEG/WebP are browser-decoded 8-bit luminance. TIFF preserves unsigned 8/16-bit monochrome samples (single-page strips, top-left orientation; uncompressed, LZW, PackBits or Deflate). Numerical JSON contains width, height, fullScale and flat row-major values. Neither path interprets sensor RAW. Reference subtraction uses translation only, bilinear interpolation and the valid-mask intersection; it removes the common mean. Rotation, distortion and absolute piston are not recovered. Keep original camera files separately. Saved runs contain the exact decoded samples used, calibration frames, settings, bench snapshot and results. Files remain local; no acquisition hardware is connected.</p><p><a href="https://opg.optica.org/josa/abstract.cfm?uri=josa-72-1-156" target="_blank" rel="noopener">Takeda et al. · Fourier fringe analysis</a> · <a href="https://arxiv.org/abs/1501.04738" target="_blank" rel="noopener">Four-step phase calibration</a></p></details></main></div><input id="measurement-files" type="file" accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff,.json" hidden multiple><input id="measurement-calibration" type="file" accept="image/png,image/jpeg,image/webp,image/tiff,.tif,.tiff,.json" hidden><input id="measurement-run-file" type="file" accept="application/json,.json" hidden>`;
    renderResults();
    renderAdvanced();
    renderRuns();
    paintInput();
  }
  function renderResults() {
    if (!result) {
      $("#measurement-results").innerHTML =
        '<div class="measurement-empty">Phase, visibility and relative-height maps will appear after reconstruction.</div>';
      return;
    }
    const s = result.stats;
    $("#measurement-results").innerHTML =
      `<div class="measurement-metrics"><div><span>Peak to valley</span><strong>${fmt(s.pvNm)} <small>nm</small></strong></div><div><span>RMS · mean removed</span><strong>${fmt(s.rmsNm)} <small>nm</small></strong></div><div><span>Valid connected area</span><strong>${fmt(s.validFraction * 100, 1)}%</strong></div><div><span>Mean visibility</span><strong>${fmt(s.meanVisibility * 100, 1)}%</strong></div></div><div class="measurement-diagnostics">${result.carrier ? `<p>Carrier (${result.carrier.x}, ${result.carrier.y}) bins · period ${fmt(result.carrier.periodPixels)} px · normal ${fmt(result.carrier.normalAngle, 1)}°</p>` : `<p>Phase-step consistency residual: ${fmt(s.stepResidual * 100, 3)}% · ${s.unwrapConflicts} unwrap conflicts</p>`}${result.warnings.map((w) => `<p class="measurement-warning">${esc(w)}</p>`).join("")}<p>${esc(result.unit)} · ${settings.removeTilt ? "plane" : "mean"} removed · engine ${METROLOGY_VERSION}</p></div><div class="measurement-buttons"><button data-measure="csv">Export pixel CSV</button><button data-measure="report">Export report</button></div>`;
    $("#measurement-results").insertAdjacentHTML("beforeend", qualityHTML());
    paintResult();
  }
  function renderRuns() {
    if (!$("#measurement-runs")) return;
    $("#measurement-runs").innerHTML = runs.length
      ? `<div class="measurement-table-scroll"><table><thead><tr><th>Compare / Repeat</th><th>Experiment</th><th>Source / method</th><th>PV / RMS (nm)</th><th>Valid</th><th>Actions</th></tr></thead><tbody>${runs.map((r) => `<tr><td><input type="checkbox" data-run-compare="${esc(r.id)}" aria-label="Compare ${esc(r.name)}" ${selectedRuns.has(r.id) ? "checked" : ""}><label class="measurement-check"><input type="checkbox" data-repeat-id="${esc(r.id)}" ${repeatIds.has(r.id) ? "checked" : ""}>Repeat</label></td><td>${esc(r.name)}<small>${esc(new Date(r.createdAt).toLocaleString())}</small></td><td>${esc(r.frames[0]?.origin)}<small>${esc(r.settings.method)} · ${esc(r.settings.geometry)}</small></td><td>${fmt(r.result.stats.pvNm)} / ${fmt(r.result.stats.rmsNm)}</td><td>${fmt(r.result.stats.validFraction * 100, 1)}%</td><td><button data-measure="load-run" data-id="${esc(r.id)}">Open</button><button data-measure="delete-run" data-id="${esc(r.id)}">Delete</button></td></tr>`).join("")}</tbody></table></div><div id="measurement-comparison"></div>`
      : '<p class="measurement-help">Save a reconstruction to preserve its images, calibration, setup and results.</p>';
    renderStudy();
    const pair = runs.filter((r) => selectedRuns.has(r.id));
    if (pair.length === 2) {
      const [a, b] = pair,
        compatible = JSON.stringify(a.settings) === JSON.stringify(b.settings);
      $("#measurement-comparison").innerHTML =
        `<p><b>${esc(a.name)} − ${esc(b.name)}</b>: ΔPV ${fmt(a.result.stats.pvNm - b.result.stats.pvNm)} nm · ΔRMS ${fmt(a.result.stats.rmsNm - b.result.stats.rmsNm)} nm.</p><p>${compatible ? "Same analysis settings; confirm matching samples and image registration before interpreting differences." : "Different analysis settings. This is a summary comparison; values are not directly interchangeable."}</p>`;
    }
  }
  async function computeStudy() {
    const selected = runs.filter((r) => repeatIds.has(r.id));
    if (typeof Worker === "undefined")
      return analyzeRepeats(selected, { verified: repeatVerified });
    const w = new Worker(
      new URL("./repeatability-worker.js", import.meta.url),
      { type: "module" },
    );
    try {
      return await new Promise((resolve, reject) => {
        w.onmessage = ({ data }) =>
          data.error ? reject(Error(data.error)) : resolve(data.result);
        w.onerror = () =>
          reject(
            Error(
              "Repeatability analysis could not run. Reload and try again.",
            ),
          );
        w.postMessage({ runs: selected, verified: repeatVerified });
      });
    } finally {
      w.terminate();
    }
  }
  function qualityHTML() {
    if (!result) return "";
    const q = measurementQuality(result, frames, {
      reference: !!reference,
      registration,
    });
    return `<section class="measurement-quality"><h2>Measurement quality · ${q.status === "review" ? "Review needed" : "No automatic flags"}</h2><p>Review thresholds are screening aids, not acceptance criteria or uncertainty bounds.</p><div class="quality-grid">${q.checks.map((c) => `<article data-quality="${c.level}"><b>${esc(c.name)}</b><span>${esc(c.level)}</span><p>${esc(c.detail)}</p></article>`).join("")}</div></section>`;
  }
  function studyHTML() {
    if (!study)
      return "<p>Select 3–20 independently acquired saved runs. Only sample wavefronts are compared; reference differences are not used.</p>";
    return `<div class="measurement-metrics"><div><span>Acquisitions / shared area</span><strong>${study.rows.length} / ${fmt(study.commonFraction * 100, 1)}%</strong></div><div><span>PV mean ± sample SD</span><strong>${fmt(study.pv.mean)} ± ${fmt(study.pv.sd)} nm</strong></div><div><span>RMS mean ± sample SD</span><strong>${fmt(study.rms.mean)} ± ${fmt(study.rms.sd)} nm</strong></div><div><span>Spatial RMS of temporal SD</span><strong>${fmt(study.pixelRepeatabilityNm)} nm</strong></div></div><p>Linear PV drift ${fmt(study.pvDriftNmMin, 4)} nm/min · RMS drift ${fmt(study.rmsDriftNmMin, 4)} nm/min. Rates use actual acquisition times.</p>${study.warnings.map((w) => `<p class="measurement-warning">${esc(w)}</p>`).join("")}<div class="measurement-table-scroll"><table><thead><tr><th>Acquisition</th><th>Time</th><th>PV · nm</th><th>RMS · nm</th><th>Quality</th></tr></thead><tbody>${study.rows.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.acquiredAt || "Unknown")}</td><td>${fmt(r.pvNm)}</td><td>${fmt(r.rmsNm)}</td><td>${esc(r.quality.status)}</td></tr>`).join("")}</tbody></table></div>`;
  }
  function renderStudy() {
    const target = $("#measurement-study");
    if (!target) return;
    target.innerHTML = `<h2>Repeatability study</h2><p>${repeatIds.size} acquisitions selected</p><label class="measurement-check"><input id="repeat-verified" type="checkbox" ${repeatVerified ? "checked" : ""}>I verified independent acquisitions of the same sample, spatial registration and unchanged conditions.</label><div class="measurement-buttons"><button data-measure="analyze-repeats" ${repeatIds.size >= 3 && repeatVerified ? "" : "disabled"}>Analyze repeats</button><button data-measure="clear-repeats">Clear selection</button><button data-measure="repeat-csv" ${study ? "" : "disabled"}>Summary CSV</button><button data-measure="repeat-map" ${study ? "" : "disabled"}>Mean / SD map CSV</button><button data-measure="repeat-json" ${study ? "" : "disabled"}>Export study JSON</button><button data-measure="repeat-report" ${study ? "" : "disabled"}>Export study report</button></div>${studyHTML()}`;
  }
  function referenceRecord(r) {
    if (!r?.frames || !r.settings)
      throw Error("Choose a saved reference experiment.");
    const { reference: nested, comparison, ...plain } = r;
    return serializable(plain);
  }
  function referenceResult() {
    if (!reference) throw Error("Choose a saved reference experiment.");
    return analyzeMeasurement(reference.frames, reference.settings, {
      dark: reference.dark,
      flat: reference.flat,
    });
  }
  function applyReference() {
    difference = subtractReference(result, referenceResult(), registration);
  }
  function profileData() {
    const source = profile.source === "difference" ? difference : result;
    return source
      ? crossSection(source, {
          ...profile,
          index: Math.min(profile.index, source.n - 1),
          pixelUm: settings.pixelUm,
        })
      : [];
  }
  function profileCSV() {
    return (
      "x_roi_pixel,y_roi_pixel,position_um,value_nm,valid\n" +
      profileData()
        .map((p) =>
          [
            p.x,
            p.y,
            p.positionUm,
            p.value ?? "",
            p.value === null ? 0 : 1,
          ].join(","),
        )
        .join("\n")
    );
  }
  function profileSVG() {
    const points = profileData(),
      valid = points.filter((p) => p.value !== null);
    if (!valid.length)
      return "<p>No valid profile data for this selection.</p>";
    const lo = Math.min(...valid.map((p) => p.value)),
      hi = Math.max(...valid.map((p) => p.value));
    let path = "",
      connected = false;
    points.forEach((p, i) => {
      if (p.value === null) {
        connected = false;
        return;
      }
      path +=
        (connected ? " L" : " M") +
        (50 + (i / (points.length - 1)) * 620).toFixed(2) +
        "," +
        (170 - ((p.value - lo) / (hi - lo || 1)) * 140).toFixed(2);
      connected = true;
    });
    return `<svg viewBox="0 0 720 220" role="img" aria-label="${esc(profile.source)} ${esc(profile.axis)} cross-section in nanometres" style="width:100%;background:#101923;color:#bcd1e0"><path d="M50 20V180H680" stroke="#789" fill="none"/><path d="${path}" stroke="#bdf18b" stroke-width="2" fill="none"/><g fill="currentColor" font-size="12"><text x="5" y="25">${fmt(hi)} nm</text><text x="5" y="174">${fmt(lo)}</text><text x="50" y="204">${fmt(points[0].positionUm)} µm</text><text x="570" y="204">${fmt(points.at(-1).positionUm)} µm</text></g></svg><p>${esc(profile.source)} · ${esc(profile.axis)} ${profile.index} · ${valid.length}/${points.length} valid pixels. Distance from ROI origin; gaps are excluded pixels.</p>`;
  }
  function referenceReport() {
    return difference
      ? `<h2>Sample − reference</h2><p>Reference: ${esc(reference.name)} (${esc(reference.id)}). Translation: (${registration.dx}, ${registration.dy}) px; registration and phase sign verified by operator. Bilinear interpolation, valid overlap ${fmt(difference.stats.validFraction * 100)}%. PV ${fmt(difference.stats.pvNm)} nm; RMS ${fmt(difference.stats.rmsNm)} nm. Common mean removed: ${fmt(difference.removedMeanNm)} nm.</p>`
      : "";
  }
  function renderAdvanced() {
    const target = $("#measurement-advanced");
    if (!target) return;
    const choices = [...runs];
    if (reference && !choices.some((r) => r.id === reference.id))
      choices.push(reference);
    target.innerHTML = `<section class="measurement-records"><h2>Reference wavefront</h2><label>Saved reference<select id="measurement-reference"><option value="">Choose reference…</option>${choices.map((r) => `<option value="${esc(r.id)}" ${reference?.id === r.id ? "selected" : ""}>${esc(r.name)} · ${esc(r.createdAt)}</option>`).join("")}</select></label><div class="measurement-two"><label>Reference X offset · px<input data-registration="dx" type="number" step="0.1" value="${registration.dx}"></label><label>Reference Y offset · px<input data-registration="dy" type="number" step="0.1" value="${registration.dy}"></label></div><p class="measurement-help">Reference is sampled at (sample X + offset X, sample Y + offset Y). Translation only; confirm matching scale, orientation, sample features and physical phase sign. Correlation can be ambiguous for periodic fringes.</p><label class="measurement-check"><input data-registration="verified" type="checkbox" ${registration.verified ? "checked" : ""}>I verified registration and phase sign</label><div class="measurement-buttons"><button data-measure="estimate-reference" ${result && reference ? "" : "disabled"}>Estimate translation</button><button data-measure="apply-reference" ${result && reference && registration.verified ? "" : "disabled"}>Subtract reference</button><button data-measure="difference-csv" ${difference ? "" : "disabled"}>Export difference CSV</button></div>${referenceReport()}</section><section class="measurement-records"><h2>Cross-section</h2><div class="measurement-two"><label>Source<select data-profile="source"><option value="sample" ${profile.source === "sample" ? "selected" : ""}>Sample height / OPD</option><option value="difference" ${profile.source === "difference" ? "selected" : ""}>Sample − reference</option></select></label><label>Direction<select data-profile="axis"><option value="horizontal" ${profile.axis === "horizontal" ? "selected" : ""}>Horizontal row</option><option value="vertical" ${profile.axis === "vertical" ? "selected" : ""}>Vertical column</option></select></label><label>Row / column · ROI pixel<input data-profile="index" type="number" min="0" max="${(result?.n || 64) - 1}" step="1" value="${profile.index}"></label></div>${profileSVG()}<button data-measure="profile-csv" ${profileData().length ? "" : "disabled"}>Export cross-section CSV</button></section>`;
  }
  function paintInput() {
    const canvas = $("#measurement-input");
    if (!frames.length) return;
    const f = frames[0],
      n = Math.min(512, Math.max(f.width, f.height)),
      w = Math.max(1, Math.round((f.width * n) / Math.max(f.width, f.height))),
      h = Math.max(1, Math.round((f.height * n) / Math.max(f.width, f.height)));
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d"),
      img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v =
            f.values[
              Math.floor((y / h) * f.height) * f.width +
                Math.floor((x / w) * f.width)
            ],
          i = (y * w + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v * 255;
        img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    ctx.strokeStyle = "#bdf18b";
    ctx.lineWidth = 2;
    ctx.strokeRect(
      (settings.x / f.width) * w,
      (settings.y / f.height) * h,
      (settings.n / f.width) * w,
      (settings.n / f.height) * h,
    );
  }
  function paintResult() {
    if (!result) return;
    const displayed = view === "difference" ? difference : result;
    const values = view === "difference" ? difference?.height : result[view];
    if (!values) {
      $("#measurement-map-scale").textContent =
        "No data for this view. Reconstruct or apply a reference comparison.";
      const c = $("#measurement-map");
      c.width = c.width;
      return;
    }
    const canvas = $("#measurement-map"),
      n = result.n;
    canvas.width = n;
    canvas.height = n;
    const ctx = canvas.getContext("2d"),
      img = ctx.createImageData(n, n);
    let min = Infinity,
      max = -Infinity;
    for (let i = 0; i < values.length; i++)
      if (
        (view === "spectrum" || view === "visibility" || displayed.mask[i]) &&
        Number.isFinite(values[i])
      ) {
        min = Math.min(min, values[i]);
        max = Math.max(max, values[i]);
      }
    if (view === "wrapped") {
      min = -Math.PI;
      max = Math.PI;
    }
    if (view === "visibility") {
      min = 0;
      max = 1;
    }
    for (let i = 0; i < values.length; i++) {
      const valid =
          (view === "spectrum" || view === "visibility" || displayed.mask[i]) &&
          Number.isFinite(values[i]),
        t = valid
          ? Math.max(0, Math.min(1, (values[i] - min) / (max - min || 1)))
          : 0;
      img.data[i * 4] = valid
        ? 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 3)))
        : 17;
      img.data[i * 4 + 1] = valid
        ? 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 2)))
        : 24;
      img.data[i * 4 + 2] = valid
        ? 255 * Math.min(1, Math.max(0, 1.5 - Math.abs(4 * t - 1)))
        : 33;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    $("#measurement-map-scale").textContent =
      `${fmt(min, 3)} → ${fmt(max, 3)} ${view === "height" || view === "difference" ? "nm" : view === "phase" || view === "wrapped" ? "rad" : ""} · dark pixels excluded`;
  }
  async function decode(file) {
    if (file.size > 32 * 1024 * 1024)
      throw Error("Choose images smaller than 32 MB.");
    if (/\.tiff?$/i.test(file.name))
      return decodeTIFF(await file.arrayBuffer(), file.name);
    if (/\.json$/i.test(file.name))
      return decodeNumericalImage(await file.text(), file.name);
    const url = URL.createObjectURL(file);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (
        image.naturalWidth < 64 ||
        image.naturalHeight < 64 ||
        image.naturalWidth > 2048 ||
        image.naturalHeight > 2048
      )
        throw Error(
          "Supported images are 64–2048 pixels on each side. Export a native-pixel crop from your camera software.",
        );
      const c = document.createElement("canvas");
      c.width = image.naturalWidth;
      c.height = image.naturalHeight;
      const ctx = c.getContext("2d");
      ctx.drawImage(image, 0, 0);
      const pixels = ctx.getImageData(0, 0, c.width, c.height).data,
        values = new Float64Array(c.width * c.height);
      for (let i = 0; i < values.length; i++) {
        if (pixels[i * 4 + 3] !== 255)
          throw Error(
            "Transparent pixels are not supported. Export an opaque grayscale frame.",
          );
        values[i] =
          (0.2126 * pixels[i * 4] +
            0.7152 * pixels[i * 4 + 1] +
            0.0722 * pixels[i * 4 + 2]) /
          255;
      }
      return {
        name: file.name,
        width: c.width,
        height: c.height,
        values,
        origin: "Imported image · decoded luminance",
      };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
  function record() {
    if (!result)
      throw Error("Reconstruct the measurement before saving or exporting.");
    return serializable({
      format: "optibench-measurement",
      version: 1,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      acquiredAt: acquiredAt || null,
      acquisitionId,
      name: name.trim() || "Untitled measurement",
      notes,
      engine: METROLOGY_VERSION,
      frames,
      dark,
      flat,
      settings,
      project: sourceProject ?? getProject(),
      result,
      reference,
      comparison: difference
        ? {
            registration: difference.registration,
            stats: difference.stats,
            removedMeanNm: difference.removedMeanNm,
          }
        : null,
      profile,
    });
  }
  async function reconstruct() {
    busy = true;
    result = null;
    difference = null;
    registration.verified = false;
    const token = ++job;
    render();
    try {
      let output;
      if (typeof Worker === "undefined")
        output = analyzeMeasurement(frames, settings, { dark, flat });
      else {
        if (worker) worker.terminate();
        worker = new Worker(new URL("./metrology-worker.js", import.meta.url), {
          type: "module",
        });
        output = await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.error ? reject(Error(data.error)) : resolve(data.result);
          worker.onerror = () =>
            reject(
              Error(
                "The analysis worker could not run. Reload the app and try again.",
              ),
            );
          worker.postMessage({
            job: token,
            frames,
            settings,
            calibration: { dark, flat },
          });
        });
      }
      if (token !== job) return;
      result = output;
      message = `Reconstruction complete. ${fmt(result.stats.validFraction * 100, 1)}% of the ROI retained.`;
    } catch (e) {
      if (token === job) message = e.message;
    } finally {
      if (token === job) {
        busy = false;
        render();
      }
    }
  }
  async function loadRecord(r) {
    if (
      r.format !== "optibench-measurement" ||
      r.version !== 1 ||
      !Array.isArray(r.frames) ||
      ![1, 4].includes(r.frames.length)
    )
      throw Error("Unsupported experiment run.");
    r.frames.forEach(validateFrame);
    validateMeasurementSettings(r.settings, r.frames[0]);
    if (r.dark) validateFrame(r.dark);
    if (r.flat) validateFrame(r.flat);
    acquiredAt = typeof r.acquiredAt === "string" ? r.acquiredAt : "";
    acquisitionId = r.acquisitionId || null;
    frames = r.frames;
    dark = r.dark ?? null;
    flat = r.flat ?? null;
    settings = { ...r.settings };
    name = String(r.name || "Imported run").slice(0, 120);
    notes = String(r.notes || "").slice(0, 10000);
    sourceProject = r.project ?? null;
    invalidate();
    message = `Loaded saved data from ${r.createdAt}. Reconstructing with engine ${METROLOGY_VERSION}; the imported file retains its original results.`;
    render();
    await reconstruct();
    reference = r.reference ? referenceRecord(r.reference) : null;
    profile = { axis: "horizontal", index: 0, source: "sample", ...r.profile };
    try {
      crossSection(result, { ...profile, pixelUm: settings.pixelUm });
    } catch {
      profile = { axis: "horizontal", index: 0, source: "sample" };
    }
    if (result && reference && r.comparison?.registration) {
      registration = { ...r.comparison.registration };
      try {
        applyReference();
      } catch (e) {
        difference = null;
        registration.verified = false;
        message =
          "Run restored; reference comparison needs attention: " + e.message;
      }
    }
    render();
  }
  async function handleClick(e) {
    const b = e.target.closest("[data-measure]");
    if (!b) return;
    e.stopPropagation();
    const action = b.dataset.measure;
    if ((busy || importing) && action !== "close") return;
    try {
      switch (action) {
        case "analyze-repeats": {
          status("Reconstructing selected acquisitions…");
          busy = true;
          try {
            await new Promise((resolve) => setTimeout(resolve, 0));
            study = await computeStudy();
            status(
              "Repeatability study complete over the common valid region.",
            );
          } finally {
            busy = false;
            renderStudy();
          }
          return;
        }
        case "clear-repeats":
          repeatIds.clear();
          repeatVerified = false;
          study = null;
          renderRuns();
          return;
        case "repeat-csv":
          download("repeatability-summary.csv", repeatCSV(study), "text/csv");
          return;
        case "repeat-map":
          download("repeatability-maps.csv", repeatMapCSV(study), "text/csv");
          return;
        case "repeat-json":
          download(
            "repeatability-study.json",
            JSON.stringify(
              serializable({
                ...study,
                acquisitions: runs.filter((r) => repeatIds.has(r.id)),
              }),
            ),
          );
          return;
        case "repeat-report":
          download(
            "repeatability-report.html",
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>Repeatability study</title><style>body{font:16px system-ui;max-width:1000px;margin:40px auto;padding:20px}td,th{padding:10px;border:1px solid #aaa}table{border-collapse:collapse}</style><h1>OptiBench repeatability study</h1>${studyHTML()}<h2>Analysis settings</h2><pre>${esc(JSON.stringify(study.settings, null, 2))}</pre><p>All maps use the common valid region with a separate mean removed from each acquisition. Export study JSON to retain the contributing data.</p></html>`,
            "text/html",
          );
          return;
        case "image-template":
          download(
            "intensity-template.json",
            JSON.stringify({
              width: 64,
              height: 64,
              fullScale: 65535,
              values: Array.from(
                { length: 4096 },
                (_, i) => 16384 + (i % 64) * 512,
              ),
            }),
          );
          return;
        case "estimate-reference": {
          const estimate = estimateTranslation(result, referenceResult());
          registration = { dx: estimate.dx, dy: estimate.dy, verified: false };
          difference = null;
          message = `Candidate (${estimate.dx}, ${estimate.dy}) px · correlation ${fmt(estimate.score, 3)} · peak gap ${fmt(estimate.gap, 3)}. ${estimate.note}`;
          render();
          return;
        }
        case "apply-reference":
          applyReference();
          view = "difference";
          message =
            "Reference subtracted over the valid overlap; common mean removed.";
          render();
          return;
        case "difference-csv":
          download(
            "sample-minus-reference.csv",
            differenceCSV(difference, settings),
            "text/csv",
          );
          return;
        case "profile-csv":
          download("cross-section.csv", profileCSV(), "text/csv");
          return;
        case "close":
          root.hidden = true;
          if (document.querySelector("#app"))
            document.querySelector("#app").inert = false;
          return;
        case "demo":
          acquiredAt = "";
          acquisitionId = crypto.randomUUID();
          frames = demoFrames();
          if (settings.method === "fourier") frames = frames.slice(0, 1);
          dark = flat = null;
          settings = {
            ...defaultMeasurementSettings(),
            method: settings.method,
          };
          sourceProject = null;
          name = "Synthetic wavefront reference";
          invalidate();
          message =
            "Synthetic example loaded. The phase includes a known smooth bump and carrier.";
          render();
          return;
        case "capture": {
          const captured = capture(settings.method);
          acquiredAt = new Date().toISOString();
          acquisitionId = crypto.randomUUID();
          frames = captured.frames;
          dark = flat = null;
          settings = {
            ...defaultMeasurementSettings(),
            method: settings.method,
            pixelUm: captured.pixelUm,
            wavelength: captured.wavelength,
          };
          sourceProject = structuredClone(getProject());
          name = "Simulated " + getProject().title;
          invalidate();
          message =
            "Ideal phase-stepped irradiance captured from the current bench. This is simulated linear data.";
          render();
          return;
        }
        case "import-frames":
          $("#measurement-files").multiple = settings.method === "four-step";
          $("#measurement-files").click();
          return;
        case "dark":
        case "flat":
          $("#measurement-calibration").dataset.role = action;
          $("#measurement-calibration").click();
          return;
        case "clear-calibration":
          dark = flat = null;
          invalidate();
          render();
          return;
        case "frame-up": {
          const i = +b.dataset.index;
          [frames[i - 1], frames[i]] = [frames[i], frames[i - 1]];
          invalidate();
          render();
          return;
        }
        case "analyze":
          await reconstruct();
          return;
        case "save": {
          const r = record();
          await store.save(r);
          status(
            "Experiment saved in this browser. Export JSON for a portable backup.",
          );
          await refreshRuns();
          return;
        }
        case "export-run":
          download("optibench-measurement.json", JSON.stringify(record()));
          status(
            "Complete run exported, including decoded frames and calibration.",
          );
          return;
        case "import-run":
          $("#measurement-run-file").click();
          return;
        case "load-run":
          await loadRecord(runs.find((r) => r.id === b.dataset.id));
          return;
        case "delete-run":
          await store.remove(b.dataset.id);
          selectedRuns.delete(b.dataset.id);
          repeatIds.delete(b.dataset.id);
          study = null;
          repeatVerified = false;
          await refreshRuns();
          status(
            "Saved experiment deleted. The currently loaded data remains available.",
          );
          return;
        case "csv":
          download(
            "optibench-phase-map.csv",
            measurementCSV(result),
            "text/csv",
          );
          return;
        case "report": {
          const r = record(),
            map = $("#measurement-map").toDataURL("image/png");
          download(
            "optibench-measurement-report.html",
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>${esc(r.name)}</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:24px;color:#17212b}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px;text-align:left}img{max-width:512px;width:100%}pre{white-space:pre-wrap}small{color:#555}</style><h1>${esc(r.name)}</h1><p>${esc(r.createdAt)} · OptiBench metrology ${METROLOGY_VERSION}</p><p>${esc(frames[0].origin)} · ${esc(result.unit)} · ${settings.removeTilt ? "fitted plane" : "mean"} removed</p><table><tr><th>PV</th><th>RMS</th><th>Valid area</th><th>Visibility</th></tr><tr><td>${fmt(result.stats.pvNm)} nm</td><td>${fmt(result.stats.rmsNm)} nm</td><td>${fmt(result.stats.validFraction * 100)}%</td><td>${fmt(result.stats.meanVisibility * 100)}%</td></tr></table><h2>${esc(view)} map</h2><img alt="Measurement map" src="${map}"><p>${esc($("#measurement-map-scale").textContent)}</p><p>Acquisition time: ${esc(acquiredAt || "Unknown")}</p><h2>Settings</h2><pre>${esc(JSON.stringify(settings, null, 2))}</pre><h2>Input frames</h2><ul>${frames.map((f) => `<li>${esc(f.name)} · ${f.width} × ${f.height} · ${esc(f.precision || "normalized intensity")} · full scale ${esc(f.fullScale || 1)}</li>`).join("")}</ul><p>Dark: ${esc(dark?.name || "none")} · Flat: ${esc(flat?.name || "none")}</p><h2>Diagnostics</h2><ul>${result.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul><p>Unwrap conflicts: ${result.stats.unwrapConflicts}. Phase-step residual: ${fmt(result.stats.stepResidual, 6)}. PV and RMS are descriptive statistics, not uncertainty bounds. Relative fringe order and calibrated pixel scale remain the experimenter’s responsibility. Single-image phase sign requires a reference. Keep the exported run JSON and original camera files with this report.</p>${qualityHTML()}${referenceReport()}<h2>Cross-section</h2>${profileSVG()}<h2>Notes</h2><pre>${esc(notes)}</pre></html>`,
            "text/html",
          );
          return;
        }
      }
    } catch (error) {
      status(error.message);
    }
  }
  async function handleChange(e) {
    const el = e.target;
    e.stopPropagation();
    if (busy || importing) {
      render();
      return;
    }
    try {
      if (el.id === "measurement-acquired") {
        const v = el.value.trim();
        if (
          v &&
          (!/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v) ||
            !Number.isFinite(Date.parse(v)))
        )
          throw Error(
            "Use ISO 8601 acquisition time with timezone, or leave blank.",
          );
        acquiredAt = v ? new Date(v).toISOString() : "";
        return;
      }
      if (el.dataset.repeatId) {
        if (el.checked) {
          if (repeatIds.size >= 20) {
            el.checked = false;
            throw Error("At most 20 acquisitions per study.");
          }
          repeatIds.add(el.dataset.repeatId);
        } else repeatIds.delete(el.dataset.repeatId);
        repeatVerified = false;
        study = null;
        renderStudy();
        return;
      }
      if (el.id === "repeat-verified") {
        repeatVerified = el.checked;
        study = null;
        renderStudy();
        return;
      }
      if (el.id === "measurement-reference") {
        reference = el.value
          ? referenceRecord(runs.find((r) => r.id === el.value) || reference)
          : null;
        difference = null;
        registration = { dx: 0, dy: 0, verified: false };
        render();
        return;
      }
      if (el.dataset.registration) {
        registration[el.dataset.registration] =
          el.type === "checkbox" ? el.checked : Number(el.value);
        if (el.type !== "checkbox") registration.verified = false;
        difference = null;
        render();
        return;
      }
      if (el.dataset.profile) {
        profile[el.dataset.profile] =
          el.dataset.profile === "index" ? Number(el.value) : el.value;
        profile.index = Math.max(
          0,
          Math.min((result?.n || 64) - 1, Math.round(profile.index) || 0),
        );
        renderAdvanced();
        return;
      }
      if (el.id === "measurement-name") {
        name = el.value;
        return;
      }
      if (el.id === "measurement-notes") {
        notes = el.value;
        return;
      }
      if (el.id === "measurement-view") {
        view = el.value;
        paintResult();
        return;
      }
      if (el.dataset.runCompare) {
        if (el.checked) {
          if (selectedRuns.size >= 2) {
            el.checked = false;
            status("Select two runs to compare.");
            return;
          }
          selectedRuns.add(el.dataset.runCompare);
        } else selectedRuns.delete(el.dataset.runCompare);
        renderRuns();
        return;
      }
      if (el.dataset.setting) {
        if (!el.checkValidity()) {
          el.reportValidity();
          return;
        }
        const key = el.dataset.setting;
        settings[key] =
          el.type === "checkbox"
            ? el.checked
            : ["method", "geometry"].includes(key)
              ? el.value
              : +el.value;
        if (key === "method") {
          frames = [];
          dark = flat = null;
        }
        invalidate();
        render();
        return;
      }
      if (el.id === "measurement-files") {
        const files = Array.from(el.files || []),
          expected = settings.method === "four-step" ? 4 : 1;
        if (files.length !== expected)
          throw Error(
            `Select exactly ${expected} image${expected === 1 ? "" : "s"}. Four-step files are sorted by name; use ↑ to correct their phase order.`,
          );
        files.sort((a, b) =>
          a.name.localeCompare(b.name, undefined, { numeric: true }),
        );
        status("Decoding image samples…");
        importing = true;
        const decoded = await Promise.all(files.map(decode));
        if (
          decoded.some(
            (f) =>
              f.width !== decoded[0].width || f.height !== decoded[0].height,
          )
        )
          throw Error("All four frames must have the same dimensions.");
        acquiredAt = "";
        acquisitionId = crypto.randomUUID();
        frames = decoded;
        dark = flat = null;
        sourceProject = structuredClone(getProject());
        const min = Math.min(frames[0].width, frames[0].height);
        settings.n =
          [512, 256, 128, 64].find((n) => n <= Math.min(256, min)) || 64;
        settings.x = settings.y = 0;
        name = files[0].name.replace(/\.[^.]+$/, "");
        invalidate();
        message =
          "Images imported. Verify phase order, linear response and object-plane pixel calibration before reconstruction.";
        render();
        return;
      }
      if (el.id === "measurement-calibration") {
        if (!el.files?.length) return;
        importing = true;
        const frame = await decode(el.files[0]);
        if (
          !frames.length ||
          frame.width !== frames[0].width ||
          frame.height !== frames[0].height
        )
          throw Error(
            "Import matching signal frames before adding a calibration frame.",
          );
        if (el.dataset.role === "dark") dark = frame;
        else flat = frame;
        invalidate();
        message = "Calibration frame loaded.";
        render();
        return;
      }
      if (el.id === "measurement-run-file") {
        const file = el.files?.[0];
        if (!file) return;
        if (file.size > 250 * 1024 * 1024)
          throw Error("Run JSON exceeds the 250 MB import limit.");
        importing = true;
        await loadRecord(JSON.parse(await file.text()));
        return;
      }
    } catch (error) {
      status(error.message);
    } finally {
      importing = false;
    }
  }
  return { open };
}
