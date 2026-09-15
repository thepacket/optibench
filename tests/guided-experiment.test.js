import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  guidedSetup,
  guidedSweep,
  guidedAssessment,
  guidedBundle,
} from "../dist/guided-experiment.js";
import { validateBundle } from "../dist/project-navigator.js";
import { createGuidedWorkspace } from "../dist/guided-ui.js";
test("guided Michelson completes a piston cycle with reproducible acceptance and a self-contained backup", () => {
  const setup = guidedSetup(),
    before = JSON.stringify(setup),
    source = guidedSweep(setup),
    rows = source.study.rows;
  assert.equal(rows.length, 9);
  assert.ok(rows.every((r) => r.status === "complete"));
  assert.ok(Math.abs(rows[0].intensity - rows[8].intensity) < 1e-7);
  assert.ok(
    Math.max(...rows.map((r) => r.intensity)) -
      Math.min(...rows.map((r) => r.intensity)) >
      0.1,
  );
  const assessment = guidedAssessment(source);
  assert.equal(assessment.report.status, "meets");
  assert.equal(assessment.report.evidence.sampling.length, 9);
  const bundle = validateBundle(
    JSON.parse(JSON.stringify(guidedBundle(setup, source, assessment))),
  );
  assert.equal(bundle.records.length, 13);
  assert.deepEqual(bundle.missingReferences, []);
  assert.equal(JSON.stringify(setup), before);
});
test("guide gates steps and preserves the current bench until explicitly loaded", () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<main id="app"></main>';
  let loaded = null;
  const ui = createGuidedWorkspace({
    onBench: (p) => {
      loaded = p;
    },
  });
  ui.open();
  assert.equal(loaded, null);
  assert.equal(document.querySelector('[data-guide="next"]').disabled, true);
  document.querySelector('[data-guide="bench"]').click();
  assert.equal(loaded.title, "First experiment · Michelson");
  assert.equal(document.querySelector("#guided-workspace").hidden, true);
  assert.equal(document.querySelector("#app").inert, false);
  ui.open();
  assert.equal(document.querySelector("#guided-workspace").hidden, false);
});
