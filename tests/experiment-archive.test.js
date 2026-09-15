import test from "node:test";
import assert from "node:assert/strict";
import {
  guidedArchive,
  createArchive,
  recomputeArchive,
} from "../dist/experiment-archive.js";
import { createMetrologyWorkspace } from "../dist/metrology-ui.js";
import { Window } from "happy-dom";
test("complete guided archive round-trips all analyses and keeps revisions independent", () => {
  const a = guidedArchive(),
    restored = recomputeArchive(JSON.parse(JSON.stringify(a)));
  assert.equal(restored.summary, "Results reproduced");
  assert.equal(restored.checks.length, 11);
  assert.equal(restored.budget.outputs.pv.decision, "Simulation only");
  assert.equal(restored.repeats.length, 3);
  assert.equal(restored.bench.solver, "Interferometry");
  const b = createArchive({
    current: a.current,
    repeats: a.repeats,
    study: a.study,
    bench: a.bench,
    title: a.title,
    revisionName: "Second revision",
    parent: a,
  });
  assert.equal(b.experimentId, a.experimentId);
  assert.equal(b.parentRevisionId, a.id);
  assert.notEqual(b.id, a.id);
  b.current.frames[0].values[0] = 0;
  assert.notEqual(a.current.frames[0].values[0], 0);
});
test("recomputation detects changed cached values and rejects malformed source data", () => {
  const a = guidedArchive();
  a.current.result.height[5] += 1;
  a.study.sd[8] += 2;
  a.current.uncertainty.budget.outputs.pv.expanded += 3;
  const c = recomputeArchive(a);
  assert.equal(c.summary, "Results differ or unavailable");
  assert.equal(c.checks.filter((x) => x.status === "changed").length, 3);
  a.current.frames[0].values[0] = null;
  assert.throws(() => recomputeArchive(a), /finite|sample|intensity/i);
});
test("archive panel saves and reopens complete revisions and restores bench", async () => {
  const w = new Window();
  globalThis.document = w.document;
  globalThis.Worker = undefined;
  document.body.innerHTML = '<main id="app"></main>';
  w.HTMLCanvasElement.prototype.getContext = () => ({
    createImageData: (x, y) => ({ data: new Uint8ClampedArray(x * y * 4) }),
    putImageData() {},
    strokeRect() {},
  });
  const saved = new Map(),
    runs = new Map();
  let bench = guidedArchive().bench,
    restores = 0;
  createMetrologyWorkspace({
    getProject: () => bench,
    restoreBench: (p) => {
      bench = p;
      restores++;
    },
    capture: () => {},
    store: {
      list: async () => [...runs.values()],
      save: async (r) => runs.set(r.id, r),
      remove: async (id) => runs.delete(id),
    },
    archives: {
      list: async () => [...saved.values()],
      save: async (a) => {
        assert.equal(saved.has(a.id), false);
        saved.set(a.id, a);
      },
    },
  }).open();
  const tick = () => new Promise((r) => setTimeout(r, 0)),
    click = async (action) => {
      document.querySelector(`[data-archive="${action}"]`).click();
      await tick();
    };
  await tick();
  await click("guided");
  assert.equal(restores, 1);
  assert.match(
    document.querySelector("#measurement-archive").textContent,
    /Results reproduced/,
  );
  const name = document.querySelector('[data-archive-field="revisionName"]');
  name.value = "My first revision";
  name.dispatchEvent(new w.Event("change", { bubbles: true }));
  await click("save");
  assert.equal(saved.size, 1);
  await click("open");
  assert.equal(restores, 2);
  assert.match(
    document.querySelector("#measurement-uncertainty").textContent,
    /Archived assessment/,
  );
  assert.equal(document.querySelectorAll("[data-repeat-id]").length, 3);
});
