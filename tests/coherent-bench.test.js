import test from "node:test";
import assert from "node:assert/strict";
import { makeProject } from "../dist/project.js";
import { instantiate, catalog } from "../dist/catalog.js";
import {
  discoverCoherentPaths,
  propagateCoherentBench,
  acquireCoherentCamera,
  acquireCoherentPhase,
  coherentBenchExample,
} from "../dist/coherent-bench.js";
import { gaussianQ, propagateQ, lensQ, beamRadius } from "../dist/optics.js";
import { createCoherentBenchWorkspace } from "../dist/coherent-bench-ui.js";
import { Window } from "happy-dom";
const near = (a, b, t = 1e-8) =>
  assert.ok(Math.abs(a - b) <= t, `${a} != ${b} ± ${t}`);
function aligned(template = "michelson") {
  const p = makeProject(template);
  p.items.find((c) => c.type === "mirror" && c.label.includes("M1")).angle -=
    0.015;
  return p;
}
function settings(p, n = 128, width = 8) {
  return { n, width, detectorId: p.items.find((c) => c.type === "camera").id };
}
function straight() {
  const p = makeProject("michelson");
  p.items = [
    instantiate("DESIGN-LASER-633", 1, 100, 450, {
      waist: 0.4,
      power: 0.00001,
      angle: 0,
    }),
    instantiate("DESIGN-CAMERA", 2, 1000, 450, { angle: 0, exposure: 5 }),
  ];
  return p;
}
test("aligned Michelson and Mach-Zehnder conserve two-port power and piston swaps bright/dark ports", () => {
  for (const template of ["michelson", "mach-zehnder"]) {
    const p = aligned(template),
      src = p.items.find((c) => c.type === "source"),
      mirror = p.items.find((c) => c.label.includes("M1")),
      detectors = p.items.filter((c) => ["camera", "power"].includes(c.type));
    p.items.find((c) => c.type === "camera").pixelsX = 4096;
    p.items.find((c) => c.type === "camera").pixelsY = 4096;
    src.ellipticity = 20;
    src.polarization = 33;
    const collect = () =>
      detectors.map(
        (c) =>
          propagateCoherentBench(p, { ...settings(p), detectorId: c.id }).power,
      );
    const before = collect();
    near(
      before.reduce((s, v) => s + v),
      src.power,
      src.power * 1e-5,
    );
    assert.ok(before[0] > 0.99 * src.power);
    assert.ok(before[1] < src.power * 1e-10);
    mirror.pistonNm =
      src.wavelength /
      (4 * Math.cos(((template === "michelson" ? 0 : 45) * Math.PI) / 180));
    const after = collect();
    near(
      after.reduce((s, v) => s + v),
      src.power,
      src.power * 1e-5,
    );
    assert.ok(after[0] < src.power * 1e-8);
    assert.ok(after[1] > 0.99 * src.power);
  }
});
test("field amplitude after centered thin lens matches independent Gaussian ABCD radius", () => {
  const p = straight();
  p.items.push(
    instantiate(
      catalog.find((c) => c.type === "lens"),
      3,
      500,
      450,
      { angle: 0, f: 800, aperture: 20, transmission: 1 },
    ),
  );
  const r = propagateCoherentBench(p, settings(p, 256, 4));
  let moment = 0;
  for (let y = 0; y < r.n; y++)
    for (let x = 0; x < r.n; x++)
      moment +=
        r.values[y * r.n + x] *
        (((x + 0.5 - r.n / 2) * r.dx) ** 2 + ((y + 0.5 - r.n / 2) * r.dx) ** 2);
  const q = propagateQ(lensQ(propagateQ(gaussianQ(0.4, 633), 400), 800), 500);
  near(Math.sqrt((2 * moment) / r.power), beamRadius(q, 633), 0.004);
});
test("finite iris masks the actual field and introduces diffracted structure inside a folded arm", () => {
  const p = coherentBenchExample(),
    before = JSON.stringify(p),
    r = propagateCoherentBench(p, settings(p));
  assert.equal(r.paths.length, 2);
  const arm = r.paths.find((b) => b.steps.some((s) => s.type === "lens"));
  assert.ok(arm.planes.some((s) => s.after < s.before * 0.9));
  assert.ok(r.values.every(Number.isFinite));
  assert.equal(JSON.stringify(p), before);
  p.items.find((c) => c.type === "aperture").aperture = 8;
  const open = propagateCoherentBench(p, settings(p));
  assert.ok(open.baselinePower > r.baselinePower);
  assert.notDeepEqual(open.values, r.values);
});
test("nested splitter arrangements propagate three coherent paths without two-arm restriction", () => {
  const p = aligned();
  p.items.push(
    instantiate("DESIGN-BS-50", 100, 850, 450, { angle: 45 }),
    instantiate("DESIGN-MIRROR-25.4", 101, 850, 250, {
      angle: 90,
      reflectivity: 1,
    }),
    instantiate("DESIGN-POWER", 102, 850, 650, { angle: 90 }),
  );
  const r = propagateCoherentBench(p, settings(p));
  assert.equal(r.paths.length, 3);
  assert.ok(r.values.every((v) => Number.isFinite(v) && v >= 0));
  assert.throws(
    () =>
      acquireCoherentPhase(p, settings(p), {
        mirrorId: p.items.find((c) => c.type === "mirror").id,
      }),
    /exactly two/,
  );
});
test("orthogonal arm polarization removes interference and Jones propagation remains supported through folds", () => {
  const p = aligned();
  p.items.push(
    instantiate(
      {
        id: "custom-waveplate",
        type: "waveplate",
        diameter: 25.4,
        transmission: 1,
        axis: 45,
        retardance: 90,
      },
      100,
      850,
      450,
      { angle: 0 },
    ),
  );
  const r = propagateCoherentBench(p, settings(p));
  near(r.power, r.baselinePower, r.baselinePower * 1e-7);
});
test("short coherence suppresses cross terms for unequal arm optical lengths", () => {
  const p = aligned();
  p.items.find((c) => c.type === "source").coherenceLength = 0.001;
  p.items.find((c) => c.label.includes("M1")).x -= 10;
  const r = propagateCoherentBench(p, settings(p));
  near(r.power, r.baselinePower, 1e-15);
  assert.ok(r.coherence[0][1] < 1e-10);
});
test("unsupported cavities, noncoplanar paths, decentered lenses and insufficient fringe sampling fail explicitly", () => {
  const p = aligned();
  p.items.find((c) => c.type === "mirror").pitch = 0.01;
  assert.throws(
    () => discoverCoherentPaths(p, settings(p).detectorId),
    /coplanar/,
  );
  const c = straight();
  c.items = [
    c.items[0],
    c.items[1],
    instantiate("DESIGN-MIRROR-25.4", 3, 800, 450, {
      angle: 0,
      reflectivity: 1,
    }),
    instantiate("DESIGN-MIRROR-25.4", 4, 50, 450, {
      angle: 0,
      reflectivity: 1,
    }),
  ];
  assert.throws(() => discoverCoherentPaths(c, 2), /recurrent/);
  const l = straight();
  l.items.push(
    instantiate(
      catalog.find((c) => c.type === "lens"),
      3,
      500,
      450.1,
      { angle: 0, f: 800 },
    ),
  );
  assert.throws(() => discoverCoherentPaths(l, 2), /centered/);
  const t = aligned();
  t.items.find((c) => c.label.includes("M1")).angle = 0.15;
  assert.throws(
    () => propagateCoherentBench(t, settings(t)),
    /samples per fringe/,
  );
});
test("computational boundary diagnostics identify truncated source fields", () => {
  const p = aligned(),
    r = propagateCoherentBench(p, settings(p, 128, 2));
  assert.ok(r.warnings.some((w) => w.includes("source field is truncated")));
  assert.ok(r.maximumEdge > 0.001);
});
test("camera acquisition uses reproducible noise and propagates real irradiance into saturation", () => {
  const p = aligned();
  p.items.find((c) => c.type === "camera").exposure = 5;
  const r = propagateCoherentBench(p, settings(p)),
    a = acquireCoherentCamera(r, { seed: 17 }),
    b = acquireCoherentCamera(r, { seed: 17 });
  assert.deepEqual(a.values, b.values);
  assert.notDeepEqual(a.values, acquireCoherentCamera(r, { seed: 18 }).values);
  r.project.items.find((c) => c.type === "camera").exposure = 10000;
  assert.ok(acquireCoherentCamera(r, { noise: false }).saturated > 0.9);
});
test("four physical piston steps retain frozen camera frames and connect to existing phase reconstruction", () => {
  const p = coherentBenchExample();
  p.items.find((c) => c.type === "camera").exposure = 5;
  const snapshot = JSON.stringify(p),
    mirrorId = p.items.find((c) => c.label.includes("M1")).id,
    r = acquireCoherentPhase(p, settings(p), { mirrorId, seed: 42 });
  assert.equal(r.format, "optibench-measurement");
  assert.equal(r.frames.length, 4);
  assert.equal(r.simulation.analysisError, null);
  assert.ok(r.result.stats.validFraction > 0.9);
  near(r.simulation.stepNm, 633 / 8);
  assert.equal(JSON.stringify(p), snapshot);
  assert.deepEqual(r.simulation.phaseSeeds, [42, 43, 44, 45]);
});
test("coherent workspace propagates captures camera saves restores and hands phase data to Measure", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLAnchorElement.prototype.click = () => {};
  const records = new Map();
  let measured;
  const ui = createCoherentBenchWorkspace({
    getProject: () => aligned(),
    store: {
      list: async () => [...records.values()],
      save: async (r) => records.set(r.id, structuredClone(r)),
    },
    onMeasure: (r) => (measured = r),
    execute: async (d) =>
      d.mode === "phase"
        ? acquireCoherentPhase(d.project, d.settings, d.acquisition)
        : propagateCoherentBench(d.project, d.settings),
  });
  try {
    await ui.open();
    const root = document.getElementById("coherent-bench-workspace"),
      click = async (a) => {
        root.querySelector(`[data-coherent="${a}"]`).click();
        await new Promise((r) => setTimeout(r, 10));
      };
    await click("propagate");
    assert.match(root.textContent, /Coherent collected power/);
    await click("camera");
    assert.match(root.textContent, /Camera ADC/);
    await click("save");
    assert.equal(records.size, 1);
    const width = root.querySelector('[data-coherent-setting="width"]');
    width.value = "10";
    width.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.match(root.textContent, /Inputs changed/);
    root.querySelector("[data-coherent-history]").value = [
      ...records.keys(),
    ][0];
    await click("open");
    assert.equal(
      root.querySelector('[data-coherent-setting="width"]').value,
      "8",
    );
    await click("phase");
    await click("measure");
    assert.equal(measured.format, "optibench-measurement");
    await click("export");
    await click("export-phase");
    await click("close");
    assert.equal(document.getElementById("app").inert, false);
  } finally {
    await w.happyDOM.abort();
  }
});
test("coherent workspace cancellation discards late results", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  let finish;
  const ui = createCoherentBenchWorkspace({
    getProject: () => aligned(),
    store: { list: async () => [] },
    execute: (d) =>
      new Promise(
        (r) =>
          (finish = () => r(propagateCoherentBench(d.project, d.settings))),
      ),
  });
  try {
    await ui.open();
    const root = document.getElementById("coherent-bench-workspace");
    root.querySelector('[data-coherent="propagate"]').click();
    ui.cancel();
    finish();
    await new Promise((r) => setTimeout(r, 10));
    assert.match(root.textContent, /Cancelled/);
    assert.equal(root.querySelector("[data-coherent-map]"), null);
  } finally {
    await w.happyDOM.abort();
  }
});
