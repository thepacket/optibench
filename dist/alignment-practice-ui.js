import {
  practiceSetup,
  evaluatePractice,
  practiceHint,
  practiceBundle,
} from "./alignment-practice.js";
import { TaskWorker } from "./task-worker.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import { importProjectRecords } from "./run-store.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const download = (name, data, type) => {
  const u = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = u;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
};
export function practiceComparison(start, current) {
  return `<table><thead><tr><th>Metric</th><th>Starting</th><th>Current</th><th>Practice target</th></tr></thead><tbody>${[
    ["visibility", "Visibility", "≥ 0.5"],
    ["validFraction", "Usable area fraction", "≥ 0.75"],
    ["separationMm", "Beam center separation · mm", "≤ 0.5"],
  ]
    .map(
      ([k, l, t]) =>
        `<tr><th>${l}</th><td>${fmt(start?.[k])}</td><td>${fmt(current?.[k])}</td><td>${t}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}
export function createPracticeWorkspace({
  onBench,
  save = importProjectRecords,
} = {}) {
  let root,
    setup = practiceSetup(),
    offsets = [...setup.initial],
    start,
    current,
    previous,
    history = [],
    busy = false,
    message = "",
    saved = false;
  async function compute() {
    if (typeof Worker === "undefined") return evaluatePractice(setup, offsets);
    const w = new TaskWorker(
      new URL("./alignment-practice-worker.js", import.meta.url),
      { type: "module" },
    );
    try {
      return await new Promise((resolve, reject) => {
        w.onmessage = ({ data }) =>
          data.error ? reject(Error(data.error)) : resolve(data.result);
        w.onerror = () =>
          reject(Error("Computation failed. Retry the adjustment."));
        w.postMessage({ setup, offsets });
      });
    } finally {
      w.terminate();
    }
  }
  async function update() {
    busy = true;
    saved = false;
    message = "Computing detector response…";
    render();
    try {
      const result = await compute();
      previous = current;
      current = result;
      if (!start) start = result;
      message = practiceHint(current, previous);
    } catch (e) {
      current = null;
      message = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  function render() {
    root.innerHTML = `<header class="measurement-header"><button data-practice="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Alignment practice · Michelson</h1><span>Simulation</span></header><main class="validation-main"><p>Adjust mirror yaw to recover overlapping return beams. Each change recomputes the detector and four-phase reconstruction. The practice bench is separate from your current project.</p><div class="practice-grid"><section><h2>Mirror adjustments</h2><fieldset ${busy ? "disabled" : ""}>${setup.controls.map((c, i) => `<label>${esc(setup.base.items.find((x) => x.id === c.id).label)} · yaw offset (°)<input data-offset="${i}" type="number" min="-0.1" max="0.1" step="0.005" value="${offsets[i]}"></label><button data-practice="nudge" data-index="${i}" data-sign="-1">− Step</button><button data-practice="nudge" data-index="${i}" data-sign="1">+ Step</button>`).join("")}<label>Step · degrees<select id="practice-step"><option value="0.005">0.005</option><option value="0.001">0.001</option><option value="0.0001">0.0001</option></select></label><button data-practice="undo" ${history.length ? "" : "disabled"}>Undo adjustment</button><button data-practice="retry">Recompute</button><button data-practice="restart">Restart challenge</button></fieldset><p>Offsets are relative to the prepared bench, limited to ±0.1°. Yaw is a plan-view rotation; elevation is fixed.</p></section><figure><canvas width="128" height="128" aria-label="Current simulated detector fringes"></canvas><figcaption>${current?.status === "complete" ? "Current first phase frame · normalized intensity 0–1" : "Detector response unavailable"}</figcaption></figure></div><p role="status">${esc(message)}</p><h2>${current?.aligned ? "Practice targets met" : "Starting / current comparison"}</h2>${practiceComparison(start, current)}<p>Center separation indicates beam overlap geometrically; it is not an overlap integral. Visibility is averaged over retained pixels. A higher contrast alone does not guarantee more usable area. Readout is normalized per layout, so brightness across adjustments is not an absolute power comparison.</p><div class="guided-actions"><button data-practice="bench" ${!current || busy ? "disabled" : ""}>Load current practice bench</button><button data-practice="save" ${current?.status !== "complete" || !start || busy || saved ? "disabled" : ""}>${saved ? "Saved to Projects" : "Save comparison project"}</button><button data-practice="json" ${current?.status !== "complete" || !start || busy ? "disabled" : ""}>Export project backup</button><button data-practice="html" ${current?.status !== "complete" || !start || busy ? "disabled" : ""}>Export comparison report</button></div><p>Loading the practice bench is undoable. Saved comparisons retain both layouts and their synthetic acquisitions; targets do not constitute physical validation.</p></main>`;
    const canvas = root.querySelector("canvas"),
      frame = current?.source?.study.rows[0].run?.frames[0];
    if (frame) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const image = ctx.createImageData(128, 128);
        frame.values.forEach((v, i) => {
          const b = Math.round(Math.max(0, Math.min(1, v)) * 255);
          image.data.set([b, b, b, 255], i * 4);
        });
        ctx.putImageData(image, 0, 0);
      }
    }
  }
  let stepSize = "0.005";
  function restoreStep() {
    root.querySelector("#practice-step").value = stepSize;
  }
  const api = {
    async open() {
      if (!root) {
        root = document.createElement("section");
        root.id = "practice-workspace";
        document.body.append(root);
        root.onchange = async (e) => {
          if (busy) return;
          if (e.target.id === "practice-step") {
            stepSize = e.target.value;
            return;
          }
          if (e.target.dataset.offset !== undefined) {
            const value = e.target.value === "" ? NaN : Number(e.target.value);
            if (!Number.isFinite(value) || Math.abs(value) > 0.1) {
              message = "Enter a finite offset between −0.1° and +0.1°.";
              render();
              restoreStep();
              return;
            }
            history.push([...offsets]);
            offsets[Number(e.target.dataset.offset)] = value;
            await update();
            restoreStep();
          }
        };
        root.onclick = async (e) => {
          const b = e.target.closest("[data-practice]"),
            a = b?.dataset.practice;
          if (!a || busy) return;
          if (a === "close") {
            closeWorkspace(root);
            return;
          }
          if (a === "bench") {
            onBench?.(structuredClone(current.project));
            closeWorkspace(root);
            return;
          }
          if (["nudge", "undo", "restart", "retry"].includes(a)) {
            if (a === "undo") offsets = history.pop();
            if (a === "restart") {
              history.push([...offsets]);
              offsets = [...setup.initial];
            }
            if (a === "nudge") {
              history.push([...offsets]);
              const i = Number(b.dataset.index);
              offsets[i] = Math.max(
                -0.1,
                Math.min(
                  0.1,
                  Number(
                    (
                      offsets[i] +
                      Number(b.dataset.sign) * Number(stepSize)
                    ).toFixed(6),
                  ),
                ),
              );
            }
            await update();
            restoreStep();
            return;
          }
          try {
            const bundle = practiceBundle(start, current);
            if (a === "save") {
              busy = true;
              render();
              await save([...bundle.records, bundle]);
              saved = true;
              message =
                "Comparison saved in Projects with starting and adjusted evidence.";
            }
            if (a === "json")
              download(
                "optibench-alignment-practice.json",
                JSON.stringify(bundle),
                "application/json",
              );
            if (a === "html")
              download(
                "optibench-alignment-practice.html",
                `<!doctype html><html lang="en"><meta charset="utf-8"><title>Alignment practice comparison</title><style>body{font:16px system-ui;max-width:1000px;margin:30px auto;padding:20px}td,th{padding:12px;border:1px solid #aaa}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Michelson alignment practice</h1><p>Synthetic evidence. Targets met: ${current.aligned}. Beam center separation is a geometric proxy, not an overlap integral. Export the project backup for raw acquisitions.</p>${practiceComparison(start, current)}<h2>Layouts and settings</h2><pre>${esc(JSON.stringify({ starting: start.project, current: current.project, startingSource: start.source.id, currentSource: current.source.id, settings: current.source.study.config }, null, 2))}</pre></html>`,
                "text/html",
              );
          } catch (e) {
            message = e.message;
          } finally {
            busy = false;
            render();
            restoreStep();
          }
        };
      }
      showWorkspace(root);
      render();
      restoreStep();
      if (!start) await update();
    },
  };
  return api;
}
