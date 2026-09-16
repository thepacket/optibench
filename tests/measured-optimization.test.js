import test from "node:test";
import assert from "node:assert/strict";
import {
  alignmentExample,
  validateAlignment,
  executeAlignment,
  measuredObjective,
  applyAlignment,
  summarizeVerification,
  parseAlignmentProcedure,
} from "../dist/measured-optimization.js";
import { alignmentVerificationRunbook } from "../dist/optimization-runbook.js";
import { planRunbook, executeRunbook } from "../dist/runbook.js";
import { optimizationReport } from "../dist/optimization-report.js";
import { Window } from "happy-dom";
import { createOptimizationWorkspace } from "../dist/optimization-ui.js";
import { createRunbookWorkspace } from "../dist/runbook-ui.js";

const fakeCamera = (p) => ({
  analysis: {
    valid: true,
    sensorCentroidXmm: p.items.find((c) => c.type === "camera").y - 450,
    sensorCentroidYmm: 0,
    diameterXmm: 0.25,
    diameterYmm: 0.25,
  },
  frame: { saturated: 0 },
  truth: { perfectLoss: -1e9 },
});

test("alignment validation rejects duplicate, locked, out-of-range and over-budget variables", () => {
  const base = alignmentExample();
  assert.equal(validateAlignment(base).goal, "center");
  for (const change of [
    (r) => r.variables.push({ ...r.variables[0] }),
    (r) => (r.project.items[2].locked = true),
    (r) => (r.variables[0].min = 1000),
    (r) => (r.variables[0].max = 9000),
    (r) => (r.maxEvaluations = 48),
    (r) => (r.settings.roiX = 20000),
    (r) => (r.variables[0].resolution = 0),
    (r) => (r.seed = Infinity),
  ]) {
    const r = structuredClone(base);
    change(r);
    assert.throws(() => validateAlignment(r));
  }
  const r = structuredClone(base);
  r.project.items[2].mountType = "xyz";
  r.project.items[2].stageTravel = 0.01;
  assert.throws(() => validateAlignment(r), /travel/);
});

test("objective uses measured metrics only and rejects invalid profiles and overload", () => {
  const r = alignmentExample(),
    m = fakeCamera(r.project);
  assert.ok(measuredObjective(r, m).loss > 0.05);
  m.analysis.valid = false;
  assert.throws(() => measuredObjective(r, m), /quality/);
  r.goal = "power";
  assert.equal(
    measuredObjective(r, { valueMw: 2, truth: { incidentPowerMw: 1000 } }).loss,
    -2,
  );
  assert.throws(
    () => measuredObjective(r, { valueMw: 2, overload: true }),
    /overloaded/,
  );
});

test("bounded search preserves bench, independent seeds, raw data, and fresh verification", async () => {
  const r = alignmentExample(),
    copy = JSON.stringify(r);
  const run = await executeAlignment(r, { camera: fakeCamera });
  assert.equal(JSON.stringify(r), copy);
  assert.equal(run.status, "completed");
  assert.equal(run.verification.accepted, true);
  assert.equal(run.verification.targetMet, true);
  const search = run.evaluations.filter((e) => !e.phase.startsWith("verify"));
  assert.ok(search.length <= r.maxEvaluations);
  const seeds = run.evaluations.flatMap((e) => e.readings.map((r) => r.seed));
  assert.equal(new Set(seeds).size, seeds.length);
  for (const e of run.evaluations) {
    assert.ok(
      e.values[0] >= r.variables[0].min && e.values[0] <= r.variables[0].max,
    );
    assert.ok(e.readings[0].measurement);
  }
  assert.equal(run.verificationBefore.length, 3);
  assert.equal(run.verificationAfter.length, 3);
  const p = applyAlignment(run, r.project);
  assert.equal(p.items[2].y, run.bestValues[0]);
  assert.notEqual(p.items[2].y, r.project.items[2].y);
  const stale = structuredClone(r.project);
  stale.items[0].power *= 2;
  assert.throws(() => applyAlignment(run, stale), /changed/);
  run.status = "cancelled";
  assert.throws(() => applyAlignment(run, r.project), /completed/);
});

test("invalid candidate is retained but never selected; invalid baseline blocks search", async () => {
  const r = alignmentExample();
  const run = await executeAlignment(r, {
    camera: (p) => {
      if (p.items[2].y < 450.06) throw Error("No usable frame");
      return fakeCamera(p);
    },
  });
  assert.ok(run.evaluations.some((e) => e.error === "No usable frame"));
  assert.equal(run.bestValues[0], r.project.items[2].y);
  assert.equal(run.verification.accepted, false);
  const bad = await executeAlignment(r, {
    camera: () => ({ analysis: { valid: false } }),
  });
  assert.equal(bad.status, "blocked");
  assert.equal(bad.evaluations.length, 1);
  assert.equal(bad.verification, null);
});

test("cancellation keeps completed evaluations and prevents apply or verification claims", async () => {
  const r = alignmentExample();
  let cancel = false,
    count = 0;
  const run = await executeAlignment(r, {
    camera: fakeCamera,
    cancelled: () => cancel,
    onEvent: (e) => {
      if (e.type === "evaluation" && ++count === 3) cancel = true;
    },
  });
  assert.equal(run.status, "cancelled");
  assert.equal(run.evaluations.length, 3);
  assert.equal(run.verification, null);
  assert.throws(() => applyAlignment(run, r.project));
});

test("verification rejects unresolved noise, missing or invalid acquisitions", () => {
  const r = alignmentExample(),
    rows = (values) =>
      values.map((loss) => ({
        valid: true,
        loss,
        metrics: { diameterXmm: loss },
      }));
  assert.equal(
    summarizeVerification(r, rows([1, 2, 3]), rows([1, 1.9, 2.9])).accepted,
    false,
  );
  assert.equal(
    summarizeVerification(r, rows([1, 1, 1]), rows([0.1, 0.1, 0.1])).accepted,
    true,
  );
  assert.equal(
    summarizeVerification(r, rows([1]), rows([0.1, 0.1, 0.1])).outcome,
    "inconclusive",
  );
  const invalid = rows([0.1, 0.1, 0.1]);
  invalid[1].valid = false;
  assert.equal(
    summarizeVerification(r, rows([1, 1, 1]), invalid).accepted,
    false,
  );
});

test("real instrument examples improve measured centering, diameter and power", async () => {
  for (const goal of ["center", "diameter", "power"]) {
    const r = alignmentExample(goal),
      run = await executeAlignment(r);
    assert.equal(run.status, "completed", goal);
    assert.equal(run.verification.accepted, true, goal);
    assert.ok(run.verification.improvement > 0);
    if (goal !== "power") assert.equal(run.verification.targetMet, true, goal);
    const recipe = alignmentVerificationRunbook(run);
    assert.notEqual(recipe.seed, r.seed);
    assert.ok(planRunbook(recipe).trials.length >= 3);
    const qualification = await executeRunbook(recipe);
    assert.equal(qualification.summary.outcome, "pass", goal);
  }
});

test("alignment recipes round-trip, run audits cannot masquerade as imported procedures, reports escape content", async () => {
  const r = alignmentExample();
  r.name = "<script>bad</script>";
  const imported = parseAlignmentProcedure(JSON.stringify(r));
  assert.notEqual(imported.id, r.id);
  assert.deepEqual(imported.variables, r.variables);
  const run = await executeAlignment(r, { camera: fakeCamera });
  assert.throws(() => parseAlignmentProcedure(JSON.stringify(run)));
  const html = optimizationReport(run);
  assert.ok(!html.includes("<script>"));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /standard error/);
});

test("optimization UI saves, replays, exports, hands off to Runbook, and applies only on explicit click", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLAnchorElement.prototype.click = () => {};
  const saved = new Map();
  let p = alignmentExample().project,
    applies = 0,
    handoff = null;
  const ui = createOptimizationWorkspace({
    getProject: () => p,
    onBench: (q) => {
      p = q;
      applies++;
    },
    onRunbook: (p, run) => {
      handoff = alignmentVerificationRunbook(run);
    },
    store: {
      save: async (r) => saved.set(r.id, structuredClone(r)),
      list: async () => [...saved.values()],
    },
    execute: (r, o) => executeAlignment(r, { ...o, camera: fakeCamera }),
  });
  try {
    await ui.open();
    const root = document.getElementById("optimization-workspace"),
      click = async (action) => {
        root.querySelector(`[data-opt="${action}"]`).click();
        await new Promise((r) => setTimeout(r, 20));
      };
    await click("save-recipe");
    assert.equal(saved.size, 1);
    await click("run");
    assert.equal(applies, 0);
    assert.equal(root.querySelector('[data-opt="apply"]').disabled, false);
    await click("save-run");
    assert.equal(saved.size, 2);
    await click("runbook");
    assert.equal(handoff.steps.length, 2);
    await click("apply");
    assert.equal(applies, 1);
    await click("apply");
    assert.equal(applies, 1);
    assert.match(root.textContent, /live bench changed/);
    await click("report");
    await click("export-run");
    await click("replay");
    assert.match(root.textContent, /Recorded settings restored/);
    await click("close");
    assert.equal(root.hidden, true);
    assert.equal(document.getElementById("app").inert, false);
  } finally {
    await w.happyDOM.abort();
  }
});

test("UI cancellation ignores a late successful result and retains completed data", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  let finish;
  const fixture = await executeAlignment(alignmentExample(), {
    camera: fakeCamera,
  });
  const ui = createOptimizationWorkspace({
    getProject: () => fixture.recipe.project,
    store: { list: async () => [] },
    execute: async (r, o) => {
      o.onEvent({
        type: "start",
        run: {
          ...structuredClone(fixture),
          status: "running",
          evaluations: [],
          verification: null,
        },
      });
      o.onEvent({ type: "evaluation", evaluation: fixture.evaluations[0] });
      await new Promise((resolve) => (finish = resolve));
      return fixture;
    },
  });
  try {
    await ui.open();
    const root = document.getElementById("optimization-workspace");
    root.querySelector('[data-opt="run"]').click();
    await new Promise((r) => setTimeout(r, 10));
    root.querySelector('[data-opt="cancel"]').click();
    finish();
    await new Promise((r) => setTimeout(r, 10));
    assert.match(root.textContent, /cancelled/);
    assert.match(root.textContent, /1 evaluations/);
    assert.equal(root.querySelector('[data-opt="apply"]').disabled, true);
  } finally {
    await w.happyDOM.abort();
  }
});

test("Runbook opens alignment procedures and accepts generated verification recipes", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  let snapshot;
  const run = await executeAlignment(alignmentExample(), {
      camera: fakeCamera,
    }),
    r = alignmentVerificationRunbook(run);
  const ui = createRunbookWorkspace({
    getProject: () => run.recipe.project,
    store: { list: async () => [] },
    onAlignment: (p) => (snapshot = p),
  });
  try {
    await ui.open(r);
    const root = document.getElementById("runbook-workspace");
    assert.equal(root.querySelectorAll("[data-step]").length, 2);
    root.querySelector('[data-runbook="alignment"]').click();
    assert.equal(snapshot.items[2].y, run.bestValues[0]);
  } finally {
    await w.happyDOM.abort();
  }
});
