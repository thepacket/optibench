import {
  alignmentGoals,
  alignmentFields,
  alignmentVariable,
  createAlignmentRecipe,
  alignmentExample,
  validateAlignment,
  parseAlignmentProcedure,
  applyAlignment,
  alignmentProject,
} from "./measured-optimization.js";
import { runbookStore } from "./runbook.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import {
  esc,
  optimizationResults,
  optimizationReport,
} from "./optimization-report.js";
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const number = (label, key, value, attrs = "") =>
  `<label>${label}<input type="number" step="any" data-value="${key}" value="${value}" ${attrs}></label>`;
export function createOptimizationWorkspace({
  getProject,
  onBench,
  onRunbook,
  store = runbookStore,
  execute,
} = {}) {
  let root,
    recipe,
    record = null,
    history = [],
    job = null,
    message = "Choose a measured goal and bounded variables.";
  function render() {
    if (!root) return;
    const busy = !!job,
      kind = recipe.goal === "power" ? "power" : "camera";
    root.innerHTML = `<header class="measurement-header"><button data-opt="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Measured alignment</h1><span>Virtual instruments</span></header><main class="instrument-main"><p role="status">${esc(message)}</p><div class="measurement-buttons"><button data-opt="capture" ${busy ? "disabled" : ""}>Capture live bench</button>${Object.keys(
      alignmentGoals,
    )
      .map(
        (k) =>
          `<button data-opt="example-${k}" ${busy ? "disabled" : ""}>${k === "center" ? "Centering" : k === "diameter" ? "Diameter" : "Power"} example</button>`,
      )
      .join(
        "",
      )}<button data-opt="load-bench" ${busy ? "disabled" : ""}>Load procedure bench · undo available</button></div><p>Snapshot: ${esc(recipe.project.title)}. Search uses copies. Apply changes the live bench only after review.</p><div class="runbook-layout"><section class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Alignment procedure</legend><label>Name<input data-text="name" value="${esc(recipe.name)}" maxlength="200"></label><label>Notes<textarea data-text="notes" maxlength="10000">${esc(recipe.notes)}</textarea></label><label>Goal<select data-goal>${Object.entries(
      alignmentGoals,
    )
      .map(
        ([k, v]) =>
          `<option value="${k}" ${recipe.goal === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></label><label>Detector<select data-value="detectorId">${recipe.project.items
      .filter((c) => c.enabled && c.type === kind)
      .map(
        (c) =>
          `<option value="${c.id}" ${c.id === recipe.detectorId ? "selected" : ""}>${esc(c.label)}</option>`,
      )
      .join(
        "",
      )}</select></label>${recipe.goal === "diameter" ? number("Target D4σ diameter, both axes · mm", "target", recipe.target, 'min="0.000001"') : ""}${kind === "camera" ? number("Acceptable goal error · mm", "tolerance", recipe.tolerance, 'min="0.000001"') : ""}<h3>Adjustable parameters</h3>${recipe.variables
      .map(
        (v, i) =>
          `<fieldset data-variable="${i}"><legend>Parameter ${i + 1}</legend><label>Component<select data-var="componentId">${recipe.project.items
            .filter(
              (c) =>
                c.enabled &&
                !c.locked &&
                Object.values(alignmentFields).some((f) =>
                  f.types.includes(c.type),
                ),
            )
            .map(
              (c) =>
                `<option value="${c.id}" ${c.id === v.componentId ? "selected" : ""}>${esc(c.label)}</option>`,
            )
            .join(
              "",
            )}</select></label><label>Parameter<select data-var="field">${Object.entries(
            alignmentFields,
          )
            .filter(([, f]) =>
              f.types.includes(
                recipe.project.items.find((c) => c.id === v.componentId)?.type,
              ),
            )
            .map(
              ([k, f]) =>
                `<option value="${k}" ${k === v.field ? "selected" : ""}>${k} · ${f.unit}</option>`,
            )
            .join(
              "",
            )}</select></label><div class="runbook-fields">${["min", "max", "resolution"].map((k) => `<label>${k === "min" ? "Minimum" : k === "max" ? "Maximum" : "Resolution"}<input data-var="${k}" type="number" step="any" value="${v[k]}"></label>`).join("")}</div><button data-opt="remove" data-index="${i}">Remove parameter</button></fieldset>`,
      )
      .join(
        "",
      )}<button data-opt="add" ${recipe.variables.length >= 3 ? "disabled" : ""}>Add parameter</button><h3>Acquisition settings</h3><div class="runbook-fields">${kind === "camera" ? `${number("Exposure · ms", "settings.exposure", recipe.settings.exposure, 'min=".001" max="10000"')}<label>Square ROI · pixels<select data-value="settings.n">${[64, 128, 256].map((n) => `<option ${recipe.settings.n === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>${number("ROI X offset · pixels", "settings.roiX", recipe.settings.roiX)}${number("ROI Y offset · pixels", "settings.roiY", recipe.settings.roiY)}<label>Dark average · frames<select data-value="settings.backgroundFrames">${[1, 4, 8, 16].map((n) => `<option ${recipe.settings.backgroundFrames === n ? "selected" : ""}>${n}</option>`).join("")}</select></label>` : `${number("Wavelength calibration · nm", "settings.wavelength", recipe.settings.wavelength)}<label>Meter range · mW<select data-value="settings.rangeMw">${[0.0001, 0.001, 0.01, 0.1, 1, 10, 100].map((n) => `<option ${recipe.settings.rangeMw === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Samples per reading<select data-value="settings.averages">${[1, 4, 16, 64, 256].map((n) => `<option ${recipe.settings.averages === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><p>A fresh shutter-closed zero precedes every reading.</p>`}${number("Search evaluations, including baseline", "maxEvaluations", recipe.maxEvaluations, 'min="3" max="48"')}${number("Search repeats per evaluation", "repeats", recipe.repeats, 'min="1" max="3"')}${number("Fresh verification repeats per condition", "verificationRepeats", recipe.verificationRepeats, 'min="3" max="8"')}${number("Noise seed", "seed", recipe.seed, 'min="0" max="2147000000"')}</div></fieldset><div class="measurement-buttons"><button data-opt="preflight" ${busy ? "disabled" : ""}>Validate procedure</button><button data-opt="run" ${busy ? "disabled" : ""}>Optimize</button>${busy ? '<button data-opt="cancel">Cancel · retain evaluations</button>' : ""}<button data-opt="save-recipe" ${busy ? "disabled" : ""}>Save alignment procedure</button><button data-opt="export-recipe" ${busy ? "disabled" : ""}>Export procedure JSON</button></div><p>Bounds must include initial values. Locked components cannot move. Search is local; invalid measurements are rejected. Camera goals use a single straight Gaussian path. Power goals support the existing meter model.</p><label>Import alignment procedure<input type="file" accept=".json" data-import ${busy ? "disabled" : ""}></label><label>Saved alignment procedures<select data-history="recipe"><option value="">Choose procedure</option>${history
      .filter((r) => r.format === "optibench-alignment-procedure")
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select></label><button data-opt="open-recipe" ${busy ? "disabled" : ""}>Open saved procedure</button></section><section class="instrument-results">${optimizationResults(record)}<div class="measurement-buttons"><button data-opt="apply" ${busy || !record?.verification?.accepted || record.status !== "completed" ? "disabled" : ""}>Apply verified alignment to live bench</button><button data-opt="runbook" ${busy || !record?.verification?.accepted || record.status !== "completed" ? "disabled" : ""}>Create Runbook verification procedure</button><button data-opt="save-run" ${busy || !record ? "disabled" : ""}>Save alignment run</button><button data-opt="export-run" ${busy || !record ? "disabled" : ""}>Export complete audit JSON</button><button data-opt="report" ${busy || !record ? "disabled" : ""}>Export printable report</button><button data-opt="replay" ${busy || !record ? "disabled" : ""}>Use recorded procedure</button></div><label>Saved alignment runs<select data-history="run"><option value="">Choose run</option>${history
      .filter((r) => r.format === "optibench-alignment-run")
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name)} · ${esc(r.createdAt)}</option>`,
      )
      .join(
        "",
      )}</select></label><button data-opt="open-run" ${busy ? "disabled" : ""}>Open saved run</button><p>Save retains the procedure and raw measurements in this browser. Export JSON for an audit backup. A repeated seed reproduces simulated noise; use a new seed for an independent rerun.</p></section></div></main>`;
  }
  function stop(reason = "Cancelled by user.") {
    if (!job) return;
    const token = job;
    job = null;
    token.cancelled = true;
    token.worker?.terminate();
    clearTimeout(token.timer);
    token.resolve?.(null);
    if (record) {
      record.status = "cancelled";
      record.stopReason = reason;
      record.finishedAt = new Date().toISOString();
      record.verification = null;
    }
    message = reason;
    render();
  }
  async function run() {
    recipe = validateAlignment(recipe);
    const token = { cancelled: false };
    job = token;
    record = null;
    message = "Acquiring baseline…";
    render();
    function receive(e) {
      if (job !== token) return;
      if (e.type === "start") record = e.run;
      if (e.type === "evaluation") {
        record.evaluations.push(e.evaluation);
        message = `${e.evaluation.phase} · evaluation ${record.evaluations.length} · ${e.evaluation.valid ? "measured" : e.evaluation.error}`;
      }
      if (e.type === "best") record.bestValues = e.values;
      render();
    }
    token.timer = setTimeout(
      () => stop("Stopped after the 120-second execution limit."),
      120000,
    );
    try {
      const result = execute
        ? await execute(recipe, {
            onEvent: receive,
            cancelled: () => token.cancelled,
          })
        : await new Promise((resolve, reject) => {
            token.resolve = resolve;
            const w = new Worker(
              new URL("./optimization-worker.js", import.meta.url),
              { type: "module" },
            );
            token.worker = w;
            w.onmessage = ({ data }) => {
              if (job !== token) return;
              if (data.event) receive(data.event);
              else if (data.error) reject(Error(data.error));
              else resolve(data.result);
            };
            w.onerror = (e) => reject(Error(e.message));
            w.postMessage({ recipe });
          });
      if (job !== token) return;
      record = result;
      message = `Alignment ${result.status}. ${result.verification?.outcome || result.stopReason} Review the measurements before applying.`;
    } catch (e) {
      if (job === token) {
        if (record) {
          record.status = "interrupted";
          record.verification = null;
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
  async function action(a, index) {
    if (a === "cancel") {
      stop();
      return;
    }
    if (job) return;
    try {
      if (a === "close") {
        closeWorkspace(root);
        return;
      }
      if (a === "capture") {
        recipe = createAlignmentRecipe(getProject(), recipe.goal);
        message = "Live bench captured.";
      }
      if (a.startsWith("example-")) {
        recipe = alignmentExample(a.slice(8));
        message =
          "Example loaded into the procedure. To apply its results, first load this procedure bench.";
      }
      if (a === "load-bench") {
        onBench?.(structuredClone(recipe.project));
        message =
          "Procedure bench loaded. The bench Undo action can restore the previous layout.";
      }
      if (a === "add") {
        const used = new Set(
          recipe.variables.map((v) => `${v.componentId}:${v.field}`),
        );
        let added = false;
        for (const c of recipe.project.items.filter(
          (c) => c.enabled && !c.locked,
        )) {
          for (const [field, f] of Object.entries(alignmentFields)) {
            if (f.types.includes(c.type) && !used.has(`${c.id}:${field}`)) {
              recipe.variables.push(
                alignmentVariable(recipe.project, c.id, field),
              );
              added = true;
              break;
            }
          }
          if (added) break;
        }
        if (!added) throw Error("No additional supported parameters.");
      }
      if (a === "remove") recipe.variables.splice(Number(index), 1);
      if (a === "preflight") {
        validateAlignment(recipe);
        message =
          "Procedure bounds and acquisition budget are valid. Baseline acquisition will check optical support and measurement quality.";
      }
      if (a === "run") {
        await run();
        return;
      }
      if (a === "save-recipe") {
        const saved = validateAlignment(recipe);
        saved.id = crypto.randomUUID();
        saved.createdAt = new Date().toISOString();
        await store.save(saved);
        history = await store.list();
        message = "Alignment procedure saved in Runbook storage.";
      }
      if (a === "export-recipe")
        download(
          "optibench-alignment-procedure.json",
          JSON.stringify(validateAlignment(recipe)),
        );
      if (a === "open-recipe") {
        const id = root.querySelector('[data-history="recipe"]').value;
        const saved = history.find((r) => r.id === id);
        if (!saved) throw Error("Choose a saved procedure.");
        recipe = validateAlignment(saved);
        message = "Saved alignment procedure ready to replay.";
      }
      if (a === "open-run") {
        const id = root.querySelector('[data-history="run"]').value;
        const saved = history.find((r) => r.id === id);
        if (!saved) throw Error("Choose a saved run.");
        record = structuredClone(saved);
      }
      if (a === "replay") {
        recipe = structuredClone(record.recipe);
        message =
          "Recorded settings restored. Change the seed for independent noise.";
      }
      if (a === "save-run") {
        if (!record) throw Error("Run an alignment first.");
        await store.save(record);
        history = await store.list();
        message = "Alignment run and raw acquisition audit saved.";
      }
      if (a === "export-run")
        download("optibench-alignment-run.json", JSON.stringify(record));
      if (a === "report")
        download(
          "optibench-alignment-report.html",
          optimizationReport(record),
          "text/html",
        );
      if (a === "apply") {
        const p = applyAlignment(record, getProject());
        onBench?.(p);
        message =
          "Verified parameter changes applied. Use bench Undo to restore the previous layout.";
      }
      if (a === "runbook") {
        if (!record?.verification?.accepted || record.status !== "completed")
          throw Error("Complete verification first.");
        await onRunbook?.(
          alignmentProject(record.recipe, record.bestValues),
          record,
        );
      }
    } catch (e) {
      message = e.message;
    }
    render();
  }
  return {
    async open(project) {
      if (!root) {
        root = document.createElement("section");
        root.id = "optimization-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const b = e.target.closest("[data-opt]");
          if (b) void action(b.dataset.opt, b.dataset.index);
        };
        root.onchange = async (e) => {
          if (job) return;
          try {
            const t = e.target;
            if (t.matches("[data-import]")) {
              const f = t.files?.[0];
              if (!f) return;
              if (f.size > 2 * 1024 * 1024)
                throw Error("Procedure imports are limited to 2 MB.");
              recipe = parseAlignmentProcedure(await f.text());
              message =
                "Procedure imported. Validate and rerun to acquire results.";
            } else if (t.dataset.text) recipe[t.dataset.text] = t.value;
            else if (t.matches("[data-goal]"))
              recipe = createAlignmentRecipe(recipe.project, t.value);
            else if (t.dataset.value) {
              const keys = t.dataset.value.split(".");
              if (keys.length === 2)
                recipe[keys[0]][keys[1]] =
                  t.value === "" ? NaN : Number(t.value);
              else recipe[keys[0]] = t.value === "" ? NaN : Number(t.value);
            } else if (t.dataset.var) {
              const i = Number(t.closest("[data-variable]").dataset.variable),
                v = recipe.variables[i],
                k = t.dataset.var;
              if (k === "componentId") {
                const id = Number(t.value),
                  c = recipe.project.items.find((c) => c.id === id),
                  field = Object.keys(alignmentFields).find((k) =>
                    alignmentFields[k].types.includes(c.type),
                  );
                recipe.variables[i] = alignmentVariable(
                  recipe.project,
                  id,
                  field,
                );
              } else if (k === "field")
                recipe.variables[i] = alignmentVariable(
                  recipe.project,
                  v.componentId,
                  t.value,
                );
              else v[k] = t.value === "" ? NaN : Number(t.value);
            } else return;
          } catch (error) {
            message = error.message;
          }
          render();
        };
      }
      if (!recipe || project)
        recipe = createAlignmentRecipe(project || getProject());
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
