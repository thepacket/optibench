import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  archiveStore,
  runStore,
  importProjectRecords,
  changeStoredRecord,
} from "../dist/run-store.js";
import { makeProject } from "../dist/project.js";
import { checkSampling } from "../dist/sampling-check.js";
import { Window } from "happy-dom";
import { TaskWorker } from "../dist/task-worker.js";
import { showWorkspace, closeWorkspace } from "../dist/workspace-state.js";
test("cross-store imports rollback on conflict, and trash restores exact source evidence", async () => {
  const a = {
      id: "qa-run",
      format: "optibench-measurement",
      source: [1, 2, 3],
    },
    b = { id: "qa-archive", format: "optibench-layout" };
  await importProjectRecords([a, b]);
  assert.equal((await runStore.list()).length, 1);
  await assert.rejects(
    importProjectRecords([
      { id: "should-rollback", format: "optibench-layout" },
      b,
    ]),
    /changed/,
  );
  assert.equal(
    (await archiveStore.list()).some((x) => x.id === "should-rollback"),
    false,
  );
  await changeStoredRecord("trash", a);
  assert.equal((await runStore.list()).length, 0);
  const trash = (await archiveStore.list()).find(
    (x) => x.format === "optibench-trash",
  );
  assert.deepEqual(trash.record, a);
  await changeStoredRecord("restore", trash);
  assert.deepEqual((await runStore.list())[0], a);
  await assert.rejects(changeStoredRecord("purge", b), /Only trash/);
  assert.ok((await archiveStore.list()).some((x) => x.id === b.id));
});
test("sampling stability evaluates all three grids and reports successive changes", () => {
  const p = makeProject("michelson"),
    r = checkSampling(p, p.items.find((x) => x.type === "camera").id);
  assert.deepEqual(
    r.rows.map((x) => x.n),
    [64, 128, 256],
  );
  assert.ok(r.rows.every((x) => x.status === "complete"));
  assert.equal(r.rows[0].change, null);
  assert.equal(
    r.rows[2].change.visibility,
    r.rows[2].visibility - r.rows[1].visibility,
  );
});
test("job cancellation rejects through the result channel and clears progress UI", () => {
  const w = new Window();
  globalThis.document = w.document;
  let stopped = false;
  globalThis.Worker = class {
    postMessage() {}
    terminate() {
      stopped = true;
    }
  };
  const job = new TaskWorker("simulation-worker.js", { type: "module" });
  let error;
  job.onmessage = ({ data }) => (error = data.error);
  job.cancel();
  assert.match(error, /cancelled/);
  assert.equal(stopped, true);
  assert.equal(document.querySelector(".task-progress"), null);
});
test("switching workspaces hides the prior surface and closing restores the bench", () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML =
    '<main id="app"></main><section id="simulation-workspace"></section><section id="alignment-study-workspace"></section>';
  const a = document.getElementById("simulation-workspace"),
    b = document.getElementById("alignment-study-workspace");
  showWorkspace(b);
  assert.equal(a.hidden, true);
  assert.equal(document.getElementById("app").inert, true);
  closeWorkspace(b);
  assert.equal(document.getElementById("app").inert, false);
});
test("successful jobs remove progress immediately on the terminal response", () => {
  const w = new Window();
  globalThis.document = w.document;
  let native;
  globalThis.Worker = class {
    constructor() {
      native = this;
    }
    postMessage() {}
    terminate() {}
  };
  const job = new TaskWorker("simulation-worker.js", {});
  let result;
  job.onmessage = ({ data }) => (result = data.result);
  native.onmessage({ data: { result: 42 } });
  assert.equal(result, 42);
  assert.equal(document.querySelector(".task-progress"), null);
});
