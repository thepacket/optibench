import { instrumentSetup, acquireInstrument } from "./instrument-lab.js";
import { analyzeMeasurement } from "./metrology.js";
import { analyzeRepeats } from "./repeatability.js";
import { runStore, serializable } from "./run-store.js";
import { validateProject } from "./project.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import { TaskWorker } from "./task-worker.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
function download(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function createInstrumentWorkspace({
  getProject,
  getDetector,
  onDetector,
  onMeasure,
  onBench,
  store = runStore,
  acquire,
} = {}) {
  let root,
    project = validateProject(instrumentSetup()),
    detectorId = null,
    records = [],
    selected = 0,
    saved = [],
    busy = false,
    message = "",
    truth = false,
    repeat = null;
  function syncBench() {
    if (getProject) project = validateProject(getProject());
    const cameras = project.items.filter(
      (c) => c.type === "camera" && c.enabled,
    );
    const preferred = getDetector?.();
    if (cameras.some((c) => c.id === preferred)) detectorId = preferred;
    else if (!cameras.some((c) => c.id === detectorId))
      detectorId = cameras[0]?.id ?? null;
  }
  const run =
    acquire ||
    (async (p, config) => {
      if (typeof Worker === "undefined") return acquireInstrument(p, config);
      const worker = new TaskWorker(
        new URL("./instrument-worker.js", import.meta.url),
        { type: "module" },
      );
      try {
        return await new Promise((resolve, reject) => {
          worker.onmessage = ({ data }) =>
            data.error ? reject(Error(data.error)) : resolve(data.result);
          worker.onerror = () =>
            reject(Error("Camera acquisition failed. Retry the acquisition."));
          worker.postMessage({ project: p, config });
        });
      } finally {
        worker.terminate();
      }
    });
  const control = (c, key, label, min, max, step) =>
    c
      ? `<label>${label}<input type="number" data-component="${c.id}" data-instrument-field="${key}" value="${c[key] ?? 0}" min="${min}" max="${max}" step="any" required ${busy ? "disabled" : ""}></label>`
      : "";
  function render() {
    const camera = project.items.find(
        (c) => c.id === detectorId && c.type === "camera" && c.enabled,
      ),
      source = project.items.find((c) => c.type === "source" && c.enabled),
      record = records[selected];
    const stale =
      record &&
      (JSON.stringify(record.project) !== JSON.stringify(project) ||
        record.simulation.camera.id !== detectorId);
    root.innerHTML = `<header class="measurement-header"><button data-lab="close" ${busy ? "disabled" : ""}>← Optical bench</button><div><span class="measurement-kicker">OPTIBENCH / VIRTUAL INSTRUMENTS</span><h1>Michelson experiment</h1></div><span>Simulated camera measurements</span></header>
      <main class="instrument-main"><h2>Live bench · ${esc(project.title)}</h2><p>Instrument edits update the active bench. Captured images retain their original settings and layout.</p><label>Acquisition camera<select data-lab-camera ${busy ? "disabled" : ""}><option value="">Choose an enabled camera</option>${project.items
        .filter((c) => c.type === "camera" && c.enabled)
        .map(
          (c) =>
            `<option value="${c.id}" ${c.id === detectorId ? "selected" : ""}>${esc(c.label)} · ${esc(c.part)}</option>`,
        )
        .join(
          "",
        )}</select></label>${!camera ? '<p class="instrument-warning">No camera selected. Add or enable a camera on the bench.</p>' : ""}<p role="status">${esc(message || "Adjust the experiment, then acquire four phase frames. Readouts come from the camera data.")}</p>
      <div class="instrument-grid"><aside class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Mirror controls</legend>${project.items
        .filter((c) => c.type === "mirror")
        .map(
          (c) =>
            `<h3>${esc(c.label)}</h3>${control(c, "pistonNm", "Optical piston · nm", -10000, 10000, 1)}${control(c, "angle", "Yaw · degrees", -360, 360, 0.001)}`,
        )
        .join(
          "",
        )}<p>Optical piston changes phase, not mount position. Acquisition uses ideal calibrated quarter-cycle reference-arm phase steps.</p></fieldset>
      <fieldset ${busy ? "disabled" : ""}><legend>Camera & source</legend>${control(camera, "exposure", "Exposure · ms", 0.001, 100000, 0.1)}${control(camera, "gain", "Digital gain", 0.01, 100, 0.1)}${control(source, "power", "Incident laser power · mW", 0.000000001, 100000, 0.000001)}<details><summary>Sensor model assumptions</summary>${control(camera, "qe", "Quantum efficiency · 0–1", 0, 1, 0.01)}${control(camera, "readNoise", "Read noise · electrons RMS", 0, 10000, 0.1)}${control(camera, "darkCurrent", "Dark current · electrons / s", 0, 100000, 0.1)}${control(camera, "fullWell", "Full well · electrons", 1, 10000000, 1)}<p>${camera?.bits ?? "—"}-bit ADC · ${camera?.pixelPitch ?? "—"} µm pixels. No calibrated vendor response is claimed.</p></details></fieldset>
      <div class="measurement-buttons"><button data-lab="acquire" ${busy || !camera ? "disabled" : ""}>Acquire 4 phase frames</button><button data-lab="repeat" ${busy || !camera ? "disabled" : ""}>Acquire 3 repeats</button><button data-lab="bench" ${busy ? "disabled" : ""}>Back to optical bench</button></div><p>256 × 256 unbinned central sensor pixels. Fixed black/white display scale; exposure changes measured brightness. Repeats use independent noise seeds with unchanged settings.</p></aside>
      <section class="instrument-results"><div class="instrument-actions"><label>Acquisition<select data-lab-select ${busy || !records.length ? "disabled" : ""}>${records.map((r, i) => `<option value="${i}" ${i === selected ? "selected" : ""}>${i + 1}. ${esc(r.acquiredAt)} · ${r.simulation.camera.exposure} ms</option>`).join("")}</select></label><label>Display phase<select data-lab-phase><option value="0">0°</option><option value="1">90°</option><option value="2">180°</option><option value="3">270°</option></select></label></div>
      ${stale ? '<p class="instrument-warning">Settings changed. This image and its measurements belong to the recorded acquisition; acquire again to observe the change.</p>' : ""}
      <div class="instrument-readout"><figure><canvas width="256" height="256" aria-label="Acquired camera frame"></canvas><figcaption>Native central ROI · black 0, white ADC full scale</figcaption></figure><div><h2>Measured from captured frames</h2>${record ? `<p>Recorded camera: ${esc(record.simulation.camera.label)} · ${record.simulation.camera.exposure} ms · ${esc(record.acquiredAt)}</p>` : ""}${record ? `<dl><dt>Mean visibility</dt><dd>${fmt(record.result?.stats.meanVisibility * 100)}%</dd><dt>Valid detector area</dt><dd>${fmt(record.result?.stats.validFraction * 100)}%</dd><dt>Relative OPD RMS / PV</dt><dd>${fmt(record.result?.stats.rmsNm)} / ${fmt(record.result?.stats.pvNm)} nm</dd><dt>Maximum clipped pixels across phase frames</dt><dd>${fmt(Math.max(...record.simulation.saturated) * 100)}%</dd></dl><p>Fitted piston and tilt removed; these values cannot recover absolute mirror displacement.</p>${record.simulation.analysisError ? `<p class="instrument-warning">Reconstruction unavailable: ${esc(record.simulation.analysisError)}</p>` : ""}${record.result?.warnings.map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("") || ""}` : "<p>No acquisition yet.</p>"}</div></div>
      <div class="measurement-buttons"><button data-lab="measure" ${!record || busy ? "disabled" : ""}>Open acquisition in Measure</button><button data-lab="save" ${!record || busy ? "disabled" : ""}>Save all acquisitions</button><button data-lab="export" ${!record || busy ? "disabled" : ""}>Export selected run JSON</button><button data-lab="report" ${!record || busy ? "disabled" : ""}>Export measurement report</button></div>
      <label class="measurement-check"><input type="checkbox" data-lab-truth ${truth ? "checked" : ""}>Show simulator truth</label>${truth && record ? `<div class="instrument-truth"><h3>Simulator truth · not measured</h3><p>Path OPD: ${fmt(record.simulation.truth.opdNm)} nm · coherence: ${fmt(record.simulation.truth.coherence)} · predicted fringe period: ${fmt(record.simulation.truth.fringePeriodMm)} mm</p></div>` : ""}
      ${repeat ? `<h3>Three independent simulated acquisitions</h3><p>Relative OPD RMS mean / sample SD: ${fmt(repeat.rms.mean)} / ${fmt(repeat.rms.sd)} nm. PV mean / sample SD: ${fmt(repeat.pv.mean)} / ${fmt(repeat.pv.sd)} nm.</p><p>Noise repeatability under fixed model conditions; no physical uncertainty or drift qualification.</p>` : ""}
      <section><h3>Resume a saved acquisition</h3><label>Saved instrument runs<select data-lab-saved><option value="">Choose a saved run</option>${saved.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join("")}</select></label><button data-lab="restore" ${busy ? "disabled" : ""}>Open saved acquisition</button><button data-lab="apply-record" ${busy || !record ? "disabled" : ""}>Apply recorded layout to bench</button><p>Opening saved data does not replace the live bench. Applying its layout is undoable. Saved runs also appear in Measure. Exported run JSON can be reopened there with its full camera settings and bench snapshot.</p></section></section></div></main>`;
    root.querySelector("[data-lab-camera]").value = detectorId == null ? "" : String(detectorId);
    paint();
  }
  function paint() {
    const canvas = root.querySelector("canvas"),
      frame =
        records[selected]?.frames[
          Number(root.querySelector("[data-lab-phase]").value)
        ];
    if (!frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(frame.width, frame.height);
    frame.values.forEach((v, i) => {
      const b = Math.round(v * 255);
      image.data.set([b, b, b, 255], i * 4);
    });
    ctx.putImageData(image, 0, 0);
  }
  async function refreshSaved() {
    saved = (await store.list())
      .filter((r) => r.simulation?.instrumentLab)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async function action(a) {
    if (busy) return;
    if (a === "close") {
      closeWorkspace(root);
      return;
    }
    const record = records[selected],
      restoreId = root.querySelector("[data-lab-saved]")?.value;
    try {
      if (a === "bench") {
        if (!getProject) onBench?.(structuredClone(project));
        closeWorkspace(root);
        return;
      }
      if (a === "apply-record") {
        if (!record) throw Error("Choose an acquisition first.");
        onBench?.(structuredClone(record.project));
        project = validateProject(record.project);
        detectorId = record.simulation.camera.id;
        onDetector?.(detectorId);
        syncBench();
        repeat = null;
        message =
          "Recorded layout applied to the bench. Undo is available on the optical bench.";
      }
      if (a === "measure") {
        await onMeasure?.(record);
        return;
      }
      if (a === "acquire" || a === "repeat") {
        if (
          [...root.querySelectorAll('input[type="number"]')].some(
            (el) => !el.checkValidity(),
          )
        )
          throw Error("Enter valid instrument settings before acquisition.");
        if (records.length + (a === "repeat" ? 3 : 1) > 20)
          throw Error(
            "This session holds 20 acquisitions. Save or export them, then reopen the app to start a new session.",
          );
        syncBench();
        busy = true;
        message = "Acquiring camera frames…";
        repeat = null;
        render();
        const batch = [],
          snapshot = structuredClone(project),
          capturedDetector = detectorId;
        for (let i = 0; i < (a === "repeat" ? 3 : 1); i++) {
          const random = new Uint32Array(1);
          crypto.getRandomValues(random);
          let seed = random[0] % 2147483644;
          const used = new Set(records.flatMap((r) => r.simulation.phaseSeeds));
          while (
            [seed, seed + 1, seed + 2, seed + 3].some((s) => used.has(s))
          ) {
            crypto.getRandomValues(random);
            seed = random[0] % 2147483644;
          }
          const r = await run(snapshot, {
            seed,
            n: 256,
            detectorId: capturedDetector,
          });
          records.push(r);
          batch.push(r);
          selected = records.length - 1;
        }
        message = `Captured ${batch.length} acquisition${batch.length > 1 ? "s" : ""}. Save to retain frames and instrument settings.`;
        if (a === "repeat") {
          try {
            repeat = analyzeRepeats(batch, { verified: true });
          } catch (e) {
            message += " Repeat analysis unavailable: " + e.message;
          }
        }
      }
      if (a === "save") {
        for (const r of records) await store.save(r);
        await refreshSaved();
        message =
          "Acquisitions saved locally with their camera settings, bench snapshots and noise seeds.";
      }
      if (a === "restore") {
        const r = saved.find((r) => r.id === restoreId);
        if (!r) throw Error("Choose a saved instrument acquisition.");
        const p = validateProject(r.project),
          restored = structuredClone(r);
        try {
          restored.result = analyzeMeasurement(
            restored.frames,
            restored.settings,
          );
        } catch (e) {
          restored.result = null;
          restored.simulation.analysisError = e.message;
        }
        if (!getProject) project = p;
        const existing = records.findIndex((x) => x.id === restored.id);
        if (existing >= 0) {
          records[existing] = restored;
          selected = existing;
        } else {
          records.push(restored);
          selected = records.length - 1;
        }
        repeat = null;
        truth = false;
        message =
          "Opened recorded frames and settings. Live controls still describe the active bench; apply the recorded layout explicitly to repeat that setup.";
      }
      if (a === "export")
        download(
          "optibench-instrument-run.json",
          JSON.stringify(serializable(record)),
          "application/json",
        );
      if (a === "report") {
        const s = record.result?.stats;
        download(
          "optibench-instrument-report.html",
          `<!doctype html><html lang="en"><meta charset="utf-8"><title>Michelson camera measurement</title><style>body{font:16px system-ui;max-width:900px;margin:40px auto;padding:20px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Michelson camera measurement</h1><p>Simulated acquisition ${esc(record.acquiredAt)}</p><p>Visibility ${fmt(s?.meanVisibility * 100)}%; valid area ${fmt(s?.validFraction * 100)}%; relative OPD RMS ${fmt(s?.rmsNm)} nm; PV ${fmt(s?.pvNm)} nm. Fitted piston and tilt removed.</p><p>Clipped pixels (maximum across frames): ${fmt(Math.max(...record.simulation.saturated) * 100)}%.</p><h2>Diagnostics</h2><p>${esc(record.simulation.analysisError || record.result?.warnings.join("; ") || "No reconstruction warnings.")}</p><h2>Instrument settings</h2><pre>${esc(JSON.stringify(record.simulation.camera, null, 2))}</pre><h2>Model & acquisition</h2><p>${esc(record.notes)}</p><p>${esc(record.simulation.readout)}</p><p>Noise seeds: ${esc(record.simulation.phaseSeeds.join(", "))}. ROI: ${record.settings.n}², ${record.settings.pixelUm} µm/pixel.</p>${truth ? `<h2>Optional simulator truth — not measured</h2><pre>${esc(JSON.stringify(record.simulation.truth, null, 2))}</pre>` : ""}<p>Export the run JSON for source frames and the full bench snapshot.</p></html>`,
          "text/html",
        );
      }
    } catch (e) {
      message = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  return {
    async open() {
      if (busy) return;
      syncBench();
      repeat = null;
      if (!root) {
        root = document.createElement("section");
        root.id = "instrument-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const a = e.target.closest("[data-lab]")?.dataset.lab;
          if (a) void action(a);
        };
        root.onchange = (e) => {
          if (busy) return;
          if (e.target.matches("[data-lab-camera]")) {
            detectorId = e.target.value ? Number(e.target.value) : null;
            onDetector?.(detectorId);
            repeat = null;
            render();
            return;
          }
          if (e.target.matches("[data-lab-phase]")) {
            paint();
            return;
          }
          if (e.target.matches("[data-lab-select]")) {
            selected = Number(e.target.value);
            render();
            return;
          }
          if (e.target.matches("[data-lab-truth]")) {
            truth = e.target.checked;
            render();
            return;
          }
          if (e.target.dataset.instrumentField) {
            if (!e.target.checkValidity()) {
              message = "Setting is outside its allowed range.";
              return;
            }
            syncBench();
            project.items.find(
              (c) => c.id === Number(e.target.dataset.component),
            )[e.target.dataset.instrumentField] = Number(e.target.value);
            onBench?.(structuredClone(project));
            onDetector?.(detectorId);
            syncBench();
            repeat = null;
            message = "Settings updated. Acquire again to measure the effect.";
            render();
          }
        };
      }
      showWorkspace(root);
      render();
      try {
        await refreshSaved();
      } catch (e) {
        message = e.message;
      }
      render();
    },
  };
}
