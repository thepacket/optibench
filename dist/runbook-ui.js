import {
  runbookReport,
  runbookCSV,
  runbookSweepPlot,
} from "./runbook-report.js";
import { compareRunbookRuns } from "./runbook-review.js";
import {
  createRunbook,
  newRunbookStep,
  runbookExample,
  validateRunbook,
  preflightRunbook,
  summarizeRunbook,
  runbookMetrics,
  sweepFields,
  runbookStore,
} from "./runbook.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "—");
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function stepEditor(step, index, project) {
  const camera = step.kind === "camera",
    detectors = project.items.filter((c) => c.enabled && c.type === step.kind),
    s = step.settings;
  return `<fieldset data-step="${step.id}"><legend>${index + 1}. ${esc(step.label)}</legend><div class="runbook-fields"><label>Step name<input data-field="label" value="${esc(step.label)}" maxlength="200" required></label><label>Instrument<select data-field="kind"><option value="camera">Camera profile</option><option value="power">Power meter</option></select></label><label>Detector<select data-field="detectorId">${detectors.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></label><label>Repeats per point<input type="number" data-field="repeats" value="${step.repeats}" min="1" max="10" step="1" required></label>${camera ? `<label>Exposure · ms<input type="number" data-setting="exposure" value="${s.exposure}" min=".001" max="10000" step="any" required></label><label>Square ROI · pixels<select data-setting="n">${[64, 128, 256].map((n) => `<option>${n}</option>`).join("")}</select></label><label>Dark average · frames<select data-setting="backgroundFrames">${[1, 4, 8, 16].map((n) => `<option>${n}</option>`).join("")}</select></label>${["roiX", "roiY"].map((k) => `<label>${k === "roiX" ? "ROI X" : "ROI Y"} offset · pixels<input type="number" data-setting="${k}" value="${s[k]}" step="1" min="-20000" max="20000" required></label>`).join("")}<label><input type="checkbox" data-field="autoExposure" ${step.autoExposure ? "checked" : ""}>Find exposure from acquired frames</label>` : `<label>Wavelength setting · nm<input type="number" min="400" max="1100" step="any" required data-setting="wavelength" value="${s.wavelength}"></label><label>Range · mW<select data-setting="rangeMw">${[0.0001, 0.001, 0.01, 0.1, 1, 10, 100].map((n) => `<option>${n}</option>`).join("")}</select></label><label>Averaging · samples<select data-setting="averages">${[1, 4, 16, 64, 256].map((n) => `<option>${n}</option>`).join("")}</select></label><label><input type="checkbox" data-field="captureZero" ${step.captureZero ? "checked" : ""}>Acquire shutter-closed zero before each reading</label>`}</div><details ${step.sweep ? "open" : ""}><summary>Parameter sweep</summary><label><input type="checkbox" data-field="sweepEnabled" ${step.sweep ? "checked" : ""}>Sweep one parameter on frozen bench copies</label>${
    step.sweep
      ? `<div class="runbook-fields"><label>Component<select data-sweep="componentId">${project.items
          .filter((c) => c.enabled)
          .map(
            (c) =>
              `<option value="${c.id}">${esc(c.label)} · ${esc(c.type)}</option>`,
          )
          .join(
            "",
          )}</select></label><label>Parameter<select data-sweep="field">${Object.entries(
          sweepFields,
        )
          .map(
            ([k, d]) => `<option value="${k}">${esc(k)} · ${d.unit}</option>`,
          )
          .join(
            "",
          )}</select></label><label>Start<input data-sweep="start" type="number" step="any" required value="${step.sweep.start}"></label><label>End<input data-sweep="end" type="number" step="any" required value="${step.sweep.end}"></label><label>Points<input data-sweep="count" type="number" step="1" min="2" max="21" required value="${step.sweep.count}"></label></div>`
      : ""
  }</details><details ${step.criterion ? "open" : ""}><summary>Measured acceptance limits</summary><label><input type="checkbox" data-field="criterionEnabled" ${step.criterion ? "checked" : ""}>Evaluate a measured quantity</label>${
    step.criterion
      ? `<div class="runbook-fields"><label>Quantity<select data-limit="metric">${Object.entries(
          runbookMetrics[step.kind],
        )
          .map(
            ([key, [label, unit]]) =>
              `<option value="${key}">${label} · ${unit}</option>`,
          )
          .join(
            "",
          )}</select></label><label>Minimum · blank means unbounded<input data-limit="min" type="number" step="any" value="${step.criterion.min ?? ""}"></label><label>Maximum · blank means unbounded<input data-limit="max" type="number" step="any" value="${step.criterion.max ?? ""}"></label></div>`
      : ""
  }<p>Limits are inclusive. Invalid camera profiles and overloaded readings are inconclusive, even if a displayed number falls within bounds.</p></details><div class="measurement-buttons"><button data-runbook="up" data-id="${step.id}" ${index === 0 ? "disabled" : ""}>Move up</button><button data-runbook="down" data-id="${step.id}">Move down</button><button data-runbook="duplicate" data-id="${step.id}">Duplicate</button><button data-runbook="remove" data-id="${step.id}">Remove step</button></div></fieldset>`;
}
function resultView(record) {
  if (!record)
    return "<p>No run recorded yet. Choose an example or capture the live bench, then preflight and run the procedure.</p>";
  const summary = record.summary || summarizeRunbook(record);
  return `<h2>${esc(record.name)}</h2><p>${esc(record.createdAt)} · ${esc(record.status)} · overall ${esc(summary.outcome)} · ${record.trials.length}/${record.expected} acquisitions retained</p><div class="runbook-table"><table><thead><tr><th>Step / repeat</th><th>Sweep value</th><th>Measured result</th><th>Decision</th></tr></thead><tbody>${record.trials
    .map((t) => {
      const metric =
          t.decision.metric ||
          (t.kind === "camera" ? "diameterXmm" : "valueMw"),
        unit = runbookMetrics[t.kind][metric]?.[1] || "";
      return `<tr><td>${esc(t.label)} · ${t.repeat + 1}</td><td>${fmt(t.value)}</td><td>${fmt(t.decision.value)} ${esc(unit)}</td><td class="runbook-${t.decision.status}">${esc(t.decision.status)}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div>${record.trials.map((t, i) => `<details><summary>${i + 1}. ${esc(t.label)} · ${esc(t.decision.status)}</summary>${t.measurement ? `<button data-runbook="inspect" data-id="${esc(t.key)}">Open recorded ${t.kind === "camera" ? "camera frame" : "meter reading"}</button>` : ""}<p>${esc(t.decision.reason)}</p><p>Noise seed ${t.seed} · ${esc(t.startedAt)} to ${esc(t.finishedAt)}</p>${t.measurement?.frame ? `<p>Camera ${t.measurement.settings.exposure} ms · ${t.measurement.frame.n} × ${t.measurement.frame.n} pixels · ${t.measurement.analysis?.valid ? "quality passed" : "quality flagged"}</p>` : ""}${t.measurement?.samplesMw ? `<p>Range ${t.measurement.settings.rangeMw} mW · ${t.measurement.samplesMw.length} raw samples · ${t.zeroReading ? "zero acquired" : "no zero"}</p>` : ""}</details>`).join("")}${record.recipe.steps.map((s) => runbookSweepPlot(record, s)).join("")}<details><summary>Execution log</summary>${record.events.map((e) => `<p>${esc(e.at)} · ${esc(e.message)}</p>`).join("")}</details>${record.reviewNote ? `<p class="instrument-warning">${esc(record.reviewNote)}</p>` : ""}<p>Editing the procedure does not change this recorded result; use its stored procedure to reproduce it.</p><p>Decisions use recorded instrument readings. Simulated data and fixed-scene noise do not establish hardware performance. Completed acquisitions survive cancellation; the interrupted acquisition is not retained.</p>`;
}
export function createRunbookWorkspace({
  getProject,
  store = runbookStore,
  execute,
  onInspect,
  onAlignment,
} = {}) {
  let root,
    recipe,
    record = null,
    check = null,
    history = [],
    message = "",
    job = null,
    comparison = null;
  function render() {
    if (!root) return;
    root.innerHTML = `<header class="measurement-header"><button data-runbook="close" ${job ? "disabled" : ""}>← Optical bench</button><h1>Experiment Runbook</h1><span>Simulated procedures</span></header><main class="instrument-main"><p role="status">${esc(message)}</p><div class="measurement-buttons"><button data-runbook="capture" ${job ? "disabled" : ""}>Capture live bench</button><button data-runbook="alignment" ${job ? "disabled" : ""}>Alignment procedures</button><button data-runbook="camera-example" ${job ? "disabled" : ""}>Camera procedure example</button><button data-runbook="power-example" ${job ? "disabled" : ""}>Power procedure example</button></div><p>Procedure bench: ${esc(recipe.project.title)}. Execution uses this snapshot; the live bench is unchanged.</p><div class="runbook-layout"><section class="instrument-controls"><fieldset ${job ? "disabled" : ""}><legend>Procedure</legend><label>Name<input data-recipe="name" value="${esc(recipe.name)}" maxlength="200" required></label><label>Notes<textarea rows="2" data-recipe="notes" maxlength="10000">${esc(recipe.notes)}</textarea></label><label>Reproducible noise seed<input type="number" data-recipe="seed" value="${recipe.seed}" step="1" min="0" max="2147000000" required></label><label><input type="checkbox" data-recipe="stopOnFailure" ${recipe.stopOnFailure ? "checked" : ""}>Stop on a failed or inconclusive acquisition</label>${recipe.steps.map((s, i) => stepEditor(s, i, recipe.project)).join("")}<div class="measurement-buttons"><button data-runbook="add-camera">Add camera step</button><button data-runbook="add-power">Add power step</button><button data-runbook="new-seed">New noise seed</button></div></fieldset><div class="measurement-buttons"><button data-runbook="preflight" ${job ? "disabled" : ""}>Preflight procedure</button><button data-runbook="run" ${job ? "disabled" : ""}>Run procedure</button>${job ? '<button data-runbook="cancel">Cancel · retain completed data</button>' : ""}<button data-runbook="save-recipe" ${job ? "disabled" : ""}>Save procedure revision</button><button data-runbook="export-recipe" ${job ? "disabled" : ""}>Export procedure JSON</button></div>${check ? `<div class="instrument-${check.ok ? "truth" : "warning"}"><h3>Preflight ${check.ok ? "ready" : "blocked"}</h3><p>${check.acquisitions} acquisitions · ${check.pixelValues.toLocaleString()} stored camera pixel values</p>${[...check.errors, ...check.warnings].map((m) => `<p>${esc(m)}</p>`).join("")}</div>` : ""}<h3>Saved procedures</h3><label>Import procedure or run JSON<input data-runbook-import type="file" accept=".json,application/json" ${job ? "disabled" : ""}></label><select data-saved-recipe><option value="">Choose procedure</option>${history
      .filter((r) => r.format === "optibench-runbook")
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select><button data-runbook="open-recipe" ${job ? "disabled" : ""}>Open procedure</button></section><section class="instrument-results">${resultView(record)}<div class="measurement-buttons"><button data-runbook="save-run" ${job || !record ? "disabled" : ""}>Save run</button><button data-runbook="export-run" ${job || !record ? "disabled" : ""}>Export complete run JSON</button><button data-runbook="csv" ${job || !record ? "disabled" : ""}>Export results CSV</button><button data-runbook="report" ${job || !record ? "disabled" : ""}>Export printable report</button><button data-runbook="use-procedure" ${job || !record ? "disabled" : ""}>Use recorded procedure</button></div><h3>Saved runs</h3><select data-saved-run><option value="">Choose run</option>${history
      .filter((r) => r.format === "optibench-runbook-run")
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select><button data-runbook="open-run" ${job ? "disabled" : ""}>Open run</button><button data-runbook="compare" ${job || !record ? "disabled" : ""}>Compare selected to current</button>${comparison ? `<h3>Run comparison</h3><div class="runbook-table"><table><thead><tr><th>Acquisition</th><th>Baseline</th><th>Current</th><th>Difference</th><th>Decision change</th></tr></thead><tbody>${comparison.rows.map((r) => `<tr><td>${esc(r.label)} · point ${r.index + 1} · repeat ${r.repeat + 1}</td><td>${fmt(r.baseline)} ${esc(r.unit)}</td><td>${fmt(r.current)} ${esc(r.unit)}</td><td>${fmt(r.delta)} ${esc(r.unit)}</td><td>${esc(r.before)} → ${esc(r.after)}</td></tr>`).join("")}</tbody></table></div><p>${comparison.unmatchedBaseline} unmatched baseline / ${comparison.unmatchedCurrent} unmatched current acquisitions</p>${comparison.warnings.map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("")}<p>${esc(comparison.note)}</p>` : ""}<p>Procedures and acquisitions are saved in this browser. Export JSON for a portable backup.</p></section></div></main>`;
    for (const step of recipe.steps) {
      const el = root.querySelector(`[data-step="${step.id}"]`);
      for (const [key, v] of Object.entries(step)) {
        const e = el.querySelector(`[data-field="${key}"]`);
        if (e?.tagName === "SELECT") e.value = String(v ?? "");
      }
      for (const [key, v] of Object.entries(step.settings)) {
        const e = el.querySelector(`[data-setting="${key}"]`);
        if (e?.tagName === "SELECT") e.value = String(v);
      }
      if (step.sweep)
        for (const [k, v] of Object.entries(step.sweep)) {
          const e = el.querySelector(`[data-sweep="${k}"]`);
          if (e?.tagName === "SELECT") e.value = String(v);
        }
      if (step.criterion)
        el.querySelector('[data-limit="metric"]').value = step.criterion.metric;
    }
  }
  function cancel(reason = "Run cancelled by the user.") {
    if (!job) return;
    const old = job;
    job = null;
    old.cancelled = true;
    old.worker?.terminate();
    clearTimeout(old.timer);
    if (old.record) {
      old.record.status = "cancelled";
      old.record.finishedAt = new Date().toISOString();
      old.record.events.push({
        at: old.record.finishedAt,
        type: "cancelled",
        message: reason,
        key: null,
      });
      old.record.summary = summarizeRunbook(old.record);
      record = old.record;
    }
    message = reason + " Completed acquisitions are retained.";
    render();
  }
  async function start(mode, text = null) {
    if (
      mode !== "import" &&
      [...root.querySelectorAll("input")].some((e) => !e.checkValidity())
    )
      throw Error("Enter valid procedure values.");
    const token = { cancelled: false, record: null };
    job = token;
    message =
      mode === "run"
        ? "Starting procedure…"
        : mode === "import"
          ? "Reviewing imported data…"
          : "Checking procedure…";
    render();
    const receive = (event) => {
      if (job !== token) return;
      if (event.type === "start") {
        record = event.run;
        comparison = null;
        token.record = record;
      }
      if (event.type === "trial") record.trials.push(event.trial);
      if (event.type === "event") {
        if (token.record) record.events.push(event.event);
        message = event.event.message;
      }
      render();
    };
    token.timer = setTimeout(
      () => cancel("Execution timed out after 120 seconds."),
      120000,
    );
    try {
      const result = execute
        ? await execute({
            mode,
            text,
            recipe: structuredClone(recipe),
            onEvent: receive,
            cancelled: () => token.cancelled,
          })
        : await new Promise((resolve, reject) => {
            const worker = new Worker(
              new URL("./runbook-worker.js", import.meta.url),
              { type: "module" },
            );
            token.worker = worker;
            worker.onmessage = (e) => {
              if (job !== token) return;
              if (e.data.event) receive(e.data.event);
              else
                e.data.error
                  ? reject(Error(e.data.error))
                  : resolve(e.data.result);
            };
            worker.onerror = (e) => reject(Error(e.message));
            worker.postMessage({ mode, recipe, text });
          });
      if (job !== token) return;
      if (mode === "import") {
        if (result.format === "optibench-runbook") {
          recipe = result;
          check = null;
        } else {
          record = result;
          comparison = null;
        }
        message =
          "Import reviewed. Save it to retain a local copy. Live bench unchanged.";
      } else if (mode === "preflight") {
        check = result;
        message = result.ok
          ? "Preflight passed. Ready to run."
          : "Resolve the preflight errors before running.";
      } else {
        record = result;
        comparison = null;
        message = `Procedure ${record.status}. Save the run to retain its acquisitions.`;
      }
    } catch (e) {
      if (job === token) {
        if (token.record) {
          record.status = "interrupted";
          record.finishedAt = new Date().toISOString();
          record.summary = summarizeRunbook(record);
        }
        message = e.message;
      }
    } finally {
      clearTimeout(token.timer);
      token.worker?.terminate();
      if (job === token) {
        job = null;
        render();
      }
    }
  }
  async function action(a, id) {
    if (a === "alignment" && !job) { onAlignment?.(recipe.project); return; }
    if (a === "cancel") {
      cancel();
      return;
    }
    if (job) return;
    try {
      if (
        ["save-recipe", "export-recipe"].includes(a) &&
        [...root.querySelectorAll("input")].some((e) => !e.checkValidity())
      )
        throw Error("Enter valid procedure values before saving.");
      if (a === "close") {
        closeWorkspace(root);
        return;
      }
      if (a === "inspect") {
        const t = record.trials.find((t) => t.key === id);
        if (!t?.measurement)
          throw Error("This acquisition has no recorded measurement.");
        await onInspect?.(t.kind, structuredClone(t.measurement));
        return;
      }
      if (a === "capture") {
        recipe = createRunbook(getProject());
        check = null;
        message = "Live bench captured as a new procedure snapshot.";
      }
      if (a.endsWith("-example")) {
        recipe = runbookExample(a === "camera-example" ? "camera" : "power");
        check = null;
        message = "Example procedure loaded; live bench unchanged.";
      }
      if (a === "add-camera" || a === "add-power") {
        if (recipe.steps.length >= 12) throw Error("Use at most 12 steps.");
        recipe.steps.push(
          newRunbookStep(
            recipe.project,
            a === "add-camera" ? "camera" : "power",
          ),
        );
        check = null;
      }
      const index = recipe.steps.findIndex((s) => s.id === id);
      if (a === "remove") {
        if (recipe.steps.length === 1) throw Error("Keep at least one step.");
        recipe.steps.splice(index, 1);
        check = null;
      }
      if (a === "duplicate") {
        if (recipe.steps.length >= 12) throw Error("Use at most 12 steps.");
        recipe.steps.splice(index + 1, 0, {
          ...structuredClone(recipe.steps[index]),
          id: crypto.randomUUID(),
        });
        check = null;
      }
      if (a === "up" && index > 0) {
        [recipe.steps[index - 1], recipe.steps[index]] = [
          recipe.steps[index],
          recipe.steps[index - 1],
        ];
        check = null;
      }
      if (a === "down" && index >= 0 && index < recipe.steps.length - 1) {
        [recipe.steps[index + 1], recipe.steps[index]] = [
          recipe.steps[index],
          recipe.steps[index + 1],
        ];
        check = null;
      }
      if (a === "new-seed") {
        recipe.seed =
          crypto.getRandomValues(new Uint32Array(1))[0] % 2147000000;
        check = null;
      }
      if (a === "preflight" || a === "run") {
        await start(a);
        return;
      }
      if (a === "save-recipe") {
        const saved = validateRunbook(recipe);
        saved.id = crypto.randomUUID();
        saved.createdAt = new Date().toISOString();
        await store.save(saved);
        recipe = saved;
        history = await store.list();
        message = "Procedure revision saved.";
      }
      if (a === "export-recipe")
        download(
          "optibench-procedure.json",
          JSON.stringify(validateRunbook(recipe)),
        );
      if (a === "save-run") {
        await store.save(record);
        history = await store.list();
        message = "Run and all completed acquisitions saved locally.";
      }
      if (a === "csv")
        download(
          "optibench-runbook-results.csv",
          runbookCSV(record),
          "text/csv",
        );
      if (a === "report")
        download(
          "optibench-runbook-report.html",
          runbookReport(record, comparison),
          "text/html",
        );
      if (a === "export-run")
        download("optibench-runbook-run.json", JSON.stringify(record));
      if (a === "open-recipe") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-saved-recipe]").value,
        );
        if (!r) throw Error("Choose a saved procedure.");
        recipe = structuredClone(r);
        check = null;
        message = "Saved procedure opened; live bench unchanged.";
      }
      if (a === "open-run") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-saved-run]").value,
        );
        if (!r) throw Error("Choose a saved run.");
        record = structuredClone(r);
        comparison = null;
        message = "Recorded run opened; current procedure unchanged.";
      }
      if (a === "compare") {
        const baseline = history.find(
          (r) => r.id === root.querySelector("[data-saved-run]").value,
        );
        comparison = compareRunbookRuns(baseline, record);
        message = "Matching acquisitions compared.";
      }
      if (a === "use-procedure") {
        recipe = structuredClone(record.recipe);
        check = null;
        message = "Recorded procedure restored for reproducible execution.";
      }
    } catch (e) {
      message = e.message;
    } finally {
      if (a !== "close" && !job) render();
    }
  }
  return {
    async open(input) {
      if (!root) {
        recipe = createRunbook(getProject());
        root = document.createElement("section");
        root.id = "runbook-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const b = e.target.closest("[data-runbook]");
          if (b) void action(b.dataset.runbook, b.dataset.id);
        };
        root.onchange = (e) => {
          if (job || !e.target.checkValidity()) return;
          if (e.target.matches("[data-runbook-import]")) {
            const file = e.target.files?.[0];
            if (!file) return;
            if (file.size > 64 * 1024 * 1024) {
              message = "Runbook imports are limited to 64 MB.";
              render();
              return;
            }
            void file
              .text()
              .then((text) => start("import", text))
              .catch((error) => {
                message = error.message;
                render();
              });
            return;
          }
          const d = e.target.dataset,
            k = d.recipe;
          if (k) {
            recipe[k] =
              k === "stopOnFailure"
                ? e.target.checked
                : k === "seed"
                  ? Number(e.target.value)
                  : e.target.value;
            check = null;
            render();
            return;
          }
          const step = recipe.steps.find(
            (s) => s.id === e.target.closest("[data-step]")?.dataset.step,
          );
          if (!step) return;
          const numeric = () => Number(e.target.value);
          if (d.field) {
            const k = d.field;
            if (k === "kind") {
              const fresh = newRunbookStep(recipe.project, e.target.value);
              Object.assign(step, fresh, { id: step.id });
            } else if (k === "sweepEnabled")
              step.sweep = e.target.checked
                ? {
                    componentId: step.detectorId,
                    field: step.kind === "camera" ? "exposure" : "x",
                    start: step.kind === "camera" ? 0.5 : 1000,
                    end: step.kind === "camera" ? 4 : 1100,
                    count: 5,
                  }
                : null;
            else if (k === "criterionEnabled")
              step.criterion = e.target.checked
                ? {
                    metric: step.kind === "camera" ? "diameterXmm" : "valueMw",
                    min: 0,
                    max: null,
                  }
                : null;
            else
              step[k] = ["autoExposure", "captureZero"].includes(k)
                ? e.target.checked
                : ["detectorId", "repeats"].includes(k)
                  ? numeric()
                  : e.target.value;
          }
          if (d.setting) step.settings[d.setting] = numeric();
          if (d.sweep)
            step.sweep[d.sweep] =
              d.sweep === "field" ? e.target.value : numeric();
          if (d.limit)
            step.criterion[d.limit] =
              d.limit === "metric"
                ? e.target.value
                : e.target.value === ""
                  ? null
                  : numeric();
          check = null;
          render();
        };
      }
      if (input) { recipe = validateRunbook(input); check = null; }
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
