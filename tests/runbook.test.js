import test from "node:test";
import assert from "node:assert/strict";
import {
  createRunbook,
  runbookExample,
  validateRunbook,
  planRunbook,
  newRunbookStep,
} from "../dist/runbook.js";
import { profilerExample } from "../dist/beam-profiler.js";
test("runbooks retain a frozen bench and validated named procedures", () => {
  const p = profilerExample(),
    r = createRunbook(p);
  p.items[0].power = 100;
  assert.notEqual(r.project.items[0].power, 100);
  assert.equal(validateRunbook(r).steps.length, 1);
  r.steps.push({ ...r.steps[0] });
  assert.throws(() => validateRunbook(r), /unique/);
});
test("parameter plans preserve order, repeated positions and independent seeds", () => {
  const r = runbookExample();
  r.steps[0].repeats = 2;
  const before = JSON.stringify(r),
    plan = planRunbook(r);
  assert.equal(plan.trials.length, 10);
  assert.equal(plan.trials[0].value, 0.5);
  assert.equal(plan.trials[1].value, 0.5);
  assert.equal(plan.trials[9].value, 4);
  assert.equal(new Set(plan.trials.map((t) => t.seed)).size, 10);
  assert.equal(JSON.stringify(r), before);
  r.steps[0].repeats = 10;
  assert.throws(() => planRunbook(r), /budget/);
});
import {
  preflightRunbook,
  executeRunbook,
  evaluateRunbookTrial,
} from "../dist/runbook.js";
test("preflight catches invalid detectors, ROI, table travel and unsupported optical paths", () => {
  const r = runbookExample();
  assert.ok(preflightRunbook(r).ok);
  r.steps[0].settings.roiX = 20000;
  assert.match(preflightRunbook(r).errors.join(), /ROI/);
  r.steps[0].settings.roiX = 0;
  r.steps[0].detectorId = 999;
  assert.equal(preflightRunbook(r).ok, false);
  const p = runbookExample("power");
  p.steps[0].sweep = {
    componentId: p.steps[0].detectorId,
    field: "x",
    start: 1000,
    end: 2000,
    count: 3,
  };
  assert.match(preflightRunbook(p).errors.join(), /position|table/);
});
test("execution retains independent acquisitions and can cancel between trials without changing the bench", async () => {
  const r = runbookExample(),
    before = JSON.stringify(r),
    events = [];
  let stop = false;
  const run = await executeRunbook(r, {
    onEvent: (e) => {
      events.push(e.type);
      if (e.type === "trial") stop = true;
    },
    cancelled: () => stop,
  });
  assert.equal(run.status, "cancelled");
  assert.equal(run.trials.length, 1);
  assert.equal(run.summary.outcome, "inconclusive");
  assert.ok(run.trials[0].measurement.frame);
  assert.equal(JSON.stringify(r), before);
  assert.ok(events.includes("start"));
});
test("acceptance uses measured values, never truth, and quality failures cannot pass", () => {
  const m = { valueMw: 0.5, overload: false, truth: { incidentPowerMw: 100 } };
  assert.equal(
    evaluateRunbookTrial("power", m, { metric: "valueMw", min: 0, max: 1 })
      .status,
    "pass",
  );
  assert.equal(
    evaluateRunbookTrial(
      "power",
      { ...m, overload: true },
      { metric: "valueMw", min: 0, max: 1 },
    ).status,
    "inconclusive",
  );
  assert.equal(evaluateRunbookTrial("power", m, null).status, "measured");
  assert.equal(
    evaluateRunbookTrial(
      "camera",
      { analysis: { valid: false, diameterXmm: 1 } },
      { metric: "diameterXmm", min: 0, max: 2 },
    ).status,
    "inconclusive",
  );
});
test("a configured stop condition retains the failing acquisition and its meter zero", async () => {
  const r = runbookExample("power");
  r.stopOnFailure = true;
  r.steps[0].criterion = { metric: "valueMw", min: 1, max: 2 };
  const run = await executeRunbook(r);
  assert.equal(run.status, "stopped");
  assert.equal(run.trials.length, 1);
  assert.equal(run.summary.outcome, "fail");
  assert.ok(run.trials[0].zeroReading.settings.shutter);
  assert.ok(run.trials[0].measurement.zero);
});
import { compareRunbookRuns } from "../dist/runbook-review.js";
test("run comparison matches repeated acquisitions and warns about identical noise seeds", async () => {
  const r = runbookExample("power");
  r.steps[0].sweep.count = 3;
  const a = await executeRunbook(r),
    b = structuredClone(a);
  b.id = "second";
  b.trials[0].decision.value += 0.000001;
  let c = compareRunbookRuns(a, b);
  assert.equal(c.rows.length, 3);
  assert.ok(c.rows[0].delta > 0);
  assert.match(c.warnings.join(), /not independent/);
  b.recipe.seed++;
  c = compareRunbookRuns(a, b);
  assert.equal(c.warnings.length, 0);
  b.recipe.steps[0].settings.wavelength = 700;
  assert.throws(() => compareRunbookRuns(a, b), /same bench/);
});
import { importRunbookData } from "../dist/runbook-review.js";
test("portable run review recomputes meter readings, zero corrections and acceptance decisions", async () => {
  const r = runbookExample("power");
  r.steps[0].sweep.count = 3;
  const run = await executeRunbook(r),
    original = run.trials[0].measurement.valueMw;
  run.trials[0].measurement.valueMw = 999;
  run.trials[0].decision.status = "fail";
  const imported = importRunbookData(JSON.stringify(run));
  assert.notEqual(imported.id, run.id);
  assert.equal(imported.trials[0].measurement.valueMw, original);
  assert.notEqual(imported.trials[0].decision.status, "fail");
  assert.match(imported.reviewNote, /recomputed/);
  run.trials[1].seed++;
  assert.throws(() => importRunbookData(run), /order and seeds/);
});
test("camera run review rejects forged acquisition metadata and recomputes profile fits", async () => {
  const r = createRunbook(profilerExample());
  const run = await executeRunbook(r);
  run.trials[0].measurement.analysis.diameterXmm = 999;
  const imported = importRunbookData(run);
  assert.ok(imported.trials[0].measurement.analysis.diameterXmm < 1);
  run.trials[0].measurement.settings.exposure += 1;
  assert.throws(() => importRunbookData(run), /exposure/);
  const p = importRunbookData(r);
  assert.notEqual(p.id, r.id);
  assert.equal(p.steps[0].id, r.steps[0].id);
});
import { runbookReport, runbookCSV } from "../dist/runbook-report.js";
test("reports include measured sweep plots, limits and diagnostics; CSV escapes formulas", async () => {
  const r = runbookExample("power");
  r.steps[0].sweep.count = 3;
  r.name = "<script>alert(1)</script>";
  r.steps[0].label = '=unsafe,"test"';
  const run = await executeRunbook(r),
    html = runbookReport(run),
    csv = runbookCSV(run);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes("&lt;script&gt;"));
  assert.match(html, /measured sweep/);
  assert.match(html, /raw camera pixels/);
  assert.match(csv, /'=unsafe/);
  assert.match(csv, /""test""/);
});
import { Window } from "happy-dom";
import { createRunbookWorkspace } from "../dist/runbook-ui.js";
import { acquireBeamProfile } from "../dist/beam-profiler.js";
import { importProfilerRecord } from "../dist/profiler-records.js";
test("round-trip camera review preserves nonfatal optical warnings without inventing a quality failure", () => {
  const p = profilerExample();
  p.items[0].wavelength = 800;
  const frame = acquireBeamProfile(p, { detectorId: 3, n: 256, seed: 1 });
  assert.ok(frame.warnings.length);
  const reviewed = importProfilerRecord(frame);
  assert.equal(reviewed.analysis?.valid, frame.analysis?.valid);
});
test("Runbook UI edits, executes, saves, compares, exports, imports and opens individual readings", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLAnchorElement.prototype.click = () => {};
  const saved = new Map(),
    files = [],
    oldURL = URL.createObjectURL;
  URL.createObjectURL = (b) => {
    files.push(b);
    return "blob:test";
  };
  let inspected;
  const ui = createRunbookWorkspace({
    getProject: profilerExample,
    store: {
      save: async (r) => saved.set(r.id, structuredClone(r)),
      list: async () => [...saved.values()],
    },
    onInspect: (kind, r) => (inspected = { kind, r }),
    execute: async (d) =>
      d.mode === "preflight"
        ? preflightRunbook(d.recipe)
        : d.mode === "import"
          ? importRunbookData(d.text)
          : executeRunbook(d.recipe, d),
  });
  try {
    await ui.open();
    const root = document.getElementById("runbook-workspace"),
      wait = () => new Promise((r) => setTimeout(r, 25)),
      click = async (a) => {
        root.querySelector(`[data-runbook="${a}"]`).click();
        await wait();
      };
    await click("power-example");
    await click("duplicate");
    assert.equal(root.querySelectorAll("[data-step]").length, 2);
    await click("remove");
    assert.equal(root.querySelectorAll("[data-step]").length, 1);
    await click("preflight");
    assert.match(root.textContent, /Preflight passed/);
    await click("save-recipe");
    assert.equal(saved.size, 1);
    await click("run");
    assert.match(root.textContent, /Procedure completed/);
    await click("save-run");
    assert.equal(saved.size, 2);
    const first = [...saved.values()].find(
      (r) => r.format === "optibench-runbook-run",
    );
    assert.equal(first.trials.length, 9);
    await click("inspect");
    assert.equal(inspected.kind, "power");
    assert.equal(inspected.r.format, "optibench-power-reading");
    await click("new-seed");
    await click("run");
    await click("save-run");
    root.querySelector("[data-saved-run]").value = first.id;
    await click("compare");
    assert.match(root.textContent, /Run comparison/);
    await click("csv");
    assert.match(await files.at(-1).text(), /sweep_parameter/);
    await click("report");
    assert.match(await files.at(-1).text(), /Matched-run comparison/);
    const input = root.querySelector("[data-runbook-import]");
    Object.defineProperty(input, "files", {
      value: [{ size: 100, text: async () => JSON.stringify(first) }],
    });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await wait();
    assert.match(root.textContent, /Import reviewed/);
    await click("save-run");
    assert.equal(saved.size, 4);
    await click("close");
    assert.equal(root.hidden, true);
    assert.equal(document.getElementById("app").inert, false);
  } finally {
    URL.createObjectURL = oldURL;
    w.happyDOM.abort();
  }
});
test("UI cancellation keeps completed frames and ignores late results from the interrupted execution", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  const rows = [];
  let release,
    reads = 0;
  const gate = new Promise((r) => (release = r));
  const ui = createRunbookWorkspace({
    getProject: profilerExample,
    store: {
      list: async () => rows,
      save: async (r) => rows.push(structuredClone(r)),
    },
    execute: (d) =>
      executeRunbook(d.recipe, {
        ...d,
        camera: async (p, s) => {
          reads++;
          if (reads === 2) await gate;
          return acquireBeamProfile(p, s);
        },
      }),
  });
  await ui.open();
  const root = document.getElementById("runbook-workspace");
  const repeats = root.querySelector('[data-field="repeats"]');
  repeats.value = "3";
  repeats.dispatchEvent(new w.Event("change", { bubbles: true }));
  root.querySelector('[data-runbook="run"]').click();
  await new Promise((r) => setTimeout(r, 30));
  root.querySelector('[data-runbook="cancel"]').click();
  assert.match(root.textContent, /Run cancelled/);
  release();
  await new Promise((r) => setTimeout(r, 30));
  root.querySelector('[data-runbook="save-run"]').click();
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(rows[0].status, "cancelled");
  assert.equal(rows[0].trials.length, 1);
  assert.equal(importRunbookData(rows[0]).trials.length, 1);
  w.happyDOM.abort();
});
