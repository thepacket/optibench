import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createInstrumentWorkspace } from "../dist/instrument-ui.js";
import { acquireInstrument } from "../dist/instrument-lab.js";
test("instrument workflow captures, hides truth, repeats, saves and restores recorded settings", async () => {
  const w = new Window();
  for (const k of ["window", "document", "localStorage"])
    globalThis[k] = k === "window" ? w : w[k];
  w.HTMLCanvasElement.prototype.getContext = () => null;
  document.body.innerHTML = '<div id="app"></div>';
  const stored = new Map();
  let measured;
  const ui = createInstrumentWorkspace({
    store: {
      list: async () => [...stored.values()],
      save: async (r) => stored.set(r.id, structuredClone(r)),
    },
    acquire: async (p, c) => acquireInstrument(p, { ...c, n: 64 }),
    onMeasure: async (r) => {
      measured = r;
    },
  });
  await ui.open();
  const root = document.querySelector("#instrument-workspace");
  const click = async (action) => {
    root.querySelector(`[data-lab="${action}"]`).click();
    await new Promise((r) => setTimeout(r, 20));
  };
  await click("acquire");
  assert.match(root.textContent, /Captured 1 acquisition/);
  assert.equal(root.querySelector(".instrument-truth"), null);
  const show = root.querySelector("[data-lab-truth]");
  show.checked = true;
  show.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(
    root.querySelector(".instrument-truth").textContent,
    /not measured/,
  );
  await click("measure");
  assert.equal(measured.frames.length, 4);
  const exposure = root.querySelector('[data-instrument-field="exposure"]');
  exposure.value = "200";
  exposure.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.match(root.textContent, /Settings changed/);
  await click("repeat");
  assert.match(root.textContent, /Three independent simulated acquisitions/);
  await click("save");
  assert.equal(stored.size, 4);
  const select = root.querySelector("[data-lab-saved]");
  select.value = [...stored.keys()][0];
  await click("restore");
  assert.equal(
    root.querySelector('[data-instrument-field="exposure"]').value,
    "100",
  );
  assert.equal(root.querySelector(".instrument-truth"), null);
  assert.equal(root.querySelector("[data-lab-select]").options.length, 4);
  await click("close");
  assert.equal(root.hidden, true);
  assert.equal(document.querySelector("#app").inert, false);
});

test("live bench selection, edits and historical acquisitions remain separate", async () => {
  const { instrumentSetup } = await import("../dist/instrument-lab.js");
  const w = new Window();
  for (const k of ["window", "document", "localStorage"])
    globalThis[k] = k === "window" ? w : w[k];
  w.HTMLCanvasElement.prototype.getContext = () => null;
  document.body.innerHTML = '<div id="app"></div>';
  let bench = instrumentSetup(),
    selectedCamera = 9,
    measured;
  const original = bench.items.find((c) => c.type === "camera");
  bench.items.push({
    ...original,
    id: 9,
    label: "Selected camera",
    exposure: 50,
  });
  original.x += 200;
  const store = new Map();
  const ui = createInstrumentWorkspace({
    getProject: () => structuredClone(bench),
    getDetector: () => selectedCamera,
    onDetector: (id) => (selectedCamera = id),
    onBench: (p) => { bench = structuredClone(p); selectedCamera = 5; },
    onMeasure: async (r) => (measured = r),
    store: {
      list: async () => [...store.values()],
      save: async (r) => store.set(r.id, structuredClone(r)),
    },
    acquire: async (p, c) => acquireInstrument(p, { ...c, n: 64 }),
  });
  await ui.open();
  const root = document.querySelector("#instrument-workspace");
  const click = async (a) => {
    root.querySelector(`[data-lab="${a}"]`).click();
    await new Promise((r) => setTimeout(r, 20));
  };
  assert.equal(root.querySelector("[data-lab-camera]").value, "9");
  await click("acquire");
  await click("measure");
  assert.equal(measured.simulation.camera.id, 9);
  assert.equal(measured.simulation.camera.exposure, 50);
  const first = JSON.stringify(measured);
  await click("save");
  await click("close");
  bench.items.find((c) => c.id === 9).exposure = 100;
  bench.items.find((c) => c.type === "mirror").pistonNm = 20;
  await ui.open();
  assert.match(root.textContent, /Settings changed/);
  assert.equal(
    root.querySelector('[data-instrument-field="exposure"]').value,
    "100",
  );
  const exposure = root.querySelector('[data-instrument-field="exposure"]');
  exposure.value = "150";
  exposure.dispatchEvent(new w.Event("change", { bubbles: true }));
  assert.equal(bench.items.find((c) => c.id === 9).exposure, 150);
  assert.equal(JSON.stringify(measured), first);
  await click("acquire");
  await click("measure");
  assert.equal(measured.simulation.camera.exposure, 150);
  assert.equal(
    measured.project.items.find((c) => c.type === "mirror").pistonNm,
    20,
  );
  root.querySelector("[data-lab-saved]").value = [...store.keys()][0];
  await click("restore");
  assert.equal(bench.items.find((c) => c.id === 9).exposure, 150);
  await click("apply-record");
  assert.equal(bench.items.find((c) => c.id === 9).exposure, 50);
  bench.items = bench.items.filter((c) => c.type !== "camera");
  await ui.open();
  assert.equal(root.querySelector('[data-lab="acquire"]').disabled, true);
});
