import test from "node:test";
import assert from "node:assert/strict";
import { makeProject } from "../dist/project.js";
import {
  runAlignmentStudy,
  evaluateAlignment,
  candidateProject,
} from "../dist/alignment-study.js";
import { createAlignmentStudyWorkspace } from "../dist/alignment-study-ui.js";
import { Window } from "happy-dom";
const p = makeProject("michelson"),
  mirror = p.items.find((x) => x.type === "mirror"),
  detector = p.items.find((x) => x.type === "camera");
const config = {
  detectorId: detector.id,
  target: "visibility",
  seed: 42,
  trials: 5,
  minVisibility: 0.8,
  minValid: 0.9,
  controls: [{ id: mirror.id, axis: "angle", bound: 0.02, tolerance: 0.001 }],
  parentRevisionId: "saved-sweep",
};
const evaluate = (p) => ({
  visibility:
    1 -
    1000 *
      (p.items.find((x) => x.id === mirror.id).angle - mirror.angle - 0.01) **
        2,
  validFraction: 1,
});
test("bounded optimizer finds known optimum, preserves base and reproduces seeded trials", () => {
  const before = JSON.stringify(p),
    a = runAlignmentStudy(p, config, evaluate),
    b = runAlignmentStudy(p, config, evaluate);
  assert.ok(Math.abs(a.best.offsets[0] - 0.01) < 1e-10);
  assert.ok(a.best.visibility > a.baseline.visibility);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(a.trials, b.trials);
  assert.equal(a.parentRevisionId, "saved-sweep");
  assert.ok(a.search.every((x) => Math.abs(x.offsets[0]) <= 0.02));
  assert.ok(a.trials.every((x) => Math.abs(x.perturbations[0]) <= 0.001));
});
test("failed trials remain in denominator and invalid controls are rejected", () => {
  const c = {
    ...config,
    controls: [{ ...config.controls[0], tolerance: 0.02 }],
  };
  const a = runAlignmentStudy(p, c, (q) => {
    const v = q.items.find((x) => x.id === mirror.id).angle - mirror.angle;
    if (Math.abs(v) > 0.001) throw Error("Lost beam");
    return { visibility: 1, validFraction: 1 };
  });
  assert.equal(a.trials.length, 5);
  assert.ok(a.failed > 0);
  assert.equal(a.passed + a.failed, 5);
  assert.throws(
    () => runAlignmentStudy(p, { ...config, trials: 0 }, evaluate),
    /trials/,
  );
  assert.throws(
    () =>
      runAlignmentStudy(
        p,
        { ...config, controls: [config.controls[0], config.controls[0]] },
        evaluate,
      ),
    /unique/,
  );
  const locked = structuredClone(p);
  locked.items.find((x) => x.id === mirror.id).locked = true;
  assert.throws(() => runAlignmentStudy(locked, config, evaluate), /unlocked/);
});
test("real Michelson evaluation reconstructs and position changes respect stage travel", () => {
  const metrics = evaluateAlignment(p, detector.id);
  assert.ok(metrics.visibility > 0 && metrics.visibility <= 1);
  assert.ok(metrics.validFraction > 0 && metrics.validFraction <= 1);
  const study = runAlignmentStudy(p, config);
  assert.ok(study.best.visibility >= study.baseline.visibility);
  assert.equal(study.trials.length, 5);
  const stage = structuredClone(p),
    m = stage.items.find((x) => x.id === mirror.id);
  m.mountType = "xyz";
  m.stageOriginX = m.x;
  m.stageTravel = 0.01;
  assert.throws(
    () => candidateProject(stage, [{ id: m.id, axis: "x" }], [0.1]),
    /travel/,
  );
});
test("alignment UI shows controls and restores saved input evidence without applying it", async () => {
  const w = new Window();
  globalThis.document = w.document;
  globalThis.Worker = undefined;
  let applied = false,
    savedRecord = null;
  const a = runAlignmentStudy(p, config, evaluate);
  const ui = createAlignmentStudyWorkspace({
    onApply: () => {
      applied = true;
    },
    store: {
      list: async () => [a],
      save: async (r) => {
        savedRecord = r;
      },
    },
  });
  await ui.open(p, detector.id, null);
  document.querySelector('[data-action="reopen"]').click();
  assert.match(
    document.querySelector('[role="status"]').textContent,
    /Inputs restored/,
  );
  assert.equal(applied, false);
  assert.equal(document.querySelector('[data-field="trials"]').value, "5");
  assert.equal(document.querySelector('[data-action="apply"]'), null);
  document.querySelector('[data-action="run"]').click();
  await new Promise((r) => setTimeout(r, 0));
  document.querySelector('[data-action="apply"]').click();
  assert.equal(applied, true);
  document.querySelector('[data-action="save"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(savedRecord.format, "optibench-alignment-study");
  assert.equal(savedRecord.parentRevisionId, "saved-sweep");
  const field = document.querySelector('[data-field="seed"]');
  field.value = "43";
  field.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal(document.querySelector('[data-action="apply"]'), null);
});
