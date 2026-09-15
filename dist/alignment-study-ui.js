import {
  runAlignmentStudy,
  validateAlignmentConfig,
} from "./alignment-study.js";
import { archiveStore } from "./run-store.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
const download = (r) => {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(r)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = url;
  a.download = "optibench-alignment-study.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
export function createAlignmentStudyWorkspace({
  onApply,
  store = archiveStore,
}) {
  let root,
    base,
    config,
    result,
    busy = false,
    message = "",
    saved = false,
    entries = [],
    worker;
  function render() {
    const mirrors = base.items.filter(
      (x) => x.type === "mirror" && !x.locked && x.enabled !== false,
    );
    root.innerHTML = `<header class="measurement-header"><button data-action="close">← Simulation</button><h1>Alignment & tolerance study</h1><button data-action="run" ${busy ? "disabled" : ""}>Find alignment & test tolerances</button>${busy ? '<button data-action="cancel">Cancel</button>' : ""}</header><main class="validation-main"><p>Frozen bench: <b>${esc(base.title)}</b>. Three-pass coordinate search, followed by seeded uniform perturbations around the proposed alignment. All results are synthetic.</p><fieldset ${busy ? "disabled" : ""}><div class="measurement-two"><label>Objective<select data-field="target"><option value="visibility" ${config.target === "visibility" ? "selected" : ""}>Maximize mean visibility</option><option value="validFraction" ${config.target === "validFraction" ? "selected" : ""}>Maximize valid detector fraction</option></select></label>${[
      ["minVisibility", "Minimum visibility"],
      ["minValid", "Minimum valid fraction"],
      ["trials", "Trials (5–100)"],
      ["seed", "Integer seed"],
    ]
      .map(
        ([k, l]) =>
          `<label>${l}<input data-field="${k}" type="number" step="any" value="${config[k]}"></label>`,
      )
      .join(
        "",
      )}</div><h2>Adjustment axes</h2><p>Bounds and tolerance half-widths use degrees for angle, millimetres for X/Y and nanometres for optical piston. Piston changes optical phase; X/Y move the mount. Tolerance trials may extend beyond search bounds.</p>${config.controls.map((c, i) => `<div class="measurement-two"><label>Mirror<select data-index="${i}" data-key="id">${mirrors.map((m) => `<option value="${m.id}" ${m.id === c.id ? "selected" : ""}>${esc(m.label)}</option>`).join("")}</select></label><label>Axis<select data-index="${i}" data-key="axis">${["angle", "x", "y", "pistonNm"].map((k) => `<option ${c.axis === k ? "selected" : ""}>${k}</option>`).join("")}</select></label><label>Search ±<input type="number" step="any" data-index="${i}" data-key="bound" value="${c.bound}"></label><label>Uniform tolerance ±<input type="number" step="any" data-index="${i}" data-key="tolerance" value="${c.tolerance}"></label><button data-action="remove" data-index="${i}">Remove axis</button></div>`).join("")}<button data-action="add" ${config.controls.length >= 4 ? "disabled" : ""}>Add axis</button></fieldset><p role="status">${esc(message)}</p>${result ? `<h2>Proposed adjustments</h2><table><tr><th>Mirror / axis</th><th>Starting value</th><th>Proposed value</th><th>Change</th></tr>${config.controls.map((c, i) => `<tr><td>${esc(base.items.find((x) => x.id === c.id)?.label)} / ${c.axis}</td><td>${fmt(base.items.find((x) => x.id === c.id)[c.axis] ?? 0)}</td><td>${fmt(result.proposedProject.items.find((x) => x.id === c.id)[c.axis])}</td><td>${fmt(result.best.offsets[i])}</td></tr>`).join("")}</table><p>Visibility: ${fmt(result.baseline.visibility)} → ${fmt(result.best.visibility)} · Valid area: ${fmt(result.baseline.validFraction)} → ${fmt(result.best.validFraction)}</p><p><b>${result.passed} / ${result.trials.length} trials meet both thresholds (${fmt((100 * result.passed) / result.trials.length)}%).</b> ${result.failed} failed reconstructions or mechanical checks are included in the denominator.</p><p>${esc(result.method)}</p><button data-action="apply">Apply proposal to optical bench (undo available)</button><button data-action="save" ${saved ? "disabled" : ""}>${saved ? "Saved" : "Save evidence revision"}</button><button data-action="export">Export complete evidence</button><details><summary>All tolerance trials</summary><table><tr><th>Trial</th><th>Offsets</th><th>Visibility</th><th>Valid fraction</th><th>Outcome</th></tr>${result.trials.map((r, i) => `<tr><td>${i + 1}</td><td>${r.offsets.map(fmt).join(", ")}</td><td>${fmt(r.visibility)}</td><td>${fmt(r.validFraction)}</td><td>${esc(r.error || (r.pass ? "Meets thresholds" : "Below thresholds"))}</td></tr>`).join("")}</table></details>` : ""}<h2>Saved alignment evidence</h2><p>Reopen a saved record to restore its inputs and recompute. Its source sweep revision ID remains in the evidence.</p>${entries.map((e) => `<p>${esc(e.createdAt)} · ${esc(e.baseProject.title)} <button data-action="reopen" data-id="${esc(e.id)}">Open inputs</button><button data-action="backup" data-id="${esc(e.id)}">Export</button></p>`).join("")}<label>Open exported evidence<input type="file" data-file accept=".json"></label></main>`;
  }
  function restore(r) {
    if (
      r?.format !== "optibench-alignment-study" ||
      r.version !== 1 ||
      !r.baseProject ||
      !r.config
    )
      throw Error("Unsupported alignment evidence.");
    base = validateAlignmentConfig(r.baseProject, r.config);
    config = structuredClone(r.config);
    result = null;
    saved = false;
    message =
      "Inputs restored. Run again to regenerate the proposal and trial results.";
  }
  return {
    async openRecord(record) {
      await this.open(
        record.baseProject,
        record.config.detectorId,
        record.parentRevisionId,
      );
      restore(record);
      render();
    },
    async open(project, detectorId, parentRevisionId) {
      base = structuredClone(project);
      const m = base.items.find(
        (x) => x.type === "mirror" && !x.locked && x.enabled !== false,
      );
      config = {
        detectorId,
        parentRevisionId,
        target: "visibility",
        minVisibility: 0.8,
        minValid: 0.9,
        trials: 20,
        seed: 42,
        controls: m
          ? [{ id: m.id, axis: "angle", bound: 0.02, tolerance: 0.001 }]
          : [],
      };
      result = null;
      saved = false;
      message = "";
      if (!root) {
        root = document.createElement("section");
        root.id = "alignment-study-workspace";
        document.body.append(root);
        root.onchange = async (e) => {
          if (busy) return;
          try {
            if (e.target.hasAttribute("data-file")) {
              const f = e.target.files[0];
              if (f) {
                if (f.size > 25 * 1024 * 1024)
                  throw Error("Evidence exceeds 25 MB.");
                restore(JSON.parse(await f.text()));
              }
            } else {
              const k = e.target.dataset.field,
                j = e.target.dataset.index,
                key = e.target.dataset.key;
              if (k)
                config[k] = k === "target" ? e.target.value : +e.target.value;
              else if (j !== undefined) {
                config.controls[j][key] =
                  key === "axis" ? e.target.value : +e.target.value;
                if (key === "axis") {
                  config.controls[j].bound =
                    key && e.target.value === "angle"
                      ? 0.02
                      : e.target.value === "pistonNm"
                        ? 100
                        : 0.1;
                  config.controls[j].tolerance = config.controls[j].bound / 20;
                }
              }
              result = null;
              saved = false;
            }
          } catch (e) {
            message = e.message;
          }
          render();
        };
        root.onclick = async (e) => {
          const b = e.target.closest("[data-action]");
          if (!b) return;
          const a = b.dataset.action;
          if (a === "cancel") {
            worker?.terminate();
            worker = null;
            busy = false;
            message = "Cancelled; no bench changes applied.";
            render();
            return;
          }
          if (busy) return;
          try {
            if (a === "close") {
              root.hidden = true;
              return;
            }
            if (a === "add") {
              const m = base.items.find(
                (x) => x.type === "mirror" && !x.locked && x.enabled !== false,
              );
              if (m && config.controls.length < 4)
                config.controls.push({
                  id: m.id,
                  axis: "x",
                  bound: 0.1,
                  tolerance: 0.005,
                });
              result = null;
            }
            if (a === "remove") {
              config.controls.splice(+b.dataset.index, 1);
              result = null;
            }
            if (a === "reopen")
              restore(entries.find((x) => x.id === b.dataset.id));
            if (a === "backup")
              download(entries.find((x) => x.id === b.dataset.id));
            if (a === "export" && result) download(result);
            if (a === "save" && result) {
              await store.save(result);
              saved = true;
              entries.unshift(result);
              message =
                "Evidence saved locally. Export a backup for portability.";
            }
            if (a === "apply" && result) {
              const applied = await onApply(
                result.baseProject,
                result.proposedProject,
                result,
              );
              if (applied?.evidenceSaved) saved = true;
              message =
                "Proposal applied. Return to the optical bench and use Undo to revert.";
            }
            if (a === "run") {
              busy = true;
              result = null;
              saved = false;
              message = "Searching and running tolerance trials…";
              render();
              if (typeof Worker === "undefined")
                result = runAlignmentStudy(base, config);
              else {
                worker = new Worker(
                  new URL("./alignment-study-worker.js", import.meta.url),
                  { type: "module" },
                );
                const current = worker;
                result = await new Promise((resolve, reject) => {
                  current.onmessage = ({ data }) =>
                    data.error
                      ? reject(Error(data.error))
                      : resolve(data.result);
                  current.onerror = () =>
                    reject(Error("Alignment worker failed."));
                  current.postMessage({ project: base, config });
                });
                current.terminate();
                worker = null;
              }
              message =
                "Study complete. Review the proposal before applying it.";
            }
          } catch (e) {
            message = e.message;
          } finally {
            busy = false;
            render();
          }
        };
      }
      root.hidden = false;
      render();
      try {
        entries = (await store.list()).filter(
          (x) => x.format === "optibench-alignment-study",
        );
      } catch (e) {
        message = e.message;
      }
      render();
    },
  };
}
