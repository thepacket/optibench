import {
  guidedSetup,
  guidedSweep,
  guidedAssessment,
  guidedBundle,
} from "./guided-experiment.js";
import { acceptanceHTML } from "./acceptance-ui.js";
import { importProjectRecords } from "./run-store.js";
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
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function createGuidedWorkspace({
  onBench,
  onMeasure,
  save = importProjectRecords,
} = {}) {
  let root,
    setup = guidedSetup(),
    preview,
    source,
    assessment,
    bundle,
    step = 0,
    busy = false,
    saved = false,
    message = "";
  const labels = [
    "Inspect fringes",
    "Sweep displacement",
    "Reconstruct",
    "Evaluate",
    "Save & export",
  ];
  async function run(operation) {
    if (typeof Worker === "undefined")
      return operation === "assess"
        ? guidedAssessment(source)
        : guidedSweep(setup, operation === "preview");
    const worker = new TaskWorker(
      new URL("./guided-worker.js", import.meta.url),
      { type: "module" },
    );
    try {
      return await new Promise((resolve, reject) => {
        worker.onmessage = ({ data }) =>
          data.error ? reject(Error(data.error)) : resolve(data.result);
        worker.onerror = () =>
          reject(Error("Experiment computation failed. Retry this step."));
        worker.postMessage({ operation, setup, source });
      });
    } finally {
      worker.terminate();
    }
  }
  function render() {
    const rows = source?.study.rows || preview?.study.rows || [],
      selected = rows[Number(root?.querySelector("[data-frame]")?.value) || 0];
    root.innerHTML = `<header class="measurement-header"><button data-guide="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>First experiment · Michelson</h1><span>Simulated equipment</span></header><main class="validation-main"><ol class="guided-steps">${labels.map((l, i) => `<li ${i === step ? 'aria-current="step"' : ""}>${i + 1}. ${l}</li>`).join("")}</ol><h2>${labels[step]}</h2><p role="status">${esc(message)}</p>
      ${step === 0 ? `<p>A prepared Michelson bench splits one coherent source into two returning arms. Inspect the synthetic detector frame before changing optical piston.</p><button data-guide="bench" ${busy ? "disabled" : ""}>Load prepared optical bench</button><p>Loading is undoable. This experiment uses its own fixed preset; edits on the main bench do not change these guided results.</p><button data-guide="preview" ${busy ? "disabled" : ""}>${preview ? "Recompute" : "Generate"} detector preview</button>` : ""}
      ${step === 1 ? `<p>Sweep the mirror’s optical piston from 0 to ${fmt(setup.config.end)} nm in 9 points, with a fixed seed of 42. This covers one expected intensity cycle in this model. Optical piston changes phase without moving the mount.</p><button data-guide="sweep" ${busy ? "disabled" : ""}>Run displacement sweep</button>` : ""}
      ${step <= 2 && rows.length ? `<div class="guided-readout"><figure><canvas width="128" height="128" aria-label="Simulated first phase detector frame"></canvas><figcaption>First phase frame · normalized intensity, black 0 to white 1</figcaption><label>Inspect sweep point<select data-frame>${rows.map((r, i) => `<option value="${i}">${fmt(r.value)} nm · ${esc(r.status)}</option>`).join("")}</select></label></figure><div><h3>What to look for</h3><p>The center intensity should vary with piston and return near its starting value at the final point. Spatial fringe contrast and usable area are separate quantities.</p><p>Four phase frames are reconstructed at each point. Piston and tilt are removed from the height result, so use intensity to observe the piston cycle.</p></div></div>` : ""}
      ${step === 2 ? `<p>These results are computed from four synthetic phase frames at each displacement. Visibility measures contrast on retained pixels; valid area shows how much of the detector is usable. Error RMS compares reconstruction with ideal readout on the same bench.</p><div class="data-scroll"><table><thead><tr><th>Piston · nm</th><th>Center intensity</th><th>Visibility</th><th>Valid fraction</th><th>Error RMS · nm</th><th>Status</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${fmt(r.value)}</td><td>${fmt(r.intensity)}</td><td>${fmt(r.visibility)}</td><td>${fmt(r.validFraction)}</td><td>${fmt(r.errorRMSNm)}</td><td>${esc(r.error || r.status)}</td></tr>`).join("")}</tbody></table></div><button data-guide="measure">Open first completed reconstruction in Measure</button>` : ""}
      ${step === 3 ? `<p>Instructional requirements: visibility ≥ 0.5, valid area ≥ 0.75, error RMS ≤ 1 nm, and successive sampling visibility changes ≤ 0.02. Every point is recomputed at 64², 128² and 256². Tolerance trials are outside this experiment.</p><button data-guide="assess" ${busy ? "disabled" : ""}>Recompute & evaluate requirements</button>${assessment ? acceptanceHTML(assessment.report) : ""}` : ""}
      ${step === 4 ? `<p>Overall assessment: <strong>${esc(assessment?.report.status)}</strong>. Save the project with its bench, acquisitions, sweep, requirements and report. Export a backup for use in another browser.</p><button data-guide="save" ${saved || busy ? "disabled" : ""}>${saved ? "Project saved" : "Save complete project"}</button><button data-guide="backup">Export project backup</button><button data-guide="report">Export experiment report HTML</button>` : ""}
      <details class="guided-help"><summary>Recover from a problem</summary><p><strong>Low visibility:</strong> on your own bench, check arm overlap, mirror angles, polarization and power balance. Reopen this guide to continue with the fixed preset.</p><p><strong>Clipping:</strong> in Simulate, reduce exposure; on the bench, check clear apertures and detector extent. Do not interpret saturated frames as valid measurements.</p><p><strong>Missing paths:</strong> verify that both mirror returns reach the same detector via the splitter. Load the prepared bench to inspect its geometry.</p><p><strong>Failed or cancelled computation:</strong> retry the current step. Failed cases remain visible and cannot silently pass acceptance. If storage fails, export the project backup.</p></details>
      <footer class="guided-actions"><button data-guide="back" ${busy || step === 0 ? "disabled" : ""}>Back</button><button data-guide="next" ${busy || step === 4 || (step === 0 && !preview) || (step === 1 && !source) || (step === 3 && !assessment) ? "disabled" : ""}>Continue →</button></footer></main>`;
    paint(selected);
  }
  function paint(row) {
    const canvas = root.querySelector("canvas"),
      frame = row?.run?.frames?.[0];
    if (!canvas || !frame) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(frame.width, frame.height);
    frame.values.forEach((v, i) => {
      const b = Math.round(Math.max(0, Math.min(1, v)) * 255);
      image.data.set([b, b, b, 255], i * 4);
    });
    ctx.putImageData(image, 0, 0);
  }
  return {
    open() {
      if (!root) {
        root = document.createElement("section");
        root.id = "guided-workspace";
        document.body.append(root);
        root.onchange = (e) => {
          if (e.target.matches("[data-frame]"))
            paint(
              (source?.study.rows || preview?.study.rows || [])[
                Number(e.target.value)
              ],
            );
        };
        root.onclick = async (e) => {
          const action = e.target.closest("[data-guide]")?.dataset.guide;
          if (!action || busy) return;
          if (action === "close") {
            closeWorkspace(root);
            return;
          }
          if (action === "bench") {
            onBench?.(structuredClone(setup.project));
            closeWorkspace(root);
            return;
          }
          if (action === "measure") {
            const r = source?.study.rows.find((r) => r.run);
            if (r) onMeasure?.(r.run);
            return;
          }
          try {
            if (["preview", "sweep", "assess", "save"].includes(action)) {
              busy = true;
              message =
                "Working… You can cancel computation using Cancel analysis.";
              render();
            }
            if (action === "preview") {
              preview = await run("preview");
              message = "Preview ready. Inspect the frame, then continue.";
            }
            if (action === "sweep") {
              source = await run("sweep");
              assessment = null;
              bundle = null;
              saved = false;
              message =
                "Sweep complete. Continue to inspect reconstruction results.";
            }
            if (action === "assess") {
              assessment = await run("assess");
              bundle = guidedBundle(setup, source, assessment);
              saved = false;
              message =
                "Assessment complete. Review the verdict and continue to save.";
            }
            if (action === "next") {
              step++;
              message = "";
            }
            if (action === "back") {
              step--;
              message = "";
            }
            if (action === "save") {
              await save([...bundle.records, bundle]);
              saved = true;
              message =
                "Complete project saved. Find First experiment · Michelson in Projects.";
            }
            if (action === "backup")
              download(
                "optibench-first-experiment.json",
                JSON.stringify(bundle),
                "application/json",
              );
            if (action === "report")
              download(
                "optibench-first-experiment.html",
                `<!doctype html><html lang="en"><meta charset="utf-8"><title>Michelson experiment report</title><style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:20px}table{border-collapse:collapse}td,th{border:1px solid #aaa;padding:8px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Guided Michelson experiment</h1><p>Synthetic piston sweep: 0–${fmt(setup.config.end)} nm, 9 points. Four-phase reconstruction with piston and tilt removed. Download the project backup for source frames.</p>${acceptanceHTML(assessment.report)}</html>`,
                "text/html",
              );
          } catch (err) {
            message = err.message;
          } finally {
            busy = false;
            render();
          }
        };
      }
      showWorkspace(root);
      render();
    },
  };
}
