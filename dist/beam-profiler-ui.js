import { profilerReport } from "./profiler-report.js";
import { compareProfilerRecords } from "./profiler-records.js";
import { centerProfileROI, profileFrames } from "./profiler-workflows.js";
import { profilerStore, profilerExample } from "./beam-profiler.js";
import { TaskWorker } from "./task-worker.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
function graph(series, label, xLabel, yLabel) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return "";
  const loX = Math.min(...all.map((p) => p[0])),
    hiX = Math.max(...all.map((p) => p[0])),
    loY = Math.min(0, ...all.map((p) => p[1])),
    hiY = Math.max(...all.map((p) => p[1])),
    x = (v) => 55 + ((v - loX) / (hiX - loX || 1)) * 600,
    y = (v) => 180 - ((v - loY) / (hiY - loY || 1)) * 150;
  return `<figure class="profile-chart"><figcaption>${esc(label)}</figcaption><svg viewBox="0 0 710 225" role="img" aria-label="${esc(label)}"><path d="M55 25V180H660" fill="none" stroke="#708696"/>${series.map((s) => (s.dots ? s.points.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3" fill="${s.color}"/>`).join("") : `<polyline points="${s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="1.6"/>`)).join("")}<g fill="currentColor" font-size="11"><text x="55" y="16">${esc(yLabel)} · ${fmt(loY)} to ${fmt(hiY)}</text><text x="55" y="198">${fmt(loX)}</text><text x="620" y="198">${fmt(hiX)}</text><text x="280" y="219">${esc(xLabel)}</text></g></svg></figure>`;
}
function profileGraphs(r) {
  const a = r.analysis;
  if (!a) return "";
  const n = r.frame.n,
    pitch = r.camera.pixelPitch / 1000;
  return ["x", "y"]
    .map((axis) => {
      const fit = axis === "x" ? a.fitX : a.fitY,
        points = (v) => v.map((y, i) => [(i + 0.5 - n / 2) * pitch, y]);
      return (
        graph(
          [
            { points: points(a.profiles[axis]), color: "#6bc9ec" },
            ...(fit ? [{ points: points(fit.fitted), color: "#b7e97d" }] : []),
          ],
          `${axis.toUpperCase()} integrated profile · blue measured / green Gaussian`,
          "Sensor position · mm",
          "Summed normalized ADC",
        ) +
        (fit
          ? graph(
              [{ points: points(fit.residuals), color: "#e9b86f" }],
              `${axis.toUpperCase()} fit residual · RMS ${fmt(fit.rms)}`,
              "Sensor position · mm",
              "Measured − fit",
            )
          : "")
      );
    })
    .join("");
}
function scanGraph(r) {
  return graph(
    ["x", "y"].flatMap((axis, i) => {
      const color = i ? "#b7e97d" : "#6bc9ec",
        key = i ? "diameterYmm" : "diameterXmm",
        f = r.fits[axis];
      return [
        {
          color,
          dots: true,
          points: r.points
            .filter((p) => p.record.analysis?.valid)
            .map((p) => [p.positionMm, p.record.analysis[key]]),
        },
        ...(f
          ? [
              {
                color,
                points: Array.from({ length: 101 }, (_, i) => {
                  const z =
                      r.travel.start +
                      ((r.travel.end - r.travel.start) * i) / 100,
                    t = (z - f.mid) / f.scale;
                  return [
                    z,
                    2 *
                      Math.sqrt(
                        Math.max(
                          0,
                          f.coefficients[0] +
                            f.coefficients[1] * t +
                            f.coefficients[2] * t * t,
                        ),
                      ),
                  ];
                }),
              },
            ]
          : []),
      ];
    }),
    "Propagation · blue X / green Y · dots measured / curves fitted",
    "Camera travel · mm",
    "D4σ diameter · mm",
  );
}
export function createProfilerWorkspace({
  getProject,
  getDetector,
  onDetector,
  onBench,
  store = profilerStore,
  run,
} = {}) {
  let root,
    record = null,
    history = [],
    message = "",
    busy = false,
    selectedFrame = 0,
    repeatCount = 5,
    comparison = null,
    pendingDelete = null;
  const settings = {
      detectorId: null,
      n: 256,
      exposure: 2,
      backgroundFrames: 8,
      roiX: 0,
      roiY: 0,
    },
    travel = { start: -100, end: 100, count: 11 };
  function sync() {
    const p = getProject(),
      cameras = p.items.filter((c) => c.enabled && c.type === "camera");
    if (!cameras.some((c) => c.id === settings.detectorId)) {
      settings.detectorId =
        cameras.find((c) => c.id === getDetector?.())?.id ??
        cameras[0]?.id ??
        null;
      const camera = cameras.find((c) => c.id === settings.detectorId);
      if (camera) settings.exposure = camera.exposure;
    }
    return { p, cameras };
  }
  const byteCache = new WeakMap();
  function bytes(r) {
    if (!byteCache.has(r)) byteCache.set(r, new Blob([JSON.stringify(r)]).size);
    return byteCache.get(r);
  }
  async function perform(data) {
    if (run) return run(data);
    return new Promise((resolve, reject) => {
      const worker = new TaskWorker(
        new URL("./beam-profiler-worker.js", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = (e) =>
        e.data.error ? reject(Error(e.data.error)) : resolve(e.data.result);
      worker.onerror = (e) => reject(Error(e.message));
      worker.postMessage(data);
    });
  }
  async function importFile(file) {
    if (!file || busy) return;
    try {
      if (file.size > 64 * 1024 * 1024)
        throw Error("Profiler imports are limited to 64 MB.");
      busy = true;
      message = "Validating imported pixels and recomputing measurements…";
      render();
      record = await perform({ mode: "import", text: await file.text() });
      comparison = null;
      selectedFrame = 0;
      message =
        "Import reviewed and measurements recomputed. Save to retain this record locally.";
    } catch (e) {
      message = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  function render() {
    if (!root) return;
    const { p, cameras } = sync(),
      scan = record?.format === "optibench-beam-scan",
      repeat = record?.format === "optibench-beam-repeat",
      r = profileFrames(record)[selectedFrame],
      a = r?.analysis;
    root.innerHTML = `<header class="measurement-header"><button data-profiler="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Camera beam profiler</h1><span>Simulated instrument</span></header><main class="instrument-main"><h2>${esc(p.title)}</h2><p role="status">${esc(message)}</p><div class="instrument-grid"><aside class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Camera acquisition</legend><label>Camera<select data-profile-setting="detectorId">${cameras.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></label><label>Exposure · ms<input type="number" min="0.001" max="10000" step="any" required data-profile-setting="exposure" value="${settings.exposure}"></label><label>Native-pixel square ROI<select data-profile-setting="n">${[64, 128, 256, 512].map((n) => `<option value="${n}">${n} × ${n}</option>`).join("")}</select></label>${["roiX", "roiY"].map((k) => `<label>ROI ${k === "roiX" ? "X" : "Y"} offset · pixels<input data-profile-setting="${k}" type="number" step="1" min="-20000" max="20000" required value="${settings[k]}"></label>`).join("")}<label>Shutter-closed background average<select data-profile-setting="backgroundFrames">${[1, 4, 8, 16].map((n) => `<option value="${n}">${n} frames</option>`).join("")}</select></label><button data-profiler="acquire" ${!cameras.length ? "disabled" : ""}>Acquire beam frame</button><button data-profiler="auto" ${!cameras.length ? "disabled" : ""}>Find exposure & acquire</button><label>Repeated acquisitions<select data-profile-repeats>${[3, 5, 10].map((n) => `<option value="${n}">${n} frames</option>`).join("")}</select></label><button data-profiler="repeat" ${!cameras.length ? "disabled" : ""}>Measure repeatability</button><p>Exposure is applied to this acquisition. Pixel pitch, noise, QE, gain and full well come from the bench camera. Background is acquired at matching settings.</p></fieldset><fieldset ${busy ? "disabled" : ""}><legend>Detector-position scan</legend>${[
      ["start", "Start travel · mm", -1500, 1500],
      ["end", "End travel · mm", -1500, 1500],
      ["count", "Positions", 7, 21],
    ]
      .map(
        ([k, l, min, max]) =>
          `<label>${l}<input required type="number" min="${min}" max="${max}" step="${k === "count" ? 1 : "any"}" data-profile-travel="${k}" value="${travel[k]}"></label>`,
      )
      .join(
        "",
      )}<button data-profiler="scan" ${!cameras.length ? "disabled" : ""}>Acquire propagation scan</button><p>Travel follows the camera normal from its current position. Keep the scan in free space and bracket the waist. Use an ROI up to 256 pixels for scans.</p></fieldset><button data-profiler="example" ${busy ? "disabled" : ""}>Load focused-beam example</button><p>Loads a new bench layout. Acquisitions and scans use frozen copies of the current bench.</p></aside><section class="instrument-results">${
      r
        ? `<h2>Recorded acquisition</h2><p>${esc(r.acquiredAt)} · ${esc(r.camera.label)} · ${r.settings.exposure} ms · ${r.frame.n} × ${r.frame.n} pixels</p>${
            scan || repeat
              ? `<label>Recorded frame<select data-profile-frame>${profileFrames(
                  record,
                )
                  .map(
                    (f, i) =>
                      `<option value="${i}">${scan ? fmt(record.points[i].positionMm) + " mm" : "Repeat " + (i + 1)} · ${f.analysis?.valid ? "valid" : "flagged"}</option>`,
                  )
                  .join("")}</select></label>`
              : ""
          }<div class="instrument-readout"><figure><canvas data-profile-image width="${r.frame.n}" height="${r.frame.n}" aria-label="Background-subtracted camera image"></canvas><figcaption>Background-subtracted display, autoscaled for viewing. Analysis uses recorded ADC values.</figcaption></figure><div>${a ? `<dl><dt>Centroid · ROI-relative X / Y</dt><dd>${fmt(a.centroidXmm)} / ${fmt(a.centroidYmm)} mm</dd><dt>Centroid · sensor-relative X / Y</dt><dd>${fmt(a.sensorCentroidXmm ?? a.centroidXmm + r.roi.offsetXmm)} / ${fmt(a.sensorCentroidYmm ?? a.centroidYmm + r.roi.offsetYmm)} mm</dd><dt>D4σ diameter · X / Y</dt><dd>${fmt(a.diameterXmm)} / ${fmt(a.diameterYmm)} mm</dd><dt>Principal diameters · major / minor</dt><dd>${fmt(a.majorDiameterMm)} / ${fmt(a.minorDiameterMm)} mm</dd><dt>Ellipticity · minor / major</dt><dd>${fmt(a.ellipticity)}</dd><dt>Major-axis orientation</dt><dd>${a.orientationDeg === null ? "Unresolved · nearly circular" : fmt(a.orientationDeg) + "°"}</dd><dt>Clipped pixels</dt><dd>${fmt(a.saturatedFraction * 100)}%</dd></dl>` : `<p class="instrument-warning">${esc(r.analysisError)}</p>`}</div></div>${[...(a?.warnings || []), ...r.warnings].map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("")}${r.autoExposure ? `<p>Automatic exposure · ${r.autoExposure.attempts.length} trials · ${r.autoExposure.converged ? "target reached" : "target unresolved"}</p>` : ""}${profileGraphs(r)}${
            repeat
              ? `<h2>Measured repeatability</h2><p>${record.summary.valid} valid / ${record.summary.excluded} excluded frames</p>${
                  record.summary.error
                    ? `<p class="instrument-warning">${esc(record.summary.error)}</p>`
                    : `<table><thead><tr><th>Quantity · mm</th><th>Mean</th><th>Sample SD</th><th>Standard error</th></tr></thead><tbody>${Object.entries(
                        record.summary.metrics,
                      )
                        .map(
                          ([k, v]) =>
                            `<tr><td>${esc(k)}</td><td>${fmt(v.mean)}</td><td>${fmt(v.sd)}</td><td>${fmt(v.sem)}</td></tr>`,
                        )
                        .join("")}</tbody></table>`
                }<p>${esc(record.summary.model)}</p>`
              : ""
          }${
            scan
              ? `<h2>Measured propagation</h2>${scanGraph(record)}${["x", "y"]
                  .map((axis) => {
                    const f = record.fits[axis];
                    return f
                      ? `<p><strong>${axis.toUpperCase()}</strong> waist radius ${fmt(f.waistRadiusMm)} mm · waist at ${fmt(f.waistPositionMm)} mm travel · divergence half-angle ${fmt(f.halfAngleMrad)} mrad</p><p>Radius-squared residual RMS ${fmt(f.rmsRadiusSquaredMm2)} mm² · ${f.valid} fitted / ${f.excluded} excluded positions</p>${f.uncertainty ? `<p>Approximate 95% intervals · waist radius ${f.uncertainty.waistRadiusMm.ci95.map(fmt).join(" to ")} mm · waist position ${f.uncertainty.waistPositionMm.ci95.map(fmt).join(" to ")} mm · half-angle ${f.uncertainty.halfAngleMrad.ci95.map(fmt).join(" to ")} mrad</p><p>${esc(f.uncertainty.method)}</p>` : ""}`
                      : `<p class="instrument-warning">${axis.toUpperCase()}: ${esc(record.errors[axis])}</p>`;
                  })
                  .join("")}<p>${esc(record.model)}</p>`
              : ""
          }<label>Record name<input data-profile-note="name" maxlength="200" value="${esc(record.name || "")}" ${busy ? "disabled" : ""}></label><label>Experiment notes<textarea data-profile-note="notes" maxlength="10000" rows="3" ${busy ? "disabled" : ""}>${esc(record.notes || "")}</textarea></label><div class="measurement-buttons"><button data-profiler="center" ${busy || !a ? "disabled" : ""}>Center ROI on recorded beam</button><button data-profiler="save" ${busy ? "disabled" : ""}>Save ${scan ? "scan" : repeat ? "repeats" : "frame"}</button><button data-profiler="json">Export complete JSON</button><button data-profiler="report">Export printable report</button><button data-profiler="csv">Export ${scan || repeat ? "widths" : "profiles"} CSV</button></div><details><summary>Acquisition model and method</summary><p>${esc(r.model)}</p><p>Diameter = four standard deviations of the intensity distribution. Gaussian fits are shown for comparison. Orientation is withheld for nearly circular beams.</p><a href="https://www.rp-photonics.com/beam_radius.html" target="_blank" rel="noreferrer">Beam-radius definitions</a></details>`
        : "<h2>Acquire a camera frame</h2><p>Select a bench camera or load the focused-beam example. The profiler measures recorded pixels after an averaged dark frame and border-offset correction.</p>"
    }<h3>Saved profiles and scans</h3><label>Import OptiBench profiler JSON<input type="file" accept=".json,application/json" data-profile-import ${busy ? "disabled" : ""}></label><select data-profile-history><option value="">Choose a saved record</option>${history
      .filter((r) => !r.trashedAt)
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name || r.acquiredAt)} · ${r.format === "optibench-beam-scan" ? "Propagation scan" : r.format === "optibench-beam-repeat" ? "Repeatability" : "Camera profile"}</option>`,
      )
      .join(
        "",
      )}</select><button data-profiler="open" ${busy ? "disabled" : ""}>Open record</button><button data-profiler="trash" ${busy ? "disabled" : ""}>Move selected to Trash</button><button data-profiler="compare" ${busy || !record ? "disabled" : ""}>Compare selected to current</button>${comparison ? `<h3>Saved-run comparison</h3><p>Baseline ${esc(comparison.baselineAt)} → current ${esc(comparison.currentAt)}</p><table><thead><tr><th>Quantity</th><th>Baseline</th><th>Current</th><th>Difference</th><th>%</th></tr></thead><tbody>${comparison.rows.map((v) => `<tr><td>${esc(v.label)} · ${esc(v.unit)}</td><td>${fmt(v.baseline)}</td><td>${fmt(v.current)}</td><td>${fmt(v.delta)}</td><td>${fmt(v.percent)}</td></tr>`).join("")}</tbody></table>${comparison.conditions.map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("")}<p>${esc(comparison.note)}</p><button data-profiler="clear-comparison">Clear comparison</button>` : ""}<details><summary>Local records · ${history.length} saved · ${(history.reduce((s, r) => s + bytes(r), 0) / 1048576).toFixed(2)} MB of JSON</summary><p>Trash is reversible and retains its storage. Export a complete JSON backup before permanent deletion.</p>${
      history
        .filter((r) => r.trashedAt)
        .map(
          (r) =>
            `<p>${esc(r.name || r.acquiredAt)} · ${(bytes(r) / 1048576).toFixed(2)} MB <button data-profiler="backup" data-profile-id="${esc(r.id)}">Export backup</button><button data-profiler="restore" data-profile-id="${esc(r.id)}">Restore</button><button data-profiler="purge" data-profile-id="${esc(r.id)}">Delete permanently</button></p>`,
        )
        .join("") || "<p>Trash is empty.</p>"
    }</details>${pendingDelete ? `<div class="instrument-warning"><p>Permanently delete this saved record? This cannot be undone. Export a JSON backup first.</p><button data-profiler="confirm-purge" data-profile-id="${esc(pendingDelete)}">Confirm permanent deletion</button><button data-profiler="cancel-purge">Cancel</button></div>` : ""}<p>Records are saved in this browser, including frames, averaged backgrounds, settings, bench snapshots and diagnostics. Export JSON for a portable copy. Opening a record leaves the live bench unchanged.</p></section></div></main>`;
    for (const key of ["detectorId", "n", "backgroundFrames"])
      root.querySelector(`[data-profile-setting="${key}"]`).value = String(
        settings[key] ?? "",
      );
    root.querySelector("[data-profile-repeats]").value = String(repeatCount);
    if (scan || repeat)
      root.querySelector("[data-profile-frame]").value = String(selectedFrame);
    if (r) {
      const canvas = root.querySelector("canvas"),
        ctx = canvas.getContext("2d");
      if (ctx) {
        const n = r.frame.n,
          img = ctx.createImageData(n, n),
          data = r.frame.values.map((v, i) =>
            Math.max(0, v - r.dark[i] - (r.analysis?.borderOffset || 0)),
          ),
          max = data.reduce((m, v) => Math.max(m, v), 0) || 1;
        for (let i = 0; i < data.length; i++) {
          const v = Math.sqrt(data[i] / max);
          img.data[i * 4] = 255 * v;
          img.data[i * 4 + 1] = 220 * v;
          img.data[i * 4 + 2] = 105 * v;
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
    }
  }
  async function action(action, targetId) {
    if (busy) return;
    try {
      if (["save", "trash", "restore", "confirm-purge"].includes(action))
        busy = true;
      if (action === "close") {
        closeWorkspace(root);
        return;
      }
      if (action === "example") {
        onBench?.(profilerExample());
        settings.detectorId = null;
        settings.roiX = settings.roiY = 0;
        sync();
        message =
          "Focused-beam example loaded. Acquire a frame or scan from −100 to +100 mm.";
      }
      if (["acquire", "scan", "auto", "repeat"].includes(action)) {
        if (
          [
            ...root.querySelectorAll(
              action === "scan" ? "input" : "input[data-profile-setting]",
            ),
          ].some((el) => !el.checkValidity())
        )
          throw Error("Enter valid acquisition settings.");
        sync();
        const data = {
          mode: action === "acquire" ? "frame" : action,
          project: getProject(),
          settings: {
            ...settings,
            seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147482000,
          },
          travel: { ...travel },
          repeatCount,
        };
        busy = true;
        message = "Acquiring simulated camera data…";
        render();
        const result = await perform(data);
        record = result;
        comparison = null;
        if (action === "auto") settings.exposure = record.settings.exposure;
        selectedFrame = 0;
        message =
          action === "auto"
            ? record.autoExposure.converged
              ? "Automatic exposure found from camera readings."
              : record.autoExposure.reason
            : "Acquisition complete. Results below belong to the recorded bench snapshot.";
      }
      if (action === "center") {
        const r = profileFrames(record)[selectedFrame];
        if (r.detectorId !== settings.detectorId)
          throw Error("Select the recorded camera before applying its ROI.");
        Object.assign(settings, centerProfileROI(r));
        message =
          "ROI centered using the recorded centroid. Acquire again to measure the new region.";
      }
      if (action === "trash") {
        const selected = history.find(
          (r) => r.id === root.querySelector("[data-profile-history]").value,
        );
        if (!selected) throw Error("Choose a saved record to move to Trash.");
        await store.save({ ...selected, trashedAt: new Date().toISOString() });
        history = await store.list();
        message = "Saved record moved to Trash. Restore it below if needed.";
      }
      if (action === "restore") {
        const selected = history.find((r) => r.id === targetId && r.trashedAt);
        if (!selected) throw Error("Choose a record in Trash.");
        const restored = { ...selected };
        delete restored.trashedAt;
        await store.save(restored);
        history = await store.list();
        message = "Saved record restored.";
      }
      if (action === "backup") {
        const selected = history.find((r) => r.id === targetId);
        if (!selected) throw Error("Choose a saved record.");
        const url = URL.createObjectURL(
            new Blob([JSON.stringify(selected)], { type: "application/json" }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = "optibench-profiler-backup.json";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message =
          "Backup exported. Verify the downloaded file before deleting.";
      }
      if (action === "purge") pendingDelete = targetId;
      if (action === "cancel-purge") pendingDelete = null;
      if (action === "confirm-purge") {
        if (
          targetId !== pendingDelete ||
          !history.some((r) => r.id === targetId && r.trashedAt)
        )
          throw Error("Select a record in Trash before deleting.");
        await store.remove(targetId);
        history = await store.list();
        pendingDelete = null;
        message =
          "Saved record permanently deleted. Any open acquisition remains in memory until replaced.";
      }
      if (action === "save") {
        delete record.trashedAt;
        await store.save(record);
        history = await store.list();
        message = "Camera data and bench snapshots saved locally.";
      }
      if (action === "compare") {
        const baseline = history.find(
          (r) => r.id === root.querySelector("[data-profile-history]").value,
        );
        comparison = compareProfilerRecords(baseline, record);
        message = "Saved baseline compared with the current recorded result.";
      }
      if (action === "clear-comparison") comparison = null;
      if (action === "open") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-profile-history]").value,
        );
        if (!r) throw Error("Choose a saved record.");
        record = structuredClone(r);
        comparison = null;
        selectedFrame = 0;
        message = "Recorded acquisition opened. Live settings unchanged.";
      }
      if (action === "report") {
        const canvas = root.querySelector("[data-profile-image]");
        const html = profilerReport(record, {
          selectedFrame,
          comparison,
          imageData: canvas?.toDataURL("image/png"),
        });
        const url = URL.createObjectURL(
            new Blob([html], { type: "text/html" }),
          ),
          a = document.createElement("a");
        a.href = url;
        a.download = "optibench-lab-report.html";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        message =
          "Report exported. Open the HTML file to print or save as PDF.";
      }
      if (action === "json" || action === "csv") {
        const scan = record.format === "optibench-beam-scan",
          text =
            action === "json"
              ? JSON.stringify(record)
              : record.format === "optibench-beam-repeat"
                ? "repeat,diameter_x_mm,diameter_y_mm,valid\n" +
                  record.records
                    .map((r, i) =>
                      [
                        i + 1,
                        r.analysis?.diameterXmm ?? "",
                        r.analysis?.diameterYmm ?? "",
                        r.analysis?.valid ?? false,
                      ].join(","),
                    )
                    .join("\n")
                : scan
                  ? "travel_mm,diameter_x_mm,diameter_y_mm,valid\n" +
                    record.points
                      .map((p) =>
                        [
                          p.positionMm,
                          p.record.analysis?.diameterXmm ?? "",
                          p.record.analysis?.diameterYmm ?? "",
                          p.record.analysis?.valid ?? false,
                        ].join(","),
                      )
                      .join("\n")
                  : "position_mm,profile_x,fit_x,residual_x,profile_y,fit_y,residual_y\n" +
                    (record.analysis
                      ? record.analysis.profiles.x
                          .map((v, i) =>
                            [
                              ((i + 0.5 - record.frame.n / 2) *
                                record.camera.pixelPitch) /
                                1000,
                              v,
                              record.analysis.fitX?.fitted[i] ?? "",
                              record.analysis.fitX?.residuals[i] ?? "",
                              record.analysis.profiles.y[i],
                              record.analysis.fitY?.fitted[i] ?? "",
                              record.analysis.fitY?.residuals[i] ?? "",
                            ].join(","),
                          )
                          .join("\n")
                      : "");
        const url = URL.createObjectURL(
            new Blob([text], {
              type: action === "json" ? "application/json" : "text/csv",
            }),
          ),
          link = document.createElement("a");
        link.href = url;
        link.download = `optibench-beam-${scan ? "scan" : record.format === "optibench-beam-repeat" ? "repeats" : "profile"}.${action}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      message = e.message;
    } finally {
      busy = false;
      if (action !== "close") render();
    }
  }
  return {
    async openRecord(r) {
      if (r?.format !== "optibench-beam-profile")
        throw Error("Choose a recorded camera profile.");
      await this.open();
      record = structuredClone(r);
      selectedFrame = 0;
      comparison = null;
      message = "Recorded Runbook acquisition opened; live bench unchanged.";
      render();
    },
    async open() {
      if (!root) {
        root = document.createElement("section");
        root.id = "profiler-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const a = e.target.closest("[data-profiler]")?.dataset.profiler;
          if (a)
            void action(
              a,
              e.target.closest("[data-profiler]").dataset.profileId,
            );
        };
        root.onchange = (e) => {
          if (busy) return;
          if (e.target.dataset.profileNote) {
            if (record)
              record[e.target.dataset.profileNote] = e.target.value.slice(
                0,
                e.target.dataset.profileNote === "name" ? 200 : 10000,
              );
            return;
          }
          if (e.target.matches("[data-profile-import]")) {
            void importFile(e.target.files?.[0]);
            return;
          }
          if (e.target.matches("[data-profile-repeats]")) {
            repeatCount = Number(e.target.value);
            return;
          }
          if (e.target.matches("[data-profile-frame]")) {
            selectedFrame = Number(e.target.value);
            render();
            return;
          }
          const k = e.target.dataset.profileSetting,
            t = e.target.dataset.profileTravel;
          if (!(k || t) || !e.target.checkValidity()) return;
          if (k) {
            settings[k] = Number(e.target.value);
            if (k === "detectorId") {
              settings.roiX = settings.roiY = 0;
              onDetector?.(settings.detectorId);
              settings.exposure =
                getProject().items.find((c) => c.id === settings.detectorId)
                  ?.exposure || 2;
            }
          } else travel[t] = Number(e.target.value);
          message =
            "Acquisition settings changed; recorded results remain unchanged.";
          render();
        };
      }
      sync();
      showWorkspace(root);
      render();
      try {
        history = await store.list();
      } catch (e) {
        message = e.message;
      }
      render();
    },
  };
}
