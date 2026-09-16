import { makeProject } from "./project.js";
import {
  coherentBenchExample,
  acquireCoherentCamera,
} from "./coherent-bench.js";
import { runbookStore } from "./runbook.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import { escapeRay as esc, rayNumber as fmt } from "./nonsequential-view.js";
function download(name, value) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function createCoherentBenchWorkspace({
  getProject,
  onMeasure,
  store = runbookStore,
  execute,
} = {}) {
  let root,
    project = null,
    settings = { n: 128, width: 8, detectorId: null },
    acquisition = { mirrorId: null, seed: 42 },
    run = null,
    phase = null,
    history = [],
    job = null,
    message = "Capture the bench or choose a numerical-field example.",
    selected = null,
    dirty = false;
  const enabled = () => project.items.filter((c) => c.enabled !== false);
  function render() {
    if (!root || !project) return;
    const busy = !!job,
      detectors = enabled().filter((c) =>
        ["camera", "screen", "power"].includes(c.type),
      ),
      mirrors = enabled().filter((c) => c.type === "mirror");
    if (!detectors.some((c) => c.id === settings.detectorId))
      settings.detectorId = detectors[0]?.id;
    if (!mirrors.some((c) => c.id === acquisition.mirrorId))
      acquisition.mirrorId = mirrors[0]?.id;
    if (!enabled().some((c) => c.id === selected))
      selected = enabled().find((c) => c.type === "mirror")?.id;
    const optic = enabled().find((c) => c.id === selected),
      keys = optic
        ? {
            mirror: ["angle", "pistonNm", "reflectivity"],
            lens: ["f", "aperture", "transmission"],
            aperture: ["aperture"],
            slit: ["aperture"],
            source: [
              "power",
              "waist",
              "polarization",
              "ellipticity",
              "coherenceLength",
            ],
            polarizer: ["axis", "leakage", "transmission"],
            waveplate: ["axis", "retardance", "transmission"],
            camera: ["exposure", "gain"],
            filter: ["transmission"],
            splitter: ["reflectivity", "transmission"],
          }[optic.type] || []
        : [];
    root.innerHTML = `<header class="measurement-header"><button data-coherent="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Coherent bench</h1><span>Coplanar numerical fields</span></header><main class="instrument-main"><p role="status">${esc(message)}</p><div class="measurement-buttons"><button data-coherent="capture" ${busy ? "disabled" : ""}>Capture current bench</button><button data-coherent="michelson" ${busy ? "disabled" : ""}>Michelson</button><button data-coherent="mach-zehnder" ${busy ? "disabled" : ""}>Mach–Zehnder</button><button data-coherent="diffraction" ${busy ? "disabled" : ""}>Lens + iris interferometer</button></div><div class="ray-layout"><section class="instrument-controls"><h2>${esc(project.title)}</h2><p>Edits here affect this captured experiment only. Capture again to use changes made on the main bench.</p><fieldset ${busy ? "disabled" : ""}><legend>Propagation</legend><label>Detector<select data-coherent-setting="detectorId">${detectors.map((c) => `<option value="${c.id}" ${settings.detectorId === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label><label>Field grid<select data-coherent-setting="n">${[128, 256].map((n) => `<option ${settings.n === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Field width · mm<input data-coherent-setting="width" type="number" step="any" value="${settings.width}"></label><button data-coherent="propagate">Propagate coherent fields</button><label>Captured component<select data-coherent-optic>${enabled()
      .filter((c) => c.type !== "mechanical")
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === selected ? "selected" : ""}>${esc(c.label)}</option>`,
      )
      .join(
        "",
      )}</select></label>${keys.map((k) => `<label>${esc({ pistonNm: "Optical piston · nm", f: "Focal length · mm", aperture: "Clear aperture · mm", angle: "Normal angle · degrees", axis: "Polarization axis · degrees", retardance: "Retardance · degrees", waist: "Waist · mm", power: "Power · mW", coherenceLength: "Coherence length · mm", exposure: "Exposure · ms", polarization: "Polarization angle · degrees", ellipticity: "Ellipticity · degrees" }[k] || k)}<input data-coherent-param="${k}" type="number" step="any" value="${optic[k] ?? 0}"></label>`).join("")}</fieldset><fieldset ${busy ? "disabled" : ""}><legend>Camera acquisition</legend><label>Reference mirror<select data-coherent-acquisition="mirrorId">${mirrors.map((c) => `<option value="${c.id}" ${acquisition.mirrorId === c.id ? "selected" : ""}>${esc(c.label)}</option>`).join("")}</select></label><label>Noise seed<input data-coherent-acquisition="seed" type="number" value="${acquisition.seed}"></label><button data-coherent="camera" ${!run ? "disabled" : ""}>Acquire from recorded field</button><button data-coherent="phase">Acquire 4 piston steps</button><p>Four-step reconstruction requires two paths and one reference mirror encountered once in exactly one arm. Camera acquisition uses recorded settings; edits require propagation again.</p></fieldset>${busy ? '<button data-coherent="cancel">Cancel</button>' : ""}<details><summary>Supported physics and limits</summary><p>One TEM00 source, up to 16 paths, coplanar folds, centered normally incident thin lenses, apertures, slits and spatially uniform Jones polarization. Angular-spectrum propagation includes diffraction; reflected fields reverse their horizontal coordinate and transport the transverse polarization basis.</p><p>Ideal mirrors and reciprocal splitters use fixed phase conventions. No thick-glass surfaces, catalog coatings, non-coplanar geometry, resonant cavities, or new paths discovered from diffracted tails. Branch sums are not renormalized to an incoherent detector total. Numerical window and sampling checks are essential.</p><p>Coherence uses a Gaussian envelope in path-length difference. Camera models are assumptions, not hardware calibration. Phase reconstruction removes piston/tilt and needs an independently established physical sign convention.</p></details><h3>Saved coherent runs</h3><select data-coherent-history ${busy ? "disabled" : ""}><option value="">Choose run</option>${history
      .filter((r) => r.format === "optibench-coherent-run")
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.project.title)} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select><button data-coherent="open" ${busy ? "disabled" : ""}>Open run</button></section><section class="instrument-results">${run ? `<h2>Recorded field</h2><p>${dirty ? "Inputs changed. Results refer to the previous recorded experiment." : "Recorded propagation matches the captured inputs."}</p><div class="ray-ledger"><div><span>Coherent collected power · mW</span><strong>${fmt(run.power)}</strong></div><div><span>Incoherent baseline · mW</span><strong>${fmt(run.baselinePower)}</strong></div><div><span>Paths / optical sample · µm</span><strong>${run.paths.length} / ${fmt(run.dx * 1000)}</strong></div></div><div class="imaging-plots"><figure><figcaption>Simulated field intensity · relative display, no detector renormalization</figcaption><canvas data-coherent-map="field" width="${run.n}" height="${run.n}"></canvas></figure>${run.camera ? `<figure><figcaption>Camera ADC · fixed scale · ${(run.camera.saturated * 100).toFixed(2)}% full-well clipped</figcaption><canvas data-coherent-map="camera" width="${run.n}" height="${run.n}"></canvas><p>${esc(run.camera.note)}</p></figure>` : ""}</div><div class="runbook-table"><table><tr><th>Path</th><th>Optical length · mm</th><th>Field power before detector · mW</th></tr>${run.paths.map((p, i) => `<tr><td>${i + 1}: ${p.steps.map((s) => `${esc(run.project.items.find((c) => c.id === s.id)?.label || s.id)} [${s.event}]`).join(" → ")}</td><td>${fmt(p.opl)}</td><td>${fmt(p.power)}</td></tr>`).join("")}</table></div><p>Per-path powers do not include cross terms. This is a selected-detector result, not a whole-bench energy audit.</p>${run.warnings.map((w) => `<p class="runbook-inconclusive">${esc(w)}</p>`).join("")}<button data-coherent="save" ${busy ? "disabled" : ""}>Save recorded run</button><button data-coherent="export" ${busy ? "disabled" : ""}>Export field audit JSON</button>` : "<h2>Numerical interference</h2><p>Propagate a captured bench to see fields recombine at the selected detector. The lens + iris example demonstrates diffraction inside an interferometer arm.</p>"}${phase ? `<h2>Recorded four-step acquisition</h2><p>${esc(phase.name)} · reference mirror ${esc(phase.project.items.find((c) => c.id === phase.simulation.mirrorId)?.label)} · step ${fmt(phase.simulation.stepNm)} nm optical piston. Acquisition belongs to its saved snapshot.</p>${phase.result ? `<div class="ray-ledger"><div><span>Measured relative OPD RMS · nm</span><strong>${fmt(phase.result.stats.rmsNm)}</strong></div><div><span>Measured visibility / valid area</span><strong>${fmt(phase.result.stats.meanVisibility * 100)}% / ${fmt(phase.result.stats.validFraction * 100)}%</strong></div></div>${phase.result.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}` : `<p>${esc(phase.simulation.analysisError)}</p>`}<p>Full-well clipped fractions: ${phase.simulation.saturated.map((v) => (v * 100).toFixed(2) + "%").join(" / ")}.</p>${phase.simulation.warnings.map((w) => `<p>${esc(w)}</p>`).join("")}<button data-coherent="measure" ${busy ? "disabled" : ""}>Open in Measure</button><button data-coherent="export-phase" ${busy ? "disabled" : ""}>Export measurement JSON</button>` : ""}</section></div></main>`;
    if (run) {
      paint("field", run.values, run.n, false);
      if (run.camera) paint("camera", run.camera.values, run.n, true);
    }
  }
  function paint(name, values, n, fixed) {
    const ctx = root
      .querySelector(`[data-coherent-map="${name}"]`)
      ?.getContext("2d");
    if (!ctx) return;
    const data = ctx.createImageData(n, n),
      max = fixed ? 1 : values.reduce((a, v) => Math.max(a, v), 0) || 1;
    for (let i = 0; i < values.length; i++) {
      const v = Math.max(0, Math.min(1, values[i] / max));
      data.data[i * 4] = 185 * v;
      data.data[i * 4 + 1] = 235 * v;
      data.data[i * 4 + 2] = 125 * v;
      data.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  }
  function cancel() {
    if (!job) return;
    const t = job;
    job = null;
    t.worker?.terminate();
    t.resolve?.(null);
    clearTimeout(t.timer);
    message = "Cancelled. Previous completed results are retained.";
    render();
  }
  async function calculate(mode) {
    const token = {};
    job = token;
    message =
      mode === "phase"
        ? "Acquiring four numerical-field camera frames…"
        : "Propagating coherent paths…";
    render();
    token.timer = setTimeout(cancel, 120000);
    try {
      const data = {
          mode,
          project: structuredClone(project),
          settings: { ...settings },
          acquisition: { ...acquisition },
        },
        out = execute
          ? await execute(data)
          : await new Promise((resolve, reject) => {
              token.resolve = resolve;
              const w = new Worker(
                new URL("./coherent-bench-worker.js", import.meta.url),
                { type: "module" },
              );
              token.worker = w;
              w.onmessage = ({ data }) => {
                if (job !== token) return;
                if (data.progress) {
                  root.querySelector("[role=status]").textContent =
                    `Completed ${data.progress.completed} of ${data.progress.total}.`;
                  return;
                }
                data.error ? reject(Error(data.error)) : resolve(data.result);
              };
              w.onerror = (e) => reject(Error(e.message));
              w.postMessage(data);
            });
      if (job !== token) return;
      if (mode === "phase") phase = out;
      else {
        run = out;
        dirty = false;
      }
      message =
        "Calculation completed. Review sampling and clipping diagnostics.";
    } catch (e) {
      if (job === token) message = e.message;
    } finally {
      clearTimeout(token.timer);
      token.worker?.terminate();
      if (job === token) {
        job = null;
        render();
      }
    }
  }
  async function action(a) {
    if (a === "cancel") {
      cancel();
      return;
    }
    if (job) return;
    try {
      if (a === "close") {
        closeWorkspace(root);
        return;
      }
      if (a === "capture") {
        project = structuredClone(getProject());
        dirty = true;
        message =
          "Current bench captured. Previous results retain their original snapshots.";
      }
      if (["michelson", "mach-zehnder", "diffraction"].includes(a)) {
        project = a === "diffraction" ? coherentBenchExample() : makeProject(a);
        dirty = true;
        message = "Example loaded in this workspace. Main bench is unchanged.";
      }
      if (a === "propagate" || a === "phase") {
        await calculate(a === "phase" ? "phase" : "field");
        return;
      }
      if (a === "camera") {
        run.camera = acquireCoherentCamera(run, acquisition);
        message =
          "Camera acquired from the recorded field and camera settings.";
      }
      if (a === "save") {
        const saved = structuredClone(run);
        saved.id = crypto.randomUUID();
        await store.save(saved);
        history = await store.list();
        message = "Recorded coherent run saved locally.";
      }
      if (a === "open") {
        const saved = history.find(
          (r) => r.id === root.querySelector("[data-coherent-history]").value,
        );
        if (!saved) throw Error("Choose a saved run.");
        run = structuredClone(saved);
        project = structuredClone(run.project);
        settings = { ...run.settings };
        dirty = false;
        message = "Recorded coherent run restored.";
      }
      if (a === "export") download("optibench-coherent-field.json", run);
      if (a === "export-phase")
        download("optibench-coherent-measurement.json", phase);
      if (a === "measure") {
        await onMeasure?.(phase);
        return;
      }
      render();
    } catch (e) {
      message = e.message;
      render();
    }
  }
  function ensure() {
    if (root) return;
    root = document.createElement("section");
    root.id = "coherent-bench-workspace";
    root.hidden = true;
    document.body.append(root);
    root.addEventListener("click", (e) => {
      const t = e.target.closest("[data-coherent]");
      if (t) void action(t.dataset.coherent);
    });
    root.addEventListener("change", (e) => {
      if (job) return;
      const t = e.target;
      if (t.matches("[data-coherent-setting]")) {
        settings[t.dataset.coherentSetting] = Number(t.value);
        dirty = true;
      }
      if (t.matches("[data-coherent-acquisition]"))
        acquisition[t.dataset.coherentAcquisition] = Number(t.value);
      if (t.matches("[data-coherent-optic]")) selected = Number(t.value);
      if (t.matches("[data-coherent-param]")) {
        project.items.find((c) => c.id === selected)[t.dataset.coherentParam] =
          Number(t.value);
        dirty = true;
      }
      render();
    });
  }
  return {
    async open() {
      ensure();
      project ??= structuredClone(getProject());
      history = await store.list();
      showWorkspace(root);
      render();
    },
    cancel,
  };
}
