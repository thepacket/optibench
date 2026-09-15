import { compareStudies } from "./study-comparison.js";
import { comparisonHTML } from "./study-comparison-ui.js";
import { reopenSimulationStudy, createSweepArchive } from "./sweep-archive.js";
import { archiveStore } from "./run-store.js";
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
  onAlignment,
  store = archiveStore,
}) {
  let root,
    study = null,
    comparison = null,
    compareA = "",
    compareB = "",
    workingProject = null,
    entries = [],
    parent = null,
    title = "",
    revisionName = "",
    revisionNotes = "",
    verification = null,
    archiveMessage = "",
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
    const p = workingProject || getProject();
    root.innerHTML = `<header class="measurement-header"><button data-sim="close">← Optical bench</button><h1>Controlled simulation runs</h1><button data-sim="alignment">Alignment & tolerances</button><button data-sim="open-file" ${busy ? "disabled" : ""}>Open study / archive</button><button data-sim="current" ${busy ? "disabled" : ""}>Use current bench</button><button data-sim="run" ${busy ? "disabled" : ""}>${busy ? "Simulating…" : "Run sweep"}</button><button data-sim="export" ${study && !busy ? "" : "disabled"}>Export complete study</button><button data-sim="measure" ${study?.rows.some((r) => r.run) && !busy ? "" : "disabled"}>Save acquisitions & measure</button></header><main class="validation-main"><p>Study bench: <b>${esc(p.title)}</b>. Change one parameter across this frozen copy; use “Use current bench” to start from the active layout. Every acquisition retains its modified layout, normalization, seeds and analysis settings.</p><div class="measurement-two"><label>Parameter<select data-config="parameter">${[
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
      )}</select></label>${["start", "end", "count", "seed"].map((key) => `<label>${key}<input data-config="${key}" type="number" step="any" value="${config[key]}"></label>`).join("")}</div><p role="status">${esc(message)}</p><p>128² sample grid. Exposure and noise use an illustrative normalized-intensity readout, not the camera hardware model. Shared seeds isolate parameter effects; these runs are not independent repeats.</p>${study ? `<h2>${esc(study.config.parameter)} comparison</h2>${plot()}<div class="measurement-table-scroll"><table><thead><tr><th>Value</th><th>Status</th><th>Center intensity · frame 0</th><th>Visibility</th><th>PV / RMS · nm</th><th>Error RMS · nm</th><th>Valid area</th></tr></thead><tbody>${study.rows.map((r) => `<tr><td>${fmt(r.value)}</td><td>${esc(r.error || r.status)}</td><td>${fmt(r.intensity)}</td><td>${fmt(r.visibility)}</td><td>${fmt(r.pvNm)} / ${fmt(r.rmsNm)}</td><td>${fmt(r.errorRMSNm)}</td><td>${fmt(r.validFraction == null ? null : r.validFraction * 100)}%</td></tr>${r.warnings?.length ? `<tr><td colspan="7">${r.warnings.map(esc).join(" · ")}</td></tr>` : ""}`).join("")}</tbody></table></div>${study.notes.map((n) => `<p>${esc(n)}</p>`).join("")}` : ""}${historyHTML()}${comparisonPanel()}</main><input id="simulation-file" type="file" accept=".json" hidden>`;
    root.onchange = async (e) => {
      if (busy) return;
      if (e.target.dataset.compare) {
        if (e.target.dataset.compare === "a") compareA = e.target.value;
        else compareB = e.target.value;
        comparison = null;
        render();
        return;
      }
      if (e.target.id === "simulation-file") {
        const f = e.target.files?.[0];
        if (!f) return;
        busy = true;
        message = "Opening and recomputing the saved sweep…";
        render();
        try {
          if (f.size > 250 * 1024 * 1024) throw Error("Study exceeds 250 MB.");
          await restoreFile(JSON.parse(await f.text()));
        } catch (e) {
          message = e.message;
        } finally {
          busy = false;
          render();
        }
        return;
      }
      if (e.target.dataset.revision) {
        const key = e.target.dataset.revision;
        if (key === "title") title = e.target.value;
        if (key === "name") revisionName = e.target.value;
        if (key === "notes") revisionNotes = e.target.value;
        return;
      }

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
      verification = null;
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
        if (a === "alignment") {
          onAlignment?.(
            structuredClone(workingProject || getProject()),
            config.detectorId,
            parent?.id || null,
          );
          return;
        }
        if (a === "compare") {
          busy = true;
          comparison = null;
          message = "Recomputing both revisions for comparison…";
          render();
          const left = entries.find((a) => a.id === compareA),
            right = entries.find((a) => a.id === compareB);
          if (!left || !right) throw Error("Choose two saved sweep revisions.");
          if (typeof Worker === "undefined")
            comparison = compareStudies(left, right);
          else {
            const w = new Worker(
              new URL("./simulation-worker.js", import.meta.url),
              { type: "module" },
            );
            try {
              comparison = await new Promise((resolve, reject) => {
                w.onmessage = ({ data }) =>
                  data.error ? reject(Error(data.error)) : resolve(data.result);
                w.onerror = () =>
                  reject(Error("Study comparison worker failed."));
                w.postMessage({ operation: "compare", left, right });
              });
            } finally {
              w.terminate();
            }
          }
          message =
            "Comparison complete. Review compatibility notes and differences below.";
          return;
        }
        if (a === "comparison-save" && comparison) {
          await store.save({
            ...comparison,
            id: crypto.randomUUID(),
            title: "Sweep comparison",
            createdAt: new Date().toISOString(),
          });
          message =
            "Comparison saved in Projects with both source revision references.";
          return;
        }
        if (a === "comparison-json") {
          download(
            "optibench-study-comparison.json",
            JSON.stringify(comparison),
          );
          return;
        }
        if (a === "comparison-report") {
          download(
            "optibench-study-comparison.html",
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>OptiBench study comparison</title><style>body{font:16px system-ui;max-width:1200px;margin:40px auto;padding:20px}td,th{padding:8px;border:1px solid #aaa;text-align:left}table{border-collapse:collapse}pre{white-space:pre-wrap}svg{max-width:650px}small{display:block}</style><h1>OptiBench study comparison</h1><p>${esc(comparison.createdAt)} · synthetic model comparison · schema ${comparison.version}</p>${comparisonHTML(comparison)}</html>`,
            "text/html",
          );
          return;
        }
        if (a === "open-file") {
          root.querySelector("#simulation-file").click();
          return;
        }
        if (a === "current") {
          workingProject = structuredClone(getProject());
          study = null;
          verification = null;
          parent = null;
          title = "";
          revisionName = "";
          revisionNotes = "";
          config.detectorId =
            getDetector() ||
            workingProject.items.find((c) =>
              ["camera", "screen", "power"].includes(c.type),
            )?.id;
          config.mirrorId = workingProject.items.find(
            (c) => c.type === "mirror",
          )?.id;
          message = "Frozen study bench replaced with the active layout.";
          return;
        }
        if (a === "save-revision") {
          if (!study) throw Error("Run or reopen a study before archiving.");
          const archived = createSweepArchive(study, {
            title,
            revisionName,
            revisionNotes,
            parent,
          });
          await store.save(archived);
          parent = archived;
          title = archived.title;
          revisionName = "";
          revisionNotes = "";
          message = "Complete sweep saved as an immutable revision.";
          await refresh();
          return;
        }
        if (a === "open-revision") {
          busy = true;
          message = "Recomputing archived sweep…";
          render();
          await restoreFile(entries.find((a) => a.id === b.dataset.id));
          return;
        }
        if (a === "export-revision") {
          download(
            "optibench-sweep-archive.json",
            JSON.stringify(entries.find((a) => a.id === b.dataset.id)),
          );
          return;
        }
        if (a === "run") {
          busy = true;
          study = null;
          message = "Tracing the frozen bench and reconstructing phase frames…";
          render();
          verification = null;
          const project = structuredClone(workingProject || getProject());
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
  async function refresh() {
    try {
      entries = (await store.list())
        .filter((a) => a.format === "optibench-sweep-archive")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (e) {
      archiveMessage = e.message;
    }
    if (root) render();
  }
  async function restoreFile(input) {
    let restored;
    if (typeof Worker === "undefined") restored = reopenSimulationStudy(input);
    else {
      const w = new Worker(new URL("./simulation-worker.js", import.meta.url), {
        type: "module",
      });
      try {
        restored = await new Promise((resolve, reject) => {
          w.onmessage = ({ data }) =>
            data.error ? reject(Error(data.error)) : resolve(data.result);
          w.onerror = () => reject(Error("Sweep reopening worker failed."));
          w.postMessage({ operation: "reopen", input });
        });
      } finally {
        w.terminate();
      }
    }
    study = restored.study;
    workingProject = structuredClone(study.baseProject);
    config = { ...study.config };
    verification = restored;
    parent = restored.archive;
    title = parent?.title || "Reopened simulation study";
    revisionName = "";
    revisionNotes = "";
    message =
      restored.summary +
      ". The active bench is unchanged; the controls use the saved study bench.";
  }
  function comparisonPanel() {
    const options = (selected) =>
      '<option value="">Choose revision…</option>' +
      entries
        .map(
          (a) =>
            `<option value="${esc(a.id)}" ${selected === a.id ? "selected" : ""}>${esc(a.title)} / ${esc(a.revisionName)} · ${esc(a.createdAt)}</option>`,
        )
        .join("");
    return `<section class="validation-card"><h2>Compare saved studies</h2><div class="measurement-two"><label>Revision A<select data-compare="a">${options(compareA)}</select></label><label>Revision B<select data-compare="b">${options(compareB)}</select></label></div><div class="measurement-buttons"><button data-sim="compare" ${compareA && compareB && compareA !== compareB && !busy ? "" : "disabled"}>Recompute & compare</button><button data-sim="comparison-save" ${comparison && !busy ? "" : "disabled"}>Save comparison to Projects</button><button data-sim="comparison-json" ${comparison && !busy ? "" : "disabled"}>Export comparison JSON</button><button data-sim="comparison-report" ${comparison && !busy ? "" : "disabled"}>Export comparison report</button></div>${comparisonHTML(comparison)}</section>`;
  }
  function historyHTML() {
    return `<section class="validation-card"><h2>Complete sweep archive</h2><p>${esc(archiveMessage)}</p><p>All points, including failures, are stored in one revision. These are synthetic simulation records. Export JSON for backup; revisions are local to this browser.</p><div class="measurement-two"><label>Experiment title<input data-revision="title" value="${esc(title)}" maxlength="120"></label><label>Revision name<input data-revision="name" value="${esc(revisionName)}" maxlength="120"></label></div><label>Revision notes<textarea data-revision="notes" maxlength="10000">${esc(revisionNotes)}</textarea></label><p>${parent ? "Next revision branches from " + esc(parent.revisionName) : "New sweep history"}</p><button data-sim="save-revision" ${study && !busy ? "" : "disabled"}>Save entire sweep revision</button>${verification ? `<h3>${esc(verification.summary)}</h3><p>Frame tolerance 10⁻¹² normalized intensity; map and scalar tolerance 10⁻⁷; mask and status must agree. Recomputed results are shown; saved revisions are not changed.</p><ul>${verification.checks.map((c) => `<li>Point ${c.index + 1} (${fmt(c.value)}): ${esc(c.status)} · ${esc(c.savedStatus)} → ${esc(c.recomputedStatus)}${c.savedError ? ` · archived: ${esc(c.savedError)}` : ""}</li>`).join("")}</ul>` : ""}<div class="measurement-table-scroll"><table><thead><tr><th>Experiment / revision</th><th>Saved</th><th>Points / failures</th><th>Notes</th><th>Actions</th></tr></thead><tbody>${entries.map((a) => `<tr><td>${esc(a.title)}<small>${esc(a.revisionName)}</small></td><td>${esc(a.createdAt)}</td><td>${a.study.rows.length} / ${a.study.rows.filter((r) => r.status === "failed").length}</td><td>${esc(a.revisionNotes)}</td><td><button data-sim="open-revision" data-id="${esc(a.id)}">Open & recompute</button><button data-sim="export-revision" data-id="${esc(a.id)}">Export</button></td></tr>`).join("")}</tbody></table></div></section>`;
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
    async openRecord(record) {
      this.open();
      busy = true;
      message = "Recomputing saved sweep…";
      render();
      try {
        await restoreFile(record);
      } finally {
        busy = false;
        render();
      }
    },
    open() {
      if (!workingProject) {
        workingProject = structuredClone(getProject());
        const p = workingProject;
        config.detectorId =
          getDetector() ||
          p.items.find((c) => ["camera", "screen", "power"].includes(c.type))
            ?.id;
        config.mirrorId = p.items.find((c) => c.type === "mirror")?.id;
      }
      if (!root) {
        root = document.createElement("section");
        root.id = "simulation-workspace";
        document.body.appendChild(root);
      }
      root.hidden = false;
      document.querySelector("#app").inert = true;
      render();
      refresh();
    },
  };
}
