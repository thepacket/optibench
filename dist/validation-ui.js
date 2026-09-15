import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import { TaskWorker } from "./task-worker.js";
import {
  benchmarks,
  runBenchmark,
  validationReport,
  baselineReport,
  benchmarkInput,
} from "./validation.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toExponential(3) : "—");
const download = (name, body, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([body], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function profile(r) {
  if (!r.profile) return "";
  const values = r.profile
      .flatMap((p) => [p.expected, p.recovered])
      .filter(Number.isFinite),
    lo = Math.min(...values),
    hi = Math.max(...values);
  const path = (key) => {
    let connected = false,
      d = "";
    r.profile.forEach((p, i) => {
      if (!Number.isFinite(p[key])) {
        connected = false;
        return;
      }
      d +=
        (connected ? " L" : " M") +
        (35 + (i / (r.profile.length - 1)) * 600).toFixed(2) +
        "," +
        (150 - ((p[key] - lo) / (hi - lo || 1)) * 120).toFixed(2);
      connected = true;
    });
    return d;
  };
  return `<svg viewBox="0 0 680 185" role="img" aria-label="Expected and recovered center-row height profile" style="width:100%;background:#101923"><path d="${path("expected")}" stroke="#bdf18b" stroke-width="3" fill="none"/><path d="${path("recovered")}" stroke="#70bdff" stroke-width="1.5" stroke-dasharray="5 3" fill="none"/><text x="35" y="175" fill="#bdf18b" font-size="13">Expected · solid</text><text x="220" y="175" fill="#70bdff" font-size="13">Recovered · dashed</text></svg><p>Center row · X 0–127 px · Y range ${fmt(lo)} to ${fmt(hi)} nm. Gaps are excluded pixels.</p>`;
}
export function createValidationCenter() {
  let root,
    results = [],
    busy = false,
    message = "",
    baseline = null;
  function cards() {
    return benchmarks
      .map((b) => {
        const r = results.find((r) => r.id === b.id),
          old = baseline?.results.find((r) => r.id === b.id);
        return `<article class="validation-card"><header><h2>${esc(b.name)}</h2><strong>${r ? (r.passed ? "PASS" : "FAIL") : "Not run"}</strong></header><p>${esc(b.description)}</p><small>${b.kind === "accuracy" ? "Accuracy: error RMS ≤ " + fmt(b.toleranceNm) + " nm; >99% valid; zero unwrap conflicts" : "Fault-detection benchmark; PASS means the fault was detected"}</small><div class="measurement-buttons"><button data-validation="run" data-id="${b.id}" ${busy ? "disabled" : ""}>Run case</button><button data-validation="fixture" data-id="${b.id}">Export fixture</button></div>${r ? `<div>${r.error ? esc(r.error) : `<p>Error RMS ${fmt(r.errorRMS)} nm · maximum ${fmt(r.maxError)} nm · valid ${(100 * r.validFraction).toFixed(1)}%</p><table><thead><tr><th>Metric</th><th>Expected full ROI</th><th>Recovered valid region</th></tr></thead><tbody><tr><td>PV · nm</td><td>${fmt(r.expectedPV)}</td><td>${fmt(r.recoveredPV)}</td></tr><tr><td>RMS · nm</td><td>${fmt(r.expectedRMS)}</td><td>${fmt(r.recoveredRMS)}</td></tr></tbody></table><p>Phase-step residual ${(r.stepResidual * 100).toFixed(3)}% · clipped ${r.clippedPixels} · unwrap conflicts ${r.unwrapConflicts}</p>${profile(r)}${r.warnings.map((w) => `<p class="measurement-warning">${esc(w)}</p>`).join("")}`}</div>${old && Number.isFinite(old.errorRMS) ? `<p>Baseline error RMS ${fmt(old.errorRMS)} nm · change ${fmt(r.errorRMS - old.errorRMS)} nm. Historical report supplied by operator.</p>` : ""}` : ""}</article>`;
      })
      .join("");
  }
  function render() {
    root.innerHTML = `<header class="measurement-header"><button data-validation="close">← Optical bench</button><div><span class="measurement-kicker">OPTIBENCH / VALIDATION</span><h1>Validation Center</h1></div><button data-validation="all" ${busy ? "disabled" : ""}>${busy ? "Running…" : "Run all benchmarks"}</button><button data-validation="baseline">Open baseline JSON</button><button data-validation="json" ${results.length && !busy ? "" : "disabled"}>Export JSON</button><button data-validation="report" ${results.length && !busy ? "" : "disabled"}>Export report</button></header><main class="validation-main"><p role="status">${esc(message || "Run deterministic known-answer experiments without laboratory equipment.")}</p><p>Evidence: analytical and synthetic. These cases test the phase-measurement engine and fault diagnostics; they do not certify real-instrument accuracy or the complete optical solver. Accuracy requires RMS error within the stated bound, >99% valid area and zero unwrap conflicts.</p><div class="validation-cards">${cards()}</div><section class="validation-card"><h2>Published experimental data · candidates</h2><p><a href="https://zenodo.org/records/18440754" target="_blank" rel="noopener">Generalizable phase extraction in interferometry</a> includes ceramic/steel interferograms and analysis code. The archives are several gigabytes; phase ordering, calibration and reference values still need qualification. Not imported or counted as validation evidence.</p><p><a href="https://perso.ens-lyon.fr/ludovic.bellon/wp/2022/harmonic-calibration-of-quadrature-phase-interferometry/" target="_blank" rel="noopener">Harmonic calibration of quadrature phase interferometry</a> is a candidate for signal-calibration research, not a verified four-image spatial benchmark. Source review: 2026-09-15.</p><p>Admission requires raw intensity, documented phase sequence and wavelength, calibration, reference result with uncertainty, and reuse permission. No laboratory dataset is included in the current benchmark suite.</p></section></main><input id="validation-baseline" type="file" accept=".json" hidden>`;
    root.onclick = async (e) => {
      const b = e.target.closest("[data-validation]");
      if (!b) return;
      const a = b.dataset.validation;
      if (a === "close") {
        root.hidden = true;
        document.querySelector("#app").inert = false;
        return;
      }
      if (busy) return;
      try {
        if (a === "all" || a === "run") {
          busy = true;
          message = "Running known-answer reconstruction…";
          render();
          for (const id of a === "all"
            ? benchmarks.map((b) => b.id)
            : [b.dataset.id]) {
            let r;
            if (typeof Worker === "undefined") r = runBenchmark(id);
            else {
              const w = new TaskWorker(
                new URL("./validation-worker.js", import.meta.url),
                { type: "module" },
              );
              try {
                r = await new Promise((resolve, reject) => {
                  w.onmessage = ({ data }) =>
                    data.error
                      ? reject(Error(data.error))
                      : resolve(data.result);
                  w.onerror = () => reject(Error("Validation worker failed."));
                  w.postMessage({ id });
                });
              } finally {
                w.terminate();
              }
            }
            results = results.filter((v) => v.id !== id).concat(r);
            message = `${results.length} cases run · ${results.filter((r) => r.passed).length} passed.`;
            render();
          }
          busy = false;
          render();
        } else if (a === "json")
          download(
            "optibench-validation.json",
            JSON.stringify(validationReport(results)),
          );
        else if (a === "report")
          download(
            "optibench-validation.html",
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>OptiBench validation</title><style>body{font:16px system-ui;max-width:1100px;margin:40px auto;padding:20px}article{border-bottom:1px solid #aaa;padding:20px}button{display:none}td,th{padding:8px}svg{max-width:700px}</style><h1>OptiBench validation report</h1><p>${esc(new Date().toISOString())} · suite ${validationReport(results).version} · engine ${validationReport(results).engine}</p><p>Analytical and synthetic evidence only. Diagnostic PASS means an injected fault was detected. Full-ROI expected PV/RMS differs from masked-region statistics in fault cases.</p>${cards()}</html>`,
            "text/html",
          );
        else if (a === "baseline") root.querySelector("input").click();
        else if (a === "fixture") {
          const f = benchmarkInput(b.dataset.id);
          download(
            `${b.dataset.id}-fixture.json`,
            JSON.stringify({
              ...f,
              truth: Array.from(f.truth),
              frames: f.frames.map((v) => ({
                ...v,
                values: Array.from(v.values),
              })),
            }),
          );
        }
      } catch (e) {
        busy = false;
        message = e.message;
        render();
      }
    };
    root.onchange = async (e) => {
      if (!e.target.files?.length) return;
      try {
        const f = e.target.files[0];
        if (f.size > 2e6) throw Error("Baseline report must be below 2 MB.");
        baseline = baselineReport(await f.text());
        message = `Baseline loaded · ${baseline.results.length} cases. Differences compare reported error RMS; baseline provenance is operator supplied.`;
      } catch (e) {
        message = e.message;
      }
      render();
    };
  }
  return {
    open() {
      document.querySelector("#app").inert = true;
      if (!root) {
        root = document.createElement("section");
        root.id = "validation-center";
        document.body.appendChild(root);
        render();
      }
      showWorkspace(root);
    },
  };
}
