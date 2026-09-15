import test from "node:test";
import assert from "node:assert/strict";
import { simulateRuns } from "../dist/simulation-runs.js";
import { makeProject } from "../dist/project.js";
import { analyzeRepeats } from "../dist/repeatability.js";
import { createSimulationWorkspace } from "../dist/simulation-ui.js";
import { Window } from "happy-dom";
const p = makeProject("michelson"),
  config = {
    parameter: "piston",
    detectorId: p.items.find((x) => x.type === "camera").id,
    mirrorId: p.items.find((x) => x.type === "mirror").id,
    start: 0,
    end: 633 / 2,
    count: 3,
    seed: 42,
  };
test("piston sweep cycles intensity and preserves independent exact bench snapshots", () => {
  const before = JSON.stringify(p),
    s = simulateRuns(p, config);
  assert.equal(JSON.stringify(p), before);
  assert.equal(s.rows.filter((r) => r.run).length, 3);
  assert.ok(Math.abs(s.rows[0].intensity - s.rows[2].intensity) < 1e-5);
  assert.ok(Math.abs(s.rows[0].intensity - s.rows[1].intensity) > 0.1);
  assert.equal(
    s.rows[1].run.project.items.find((x) => x.id === config.mirrorId).pistonNm,
    633 / 4,
  );
  assert.equal(
    s.rows[1].run.simulation.normalizationPeak,
    s.rows[0].run.simulation.normalizationPeak,
  );
  assert.throws(
    () =>
      analyzeRepeats(
        s.rows.map((r) => r.run),
        { verified: true },
      ),
    /sweep points/,
  );
});
test("noise is seeded and exposure keeps a shared base scale", () => {
  const a = simulateRuns(p, { ...config, parameter: "noise", end: 0.001 }),
    b = simulateRuns(p, { ...config, parameter: "noise", end: 0.001 });
  assert.deepEqual(
    a.rows[1].run.frames[0].values,
    b.rows[1].run.frames[0].values,
  );
  assert.ok(a.rows[1].errorRMSNm > 0);
  const s = simulateRuns(p, {
    ...config,
    parameter: "exposure",
    start: 0.25,
    end: 0.5,
  });
  assert.ok(
    Math.abs((s.rows[2].intensity - 0.02) / (s.rows[0].intensity - 0.02) - 2) <
      1e-8,
  );
});
test("simulation UI runs and transfers linked acquisitions", async () => {
  const w = new Window();
  globalThis.document = w.document;
  globalThis.Worker = undefined;
  document.body.innerHTML = '<main id="app"></main>';
  let received;
  const ui = createSimulationWorkspace({
    getProject: () => p,
    getDetector: () => config.detectorId,
    onImport: async (r) => (received = r),
  });
  ui.open();
  document.querySelector('[data-sim="run"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(
    document.querySelector("#simulation-workspace [role=status]").textContent,
    /7\/7/,
  );
  document.querySelector('[data-sim="measure"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(received.length, 7);
  assert.ok(received[0].simulation.studyId);
});
