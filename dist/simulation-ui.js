import { simulateRuns } from "./simulation-runs.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const download = (name, body, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([body], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function createSimulationWorkspace({
  getProject,
  getDetector,
  onImport,
}) {
  let root,
    study = null,
    busy = false,
    message = "",
    config = {
      parameter: "piston",
      start: 0,
      end: 633,
      count: 7,
      seed: 42,
      mirrorId: null,
      detectorId: null,
    };
  function render() {
    const p = getProject();
    root.innerHTML = `<header class="measurement-header"><button data-sim="close">← Optical bench</button><h1>Controlled simulation runs</h1><button data-sim="run" ${busy ? "disabled" : ""}>${busy ? "Simulating…" : "Run sweep"}</button><button data-sim="export" ${study && !busy ? "" : "disabled"}>Export complete study</button><button data-sim="measure" ${study?.rows.some((r) => r.run) && !busy ? "" : "disabled"}>Save acquisitions & measure</button></header><main class="validation-main"><p>Change one parameter across a frozen copy of your current bench. Every acquisition retains its modified layout, normalization, seeds and analysis settings.</p><div class="measurement-two"><label>Parameter<select data-config="parameter">${[
      ["piston", "Mirror piston · nm (absolute)"],
      ["angle", "Mirror angle offset · degrees"],
      ["exposure", "Relative exposure multiplier"],
      ["noise", "Gaussian intensity noise · σ"],
    ]
      .map(
        ([v, t]) =>
          `<option value="${v}" ${config.parameter === v ? "selected" : ""}>${t}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Mirror<select data-config="mirrorId">${p.items
      .filter((c) => c.type === "mirror")
      .map(
        (c) =>
          `<option value="${c.id}" ${config.mirrorId === c.id ? "selected" : ""}>${esc(c.label || c.name)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Detector<select data-config="detectorId">${p.items
      .filter((c) => ["camera", "screen", "power"].includes(c.type))
      .map(
        (c) =>
          `<option value="${c.id}" ${config.detectorId === c.id ? "selected" : ""}>${esc(c.label || c.name)}</option>`,
      )
      .join(
        "",
      )}</select></label>${["start", "end", "count", "seed"].map((key) => `<label>${key}<input data-config="${key}" type="number" step="any" value="${config[key]}"></label>`).join("")}</div><p role="status">${esc(message)}</p><p>128² sample grid. Exposure and noise use an illustrative normalized-intensity readout, not the camera hardware model. Shared seeds isolate parameter effects; these runs are not independent repeats.</p>${study ? `<h2>${esc(study.config.parameter)} comparison</h2>${plot()}<div class="measurement-table-scroll"><table><thead><tr><th>Value</th><th>Status</th><th>Center intensity · frame 0</th><th>Visibility</th><th>PV / RMS · nm</th><th>Error RMS · nm</th><th>Valid area</th></tr></thead><tbody>${study.rows.map((r) => `<tr><td>${fmt(r.value)}</td><td>${esc(r.error || r.status)}</td><td>${fmt(r.intensity)}</td><td>${fmt(r.visibility)}</td><td>${fmt(r.pvNm)} / ${fmt(r.rmsNm)}</td><td>${fmt(r.errorRMSNm)}</td><td>${fmt(r.validFraction == null ? null : r.validFraction * 100)}%</td></tr>${r.warnings?.length ? `<tr><td colspan="7">${r.warnings.map(esc).join(" · ")}</td></tr>` : ""}`).join("")}</tbody></table></div>${study.notes.map((n) => `<p>${esc(n)}</p>`).join("")}` : ""}</main>`;
    root.onchange = (e) => {
      const key = e.target.dataset.config;
      if (!key || busy) return;
      config[key] =
        key === "parameter" ? e.target.value : Number(e.target.value);
      if (key === "parameter") {
        const defaults = {
          piston: [0, 633],
          angle: [-0.02, 0.02],
          exposure: [0.25, 2],
          noise: [0, 0.02],
        }[config.parameter];
        [config.start, config.end] = defaults;
      }
      study = null;
      render();
    };
    root.onclick = async (e) => {
      const b = e.target.closest("[data-sim]");
      if (!b) return;
      const a = b.dataset.sim;
      if (a === "close") {
        root.hidden = true;
        document.querySelector("#app").inert = false;
        return;
      }
      if (busy) return;
      try {
        if (a === "run") {
          busy = true;
          study = null;
          message = "Tracing the frozen bench and reconstructing phase frames…";
          render();
          const project = structuredClone(getProject());
          if (typeof Worker === "undefined")
            study = simulateRuns(project, config);
          else {
            const w = new Worker(
              new URL("./simulation-worker.js", import.meta.url),
              { type: "module" },
            );
            try {
              study = await new Promise((resolve, reject) => {
                w.onmessage = ({ data }) =>
                  data.error ? reject(Error(data.error)) : resolve(data.result);
                w.onerror = () => reject(Error("Simulation worker failed."));
                w.postMessage({ project, config });
              });
            } finally {
              w.terminate();
            }
          }
          message = `${study.rows.filter((r) => r.run).length}/${study.rows.length} acquisitions reconstructed. Failed cases remain in the report.`;
        } else if (a === "export")
          download("optibench-simulation-study.json", JSON.stringify(study));
        else if (a === "measure") {
          await onImport(study.rows.filter((r) => r.run).map((r) => r.run));
          root.hidden = true;
        }
      } catch (e) {
        message = e.message;
      } finally {
        busy = false;
        render();
      }
    };
  }
  function plot() {
    const good = study.rows.filter((r) => Number.isFinite(r.intensity));
    if (!good.length) return "";
    let d = "",
      connected = false;
    study.rows.forEach((r, i) => {
      if (!Number.isFinite(r.intensity)) {
        connected = false;
        return;
      }
      d +=
        (connected ? " L" : " M") +
        (40 + (i / (study.rows.length - 1)) * 640) +
        "," +
        (175 - r.intensity * 150);
      connected = true;
    });
    return `<svg viewBox="0 0 730 210" style="width:100%;max-width:900px;background:#111d29" role="img" aria-label="First-frame center intensity across sweep points"><path d="M40 20V175H690" fill="none" stroke="#789"/><path d="${d}" fill="none" stroke="#bdf18b" stroke-width="2"/><text x="40" y="198" fill="#dce7ee">${fmt(study.rows[0].value)} → ${fmt(study.rows.at(-1).value)} · first-frame center intensity (0–1)</text></svg>`;
  }
  return {
    open() {
      const p = getProject();
      if (study) {
        study = null;
        message =
          "Bench refreshed. Run a new sweep; previously saved acquisitions remain in Measure.";
      }
      config.detectorId =
        getDetector() ||
        p.items.find((c) => ["camera", "screen", "power"].includes(c.type))?.id;
      config.mirrorId = p.items.find((c) => c.type === "mirror")?.id;
      if (!root) {
        root = document.createElement("section");
        root.id = "simulation-workspace";
        document.body.appendChild(root);
      }
      root.hidden = false;
      document.querySelector("#app").inert = true;
      render();
    },
  };
}
