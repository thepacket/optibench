import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeProject } from "../dist/project.js";
import { simulateRuns } from "../dist/simulation-runs.js";
import { createSweepArchive } from "../dist/sweep-archive.js";
import { compareStudies, benchDifferences } from "../dist/study-comparison.js";
import { comparisonHTML } from "../dist/study-comparison-ui.js";
import { createSimulationWorkspace } from "../dist/simulation-ui.js";
const p = makeProject("michelson");
const config = {
  parameter: "piston",
  start: 0,
  end: 316.5,
  count: 3,
  seed: 42,
  detectorId: p.items.find((x) => x.type === "camera").id,
  mirrorId: p.items.find((x) => x.type === "mirror").id,
};
const archive = (cfg = config) =>
  createSweepArchive(simulateRuns(p, cfg), {
    title: "Design <A>",
    revisionName: "Baseline",
  });
test("comparison reproduces equal revisions without changing saved evidence", () => {
  const a = archive(),
    b = createSweepArchive(a.study, { parent: a, revisionName: "Review" }),
    before = JSON.stringify(a);
  const c = compareStudies(a, b);
  assert.equal(c.compatible, true);
  assert.equal(c.intensityComparable, true);
  for (const r of c.rows)
    for (const d of Object.values(r.deltas)) assert.equal(d, 0);
  assert.equal(JSON.stringify(a), before);
  assert.equal(c.a.id, a.id);
  assert.equal(c.b.id, b.id);
  assert.equal(c.changes.length, 0);
  assert.equal((comparisonHTML(c).match(/<svg/g) || []).length, 4);
  assert.match(comparisonHTML(c), /Design &lt;A&gt;/);
  assert.throws(() => compareStudies(a, a), /different/);
});
test("different grids retain extra B points and suppress all deltas", () => {
  const c = compareStudies(archive(), archive({ ...config, count: 4 }));
  assert.equal(c.compatible, false);
  assert.match(c.issues.join(" "), /grids/);
  assert.equal(c.rows.length, 4);
  assert.equal(c.rows[3].statusA, "missing");
  for (const r of c.rows)
    for (const d of Object.values(r.deltas)) assert.equal(d, null);
  assert.doesNotMatch(comparisonHTML(c), /<svg/);
});
test("bench changes identify changed, added and removed components", () => {
  const b = structuredClone(p),
    id = b.items[0].id;
  b.items[0].x += 1;
  b.items.pop();
  b.items.push({ ...b.items[0], id: 9999 });
  const d = benchDifferences(p, b);
  assert.ok(d.some((x) => x.path === `Component ${id}.x`));
  assert.ok(d.some((x) => x.path === "Component 9999" && x.a === null));
  assert.ok(d.some((x) => x.b === null));
});
test("UI compares saved revisions and clears stale exports after selection changes", async () => {
  const w = new Window();
  globalThis.document = w.document;
  globalThis.Worker = undefined;
  document.body.innerHTML = '<main id="app"></main>';
  const a = archive(),
    b = createSweepArchive(a.study, { parent: a, revisionName: "Second" });
  const ui = createSimulationWorkspace({
    getProject: () => p,
    getDetector: () => null,
    onImport: async () => {},
    store: { list: async () => [a, b] },
  });
  const tick = () => new Promise((r) => setTimeout(r, 0));
  ui.open();
  await tick();
  const select = (key, id) => {
    const el = document.querySelector(`[data-compare="${key}"]`);
    el.value = id;
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  select("a", a.id);
  select("b", b.id);
  assert.equal(document.querySelector('[data-sim="compare"]').disabled, false);
  document.querySelector('[data-sim="compare"]').click();
  await tick();
  assert.equal(
    document.querySelector('[data-sim="comparison-report"]').disabled,
    false,
  );
  assert.match(
    document.querySelector("#simulation-workspace").textContent,
    /Compatible sweep grid/,
  );
  select("b", a.id);
  assert.equal(
    document.querySelector('[data-sim="comparison-json"]').disabled,
    true,
  );
  assert.equal(document.querySelector('[data-sim="compare"]').disabled, true);
});
