import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { makeProject } from "../dist/project.js";
import { simulateRuns } from "../dist/simulation-runs.js";
import { createSweepArchive } from "../dist/sweep-archive.js";
import {
  createLayout,
  createProjectBundle,
  validateBundle,
  planImport,
  searchRecord,
  recordIndex,
} from "../dist/project-navigator.js";
import { createProjectNavigator } from "../dist/project-navigator-ui.js";
const p = makeProject("michelson");
test("project backup includes selected records and transitive parents without mutating them", () => {
  const a = createLayout(p, "First"),
    b = { ...createLayout(p, "Second"), parentRevisionId: a.id },
    before = JSON.stringify([a, b]);
  const bundle = createProjectBundle([a, b], [b.id], {
    title: "Interferometer",
    notes: "Purpose",
  });
  assert.equal(bundle.records.length, 2);
  assert.equal(bundle.missingReferences.length, 0);
  assert.equal(JSON.stringify([a, b]), before);
  assert.equal(
    validateBundle(JSON.parse(JSON.stringify(bundle))).projectId,
    bundle.projectId,
  );
  const next = createProjectBundle([a, b], [a.id], {
    title: "Review",
    parent: bundle,
  });
  assert.equal(next.parentRevisionId, bundle.id);
  assert.equal(next.projectId, bundle.projectId);
});
test("import plan is idempotent, rejects conflicting or duplicate IDs, and reports missing parents", () => {
  const a = { ...createLayout(p), parentRevisionId: "unavailable" },
    b = createProjectBundle([a], [a.id], { title: "Backup" });
  assert.deepEqual(b.missingReferences, ["unavailable"]);
  assert.equal(planImport(b, []).length, 2);
  assert.equal(planImport(b, [a, b]).length, 0);
  assert.throws(
    () => planImport(b, [{ ...a, title: "Changed" }]),
    /Conflicting/,
  );
  assert.throws(() => validateBundle({ ...b, records: [a, a] }), /Duplicate/);
  assert.throws(
    () => validateBundle({ ...b, missingReferences: "malformed" }),
    /Unsupported/,
  );
});
test("measurement provenance resolves an unambiguous saved sweep and keeps frames in backup", () => {
  const study = simulateRuns(p, {
    parameter: "piston",
    start: 0,
    end: 10,
    count: 2,
    seed: 42,
    detectorId: p.items.find((x) => x.type === "camera").id,
    mirrorId: p.items.find((x) => x.type === "mirror").id,
  });
  const archive = createSweepArchive(study, {
      title: "Sweep",
      revisionName: "First",
    }),
    run = study.rows[0].run;
  const bundle = createProjectBundle([archive, run], [run.id], {
    title: "Sources",
  });
  assert.equal(bundle.records.length, 2);
  assert.equal(bundle.missingReferences.length, 0);
  assert.equal(bundle.records.find((x) => x.id === run.id).frames.length, 4);
  const duplicate = createSweepArchive(study, { revisionName: "Another" });
  assert.equal(recordIndex([archive, duplicate]).has(study.id), false);
});
test("search includes component labels, dates and purpose notes", () => {
  const r = createLayout(p, "Phase study", "Coherence investigation");
  assert.equal(searchRecord(r, "coherence"), true);
  assert.equal(searchRecord(r, p.items[0].label), true);
  assert.equal(searchRecord(r, r.createdAt.slice(0, 10)), true);
  assert.equal(searchRecord(r, "nonexistent-string"), false);
});
test("navigator saves project selections, displays source benches, and dispatches reopening", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<main id="app"></main>';
  const a = createLayout(p, "Bench <A>"),
    data = [a];
  let opened = null;
  const nav = createProjectNavigator({
    getProject: () => p,
    onOpen: async (r) => {
      opened = r;
    },
    archives: { list: async () => data, save: async (r) => data.push(r) },
    runs: { list: async () => [] },
    importRecords: async (rows) => data.push(...rows),
  });
  await nav.open();
  assert.match(
    document.querySelector("#project-navigator").textContent,
    /Recorded source bench/,
  );
  assert.equal(document.querySelector("#project-navigator A"), null);
  const name = document.querySelector('[data-meta="title"]');
  name.value = "My project";
  name.dispatchEvent(new w.Event("input", { bubbles: true }));
  document.querySelector('[data-nav="select"]').click();
  document.querySelector('[data-nav="save"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(data.length, 2);
  assert.equal(data[1].records[0].id, a.id);
  assert.equal(document.querySelector('[data-nav="export"]').disabled, false);
  data[0] = { ...a, title: "Changed live record" };
  await nav.open();
  document.querySelector('[data-nav="open"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(opened.id, a.id);
  assert.equal(opened.title, "Bench <A>");
  assert.equal(document.querySelector("#project-navigator").hidden, true);
});
