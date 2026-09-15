import {
  requirementDefaults,
  createRequirements,
  validateRequirements,
  evaluateAcceptance,
} from "./acceptance.js";
import { archiveStore } from "./run-store.js";
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
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "—");
const download = (name, data, type = "application/json") => {
  const url = URL.createObjectURL(new Blob([data], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function acceptanceHTML(r) {
  return `<h2>Overall: ${esc(r.status)}</h2><p>${esc(r.interpretation)}</p><p>Requirements: ${esc(r.requirements.title)} · ${esc(r.requirementsId)}<br>Source: ${esc(r.source.title)} · ${esc(r.sourceId)}<br>Evaluated: ${esc(r.createdAt)}</p><table><thead><tr><th>Requirement</th><th>Limit</th><th>Observed</th><th>Verdict</th><th>Evidence / scope</th></tr></thead><tbody>${r.checks.map((c) => `<tr><td>${esc(c.name)}</td><td>${fmt(c.limit)}</td><td>${fmt(c.observed)}</td><td><strong>${esc(c.status)}</strong></td><td>${esc(c.reason)}</td></tr>`).join("")}</tbody></table>${r.evidence.error ? `<p>Recomputation: ${esc(r.evidence.error)}</p>` : ""}<details><summary>Exact requirements, settings, layouts and recomputation evidence</summary><pre>${esc(JSON.stringify({ requirements: r.requirements, source: r.source, evaluatedLayouts: r.evaluatedLayouts, replay: r.replay, evidence: r.evidence }, null, 2))}</pre></details>`;
}
export function createAcceptanceWorkspace({ store = archiveStore } = {}) {
  let root,
    records = [],
    title = "Interferometer requirements",
    notes = "",
    limits = { ...requirementDefaults },
    saved = null,
    parent = null,
    sourceId = "",
    report = null,
    busy = false,
    message = "",
    reportSaved = false;
  const sources = () =>
    records.filter((r) =>
      ["optibench-sweep-archive", "optibench-alignment-study"].includes(
        r.format,
      ),
    );
  const requirementRecords = () =>
    records.filter((r) => r.format === "optibench-requirements");
  function render() {
    root.innerHTML = `<header class="measurement-header"><button data-accept="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Requirements & acceptance</h1><button data-accept="evaluate" ${saved && sourceId && !busy ? "" : "disabled"}>Recompute & evaluate</button></header><main class="validation-main"><p>Define requirements, save a revision, then assess one saved sweep or alignment study. Every verdict is simulation-based.</p><fieldset ${busy ? "disabled" : ""}><div class="measurement-two"><label>Saved requirements<select data-choice="requirements"><option value="">New requirements</option>${requirementRecords()
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${saved?.id === r.id ? "selected" : ""}>${esc(r.title)} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Saved study<select data-choice="source"><option value="">Choose a study…</option>${sources()
      .map(
        (r) =>
          `<option value="${esc(r.id)}" ${sourceId === r.id ? "selected" : ""}>${esc(r.title || r.baseProject?.title)} / ${esc(r.revisionName || "Alignment")} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Requirements name<input data-meta="title" maxlength="120" value="${esc(title)}"></label><label>Purpose / assumptions<textarea data-meta="notes" maxlength="10000">${esc(notes)}</textarea></label></div><div class="measurement-two">${[
      ["minVisibility", "Minimum visibility · fraction"],
      ["minValidFraction", "Minimum valid detector area · fraction"],
      ["maxErrorRMSNm", "Maximum reconstruction error RMS · nm"],
      ["minTrialFraction", "Minimum passing tolerance fraction"],
      ["minTrials", "Minimum number of trials"],
      ["maxSamplingChange", "Maximum absolute sampling change"],
    ]
      .map(
        ([key, label]) =>
          `<label>${label}<input data-limit="${key}" type="number" step="any" value="${limits[key]}"></label>`,
      )
      .join("")}<label>Sampling metric<select data-limit="samplingMetric">${[
      ["visibility", "Visibility · fraction"],
      ["validFraction", "Valid area · fraction"],
      ["pvNm", "PV · nm"],
      ["rmsNm", "RMS · nm"],
    ]
      .map(
        ([key, label]) =>
          `<option value="${key}" ${limits.samplingMetric === key ? "selected" : ""}>${label}</option>`,
      )
      .join(
        "",
      )}</select></label></div><label><input type="checkbox" data-limit="requireTolerance" ${limits.requireTolerance ? "checked" : ""}> Require tolerance evidence</label><label><input type="checkbox" data-limit="requireSampling" ${limits.requireSampling ? "checked" : ""}> Require sampling stability evidence</label><p>Sweep metrics use the worst case across all points. Alignment metrics assess the recomputed proposal; tolerance trials must meet all three metric limits. Sweeps have no tolerance trials, so that requirement produces insufficient evidence. Sampling checks both successive grid changes for each evaluated design.</p><button data-accept="save-requirements">Save requirements revision</button></fieldset><p role="status">${esc(message || "Save requirements before evaluating. Changing any limit invalidates the current report.")}</p><div id="acceptance-report">${report ? acceptanceHTML(report) : ""}</div><button data-accept="save-report" ${report && !busy && !reportSaved ? "" : "disabled"}>${reportSaved ? "Report saved" : "Save acceptance report to Projects"}</button><button data-accept="json" ${report && !busy ? "" : "disabled"}>Export report JSON</button><button data-accept="html" ${report && !busy ? "" : "disabled"}>Export report HTML</button></main>`;
  }
  function invalidate() {
    saved = null;
    report = null;
    reportSaved = false;
    message = "Requirements changed. Save a new revision before evaluating.";
    root.querySelector("#acceptance-report").innerHTML = "";
    for (const k of ["evaluate", "save-report", "json", "html"])
      root.querySelector(`[data-accept="${k}"]`).disabled = true;
    root.querySelector('[role="status"]').textContent = message;
  }
  function loadRequirements(r) {
    validateRequirements(r);
    saved = r;
    parent = r;
    title = r.title;
    notes = r.notes || "";
    limits = structuredClone(r.limits);
    report = null;
    reportSaved = false;
  }
  const api = {
    async open(context = []) {
      const all = await store.list();
      records = [
        ...new Map([...all, ...context].map((r) => [r.id, r])).values(),
      ];
      if (!root) {
        root = document.createElement("section");
        root.id = "acceptance-workspace";
        document.body.append(root);
        root.oninput = (e) => {
          if (busy) return;
          const k = e.target.dataset.meta || e.target.dataset.limit;
          if (!k) return;
          if (k === "title") title = e.target.value;
          else if (k === "notes") notes = e.target.value;
          else if (e.target.type === "number")
            limits[k] = e.target.value === "" ? NaN : Number(e.target.value);
          else return;
          invalidate();
        };
        root.onchange = (e) => {
          if (busy) return;
          const choice = e.target.dataset.choice,
            k = e.target.dataset.limit;
          if (choice === "source") {
            sourceId = e.target.value;
            report = null;
            reportSaved = false;
          } else if (choice === "requirements") {
            if (e.target.value)
              loadRequirements(records.find((r) => r.id === e.target.value));
            else {
              parent = null;
              saved = null;
              report = null;
              limits = { ...requirementDefaults };
              title = "New requirements";
              notes = "";
            }
          } else if (k) {
            limits[k] =
              e.target.type === "checkbox"
                ? e.target.checked
                : k === "samplingMetric"
                  ? e.target.value
                  : e.target.value === ""
                    ? NaN
                    : Number(e.target.value);
            invalidate();
          }
          render();
        };
        root.onclick = async (e) => {
          const action = e.target.closest("[data-accept]")?.dataset.accept;
          if (!action || busy) return;
          try {
            if (action === "close") {
              closeWorkspace(root);
              return;
            }
            if (action === "save-requirements") {
              const r = createRequirements(title, limits, notes, parent);
              await store.save(r);
              records.push(r);
              loadRequirements(r);
              message =
                "Requirements revision saved. Choose a saved study and evaluate.";
            }
            if (action === "evaluate") {
              busy = true;
              report = null;
              reportSaved = false;
              message =
                "Recomputing source evidence and checking requirements…";
              render();
              const source = records.find((r) => r.id === sourceId);
              if (typeof Worker === "undefined")
                report = evaluateAcceptance(saved, source);
              else {
                const w = new TaskWorker(
                  new URL("./acceptance-worker.js", import.meta.url),
                  { type: "module" },
                );
                try {
                  report = await new Promise((resolve, reject) => {
                    w.onmessage = ({ data }) =>
                      data.error
                        ? reject(Error(data.error))
                        : resolve(data.result);
                    w.onerror = () =>
                      reject(Error("Acceptance worker failed."));
                    w.postMessage({ requirements: saved, source });
                  });
                } finally {
                  w.terminate();
                }
              }
              message =
                "Assessment complete. Review each verdict and its evidence.";
            }
            if (action === "save-report" && report) {
              await store.save(report);
              reportSaved = true;
              message =
                "Acceptance report saved. Projects backups include its requirements and source study.";
            }
            if (action === "json" && report)
              download("optibench-acceptance.json", JSON.stringify(report));
            if (action === "html" && report)
              download(
                "optibench-acceptance.html",
                `<!doctype html><html lang="en"><meta charset="utf-8"><title>OptiBench acceptance report</title><style>body{font:16px system-ui;max-width:1200px;margin:30px auto;padding:20px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #888;padding:10px;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style><h1>Simulation acceptance report</h1>${acceptanceHTML(report)}</html>`,
                "text/html",
              );
          } catch (e) {
            message = e.message;
          } finally {
            busy = false;
            render();
          }
        };
      }
      showWorkspace(root);
      render();
    },
    async openRecord(r, context) {
      await api.open(context);
      if (r.format === "optibench-requirements") {
        loadRequirements(r);
        message = "Requirements restored. Choose a study to evaluate.";
      } else {
        loadRequirements(r.requirements);
        sourceId = r.sourceId;
        message =
          "Report inputs restored. Recompute to obtain a current verdict; the historical verdict is not reused.";
      }
      render();
    },
  };
  return api;
}
