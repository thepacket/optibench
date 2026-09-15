import test from "node:test";
import assert from "node:assert/strict";
import { makeProject } from "../dist/project.js";
import { simulateRuns } from "../dist/simulation-runs.js";
import {
  createSweepArchive,
  reopenSimulationStudy,
  validateSimulationStudy,
} from "../dist/sweep-archive.js";
import { createSimulationWorkspace } from "../dist/simulation-ui.js";
import { Window } from "happy-dom";
const p = makeProject("michelson"),
  config = {
    parameter: "piston",
    start: 0,
    end: 316.5,
    count: 3,
    seed: 42,
    detectorId: p.items.find((x) => x.type === "camera").id,
    mirrorId: p.items.find((x) => x.type === "mirror").id,
  };
test("whole-sweep archive round trip preserves controls and acquisition identities", () => {
  const s = simulateRuns(p, config),
    a = createSweepArchive(s, { title: "Design A", revisionName: "Baseline" }),
    r = reopenSimulationStudy(JSON.parse(JSON.stringify(a)));
  assert.equal(r.summary, "All sweep points reproduced");
  assert.deepEqual(r.study.config, config);
  assert.equal(r.study.id, s.id);
  assert.equal(r.study.rows[1].run.acquisitionId, s.rows[1].run.acquisitionId);
  const next = createSweepArchive(r.study, {
    revisionName: "Review",
    parent: a,
  });
  assert.equal(next.parentRevisionId, a.id);
  assert.equal(next.experimentId, a.experimentId);
  assert.notEqual(next.id, a.id);
});
test("changed frame, map and historical failure are reported; malformed studies fail", () => {
  const s = simulateRuns(p, config);
  s.rows[0].run.frames[0].values[0] += 0.001;
  s.rows[0].run.result.height[100] += 1;
  s.rows[1] = {
    value: s.rows[1].value,
    status: "failed",
    error: "Archived failure",
    project: s.rows[1].run.project,
    frames: s.rows[1].run.frames,
  };
  const a = createSweepArchive(s, { revisionName: "Historical results" }),
    r = reopenSimulationStudy(a);
  assert.equal(r.checks[0].status, "changed");
  assert.ok(r.checks[0].maxFrameDelta > 0.0009);
  assert.equal(r.checks[1].savedStatus, "failed");
  assert.equal(a.study.rows[1].status, "failed");
  assert.equal(r.checks[1].recomputedStatus, "complete");
  s.rows.pop();
  assert.throws(() => validateSimulationStudy(s), /incomplete/);
});
test("simulation UI reopens archived controls independently of the current bench", async () => {
  const w = new Window();
  globalThis.document = w.document;
  globalThis.Worker = undefined;
  document.body.innerHTML = '<main id="app"></main>';
  const a = createSweepArchive(simulateRuns(p, config), {
      title: "Archived Michelson",
      revisionName: "First",
    }),
    entries = new Map([[a.id, a]]);
  let active = makeProject("expander");
  const ui = createSimulationWorkspace({
    getProject: () => active,
    getDetector: () => null,
    onImport: async () => {},
    store: {
      list: async () => [...entries.values()],
      save: async (a) => entries.set(a.id, a),
    },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  ui.open();
  await tick();
  document.querySelector('[data-sim="open-revision"]').click();
  await tick();
  assert.match(
    document.querySelector("#simulation-workspace [role=status]").textContent,
    /All sweep points reproduced/,
  );
  assert.equal(document.querySelector('[data-config="count"]').value, "3");
  assert.equal(active.solver, "Gaussian");
  let el = document.querySelector('[data-revision="name"]');
  el.value = "Second";
  el.dispatchEvent(new w.Event("change", { bubbles: true }));
  document.querySelector('[data-sim="save-revision"]').click();
  await tick();
  assert.equal(entries.size, 2);
  document.querySelector('[data-sim="close"]').click();
  ui.open();
  await tick();
  assert.equal(document.querySelector('[data-config="count"]').value, "3");
  document.querySelector('[data-sim="current"]').click();
  await tick();
  assert.equal(
    document.querySelector('[data-sim="save-revision"]').disabled,
    true,
  );
});
