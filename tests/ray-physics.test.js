import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCustomMaterials,
  materialValue,
  parseMaterialTable,
} from "../dist/ray3-materials.js";
import {
  coatingResponse,
  coatingPreset,
  coatedBranches,
} from "../dist/ray3-coatings.js";
import { fresnel, initialFields, fieldPower } from "../dist/ray3-fresnel.js";
import { cosineDirection, seededScatter } from "../dist/ray3-scattering.js";
import {
  rayExample,
  expandedRayExample,
  traceNonsequential,
  validateRayScene,
  groupDetectorPaths,
  parseRayScene,
} from "../dist/nonsequential.js";
import {
  runRayStudy,
  studyPlan,
  convergenceVerdict,
  rayStudyCSV,
} from "../dist/ray-studies.js";
import { makeProject } from "../dist/project.js";
import { createNonsequentialWorkspace } from "../dist/nonsequential-ui.js";
import { Window } from "happy-dom";
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
function plate() {
  const s = rayExample("plate");
  s.objects[0].normal = [1, 0, 0];
  s.objects[0].material = "ideal15";
  s.options.rays = 1;
  s.sources[0].waist = 0;
  s.options.maxDepth = 64;
  s.options.minPowerFraction = 1e-14;
  return s;
}
const settings = {
  kind: "wavelength",
  sourceId: "source",
  detectorId: "detector",
  objectId: "glass",
  start: 450,
  end: 650,
  count: 5,
};

test("custom materials validate bounds, interpolate index and attenuation, preserve provenance and forbid extrapolation", () => {
  const m = {
    id: "custom-test",
    name: "User material",
    provenance: "Test assumption",
    samples: parseMaterialTable("400, 1.6, .1\n700, 1.5, .4"),
  };
  validateCustomMaterials([m]);
  near(materialValue(m.id, 550, [m]).n, 1.55);
  near(materialValue(m.id, 550, [m]).alpha, 0.25);
  assert.throws(() => materialValue(m.id, 800, [m]), /extrapolation/);
  assert.throws(() => parseMaterialTable("500,1.5,0\n400,1.6,0"));
  const s = plate();
  s.materials = [m];
  s.objects[0].material = m.id;
  const imported = parseRayScene(JSON.stringify(s));
  assert.equal(imported.materials[0].provenance, m.provenance);
  s.sources[0].wavelength = 800;
  assert.throws(() => validateRayScene(s), /outside/);
});
test("Beer–Lambert absorption and all plate reflections match the analytic geometric series", () => {
  const s = plate(),
    alpha = 0.1,
    t = s.objects[0].thickness,
    a = Math.exp(-alpha * t),
    R = 0.04;
  s.objects[0].bulkAlpha = alpha;
  const r = traceNonsequential(s),
    T = ((1 - R) ** 2 * a) / (1 - R ** 2 * a * a),
    back = R + ((1 - R) ** 2 * R * a * a) / (1 - R ** 2 * a * a);
  near(r.detectors.find((d) => d.id === "detector").power, T, 1e-12);
  near(r.detectors.find((d) => d.id === "return").power, back, 1e-12);
  near(r.ledger.bulkAbsorbed, 1 - T - back, 1e-12);
  near(r.ledger.absorbed, 0);
  near(r.ledger.residual, 0);
  near(r.surfaceStats.glass.bulkAbsorbed, r.ledger.bulkAbsorbed);
  assert.ok(r.segments.some((s) => s.inputPower > s.power));
});
test("zero-thickness stacks reproduce bare Fresnel amplitudes at oblique incidence", () => {
  for (const angle of [0, 20, 50, 75]) {
    const ci = Math.cos((angle * Math.PI) / 180),
      f = fresnel(1, 1.5, ci),
      c = coatingResponse(1, 1.5, ci, 633, [
        { n: 2.1, thicknessNm: 0 },
        { n: 1.2, thicknessNm: 0 },
      ]);
    for (const k of ["Rs", "Rp", "Ts", "Tp"]) near(c[k], f[k], 1e-10);
    near(c.rs[0], f.rs[0]);
    near(c.rp[0], f.rp[0]);
  }
});
test("quarter-wave AR null and multilayer reflector match independent normal-incidence admittance formulas", () => {
  const ar = coatingResponse(1, 1.5, 1, 550, coatingPreset("ar"));
  assert.ok(ar.Rs < 1e-25);
  near(ar.Ts, 1);
  assert.ok(coatingResponse(1, 1.5, 1, 450, coatingPreset("ar")).Rs > 0.001);
  const layers = coatingPreset("reflector"),
    y = 1.5 * (2.1 / 1.45) ** 8,
    expected = ((1 - y) / (1 + y)) ** 2;
  near(coatingResponse(1, 1.5, 1, 550, layers).Rs, expected, 1e-12);
});
test("coatings conserve flux, reverse correctly, retain complex phase and allow evanescent film tunneling", () => {
  const layers = [
      { n: 2.1, thicknessNm: 83 },
      { n: 1.38, thicknessNm: 121 },
    ],
    ci = 0.8,
    n = 1.52,
    ct = Math.sqrt(1 - (1 - ci * ci) / n ** 2),
    a = coatingResponse(1, n, ci, 632.8, layers),
    b = coatingResponse(n, 1, ct, 632.8, [...layers].reverse());
  near(a.Rs, b.Rs);
  near(a.Tp, b.Tp);
  near(a.Rs + a.Ts, 1);
  near(a.Rp + a.Tp, 1);
  assert.ok(Math.abs(a.rs[1]) > 0.01);
  const f = coatingResponse(1.5, 1.5, 0.5, 633, [{ n: 1, thicknessNm: 30 }]);
  assert.ok(f.Ts > 0 && f.Ts < 1);
  near(f.Rs + f.Ts, 1);
  const branches = coatedBranches(
    [1, 0, 0],
    [-1, 0, 0],
    initialFields([1, 0, 0], 1, 45, 20),
    1,
    1.5,
    550,
    layers,
  );
  near(
    branches.reduce((s, b) => s + fieldPower(b.fields), 0),
    1,
  );
});
test("coated closed volumes retain power closure and AR suppresses the first ghost", () => {
  const s = plate();
  s.sources[0].wavelength = 550;
  const bare = traceNonsequential(s);
  s.objects[0].coating = coatingPreset("ar");
  const coated = traceNonsequential(s);
  near(coated.detectors.find((d) => d.id === "detector").power, 1, 1e-12);
  assert.ok(groupDetectorPaths(bare, { reflections: 2 }).length > 0);
  assert.equal(groupDetectorPaths(coated, { reflections: 2 }).length, 0);
  near(coated.ledger.residual, 0);
});
test("Lambertian directions have the cosine-weighted moments and reproducible seed", () => {
  const random = seededScatter(42),
    other = seededScatter(42);
  near(random(), other());
  const n = 20000;
  let z = 0,
    z2 = 0;
  for (let i = 0; i < n; i++) {
    const d = cosineDirection([0, 0, 1], random(), random());
    z += d[2];
    z2 += d[2] ** 2;
    assert.ok(d[2] >= 0);
    near(Math.hypot(...d), 1);
  }
  near(z / n, 2 / 3, 0.006);
  near(z2 / n, 0.5, 0.006);
});
test("diffuse collection matches Lambertian solid-angle integral and tags scattered power without double counting", () => {
  const s = expandedRayExample("diffuse");
  s.options.rays = 2048;
  const r = traceNonsequential(s),
    d = r.detectors[0];
  near(d.power, 0.8 * 0.5, 0.025);
  near(r.ledger.absorbed, 0.2);
  near(r.ledger.residual, 0);
  assert.equal(groupDetectorPaths(r, { scattering: "exclude" }).length, 0);
  assert.equal(
    groupDetectorPaths(r, { scattering: "only" })[0].scatterCount,
    1,
  );
  assert.ok(r.detectorHits.every((h) => h.fields.length === 2));
  const second = traceNonsequential(s);
  near(second.detectors[0].power, d.power);
  s.options.seed++;
  assert.notDeepEqual(traceNonsequential(s).detectors[0].pixels, d.pixels);
});
test("spectral and angle studies retain settings, power categories, and source scene without mutation", () => {
  const s = expandedRayExample("coated"),
    before = JSON.stringify(s),
    r = runRayStudy(s, settings);
  assert.equal(r.status, "completed");
  assert.equal(r.rows.length, 5);
  assert.equal(JSON.stringify(s), before);
  assert.ok(r.rows[2].result.power > r.rows[0].result.power);
  assert.match(rayStudyCSV(r), /unresolved_fraction/);
  const angle = runRayStudy(s, {
    ...settings,
    kind: "angle",
    start: 0,
    end: 45,
    count: 3,
  });
  assert.equal(angle.rows.length, 3);
  assert.ok(angle.rows[0].result.power > angle.rows[2].result.power);
});
test("studies preflight every wavelength, cap work, and keep completed points on cancellation", () => {
  const s = expandedRayExample("absorption");
  s.materials[0].samples = [
    [500, 1.5, 0],
    [600, 1.5, 0.1],
  ];
  assert.throws(() => studyPlan(s, settings), /outside/);
  const p = plate();
  assert.throws(() => studyPlan(p, { ...settings, count: 30 }), /2–15/);
  p.options.maxSegments = 100000;
  assert.throws(() => studyPlan(p, { ...settings, count: 10 }), /500,000/);
  p.options.maxSegments = 1000;
  let stop = false;
  const r = runRayStudy(p, settings, {
    cancelled: () => stop,
    onEvent: (e) => {
      if (e.type === "study-row") stop = true;
    },
  });
  assert.equal(r.status, "cancelled");
  assert.equal(r.rows.length, 1);
});
test("convergence requires signal, bounded unresolved power and two final refinements in both power and map", () => {
  const s = plate(),
    r = runRayStudy(s, {
      kind: "convergence",
      detectorId: "detector",
      levels: [8, 16, 32],
      tolerance: 0.01,
    });
  assert.equal(r.convergence.status, "stable at tested levels");
  const rows = structuredClone(r.rows);
  rows[2].result.unresolvedFraction = 0.01;
  assert.equal(convergenceVerdict(rows, 0.01).status, "not resolved");
  rows[2].result.power = 0;
  assert.equal(convergenceVerdict(rows, 0.01).status, "inconclusive");
  assert.equal(
    convergenceVerdict(rows.slice(0, 2), 0.01).status,
    "inconclusive",
  );
});
test("physics UI edits materials and coating layers, runs studies, saves and restores study inputs", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLAnchorElement.prototype.click = () => {};
  const saved = new Map();
  const ui = createNonsequentialWorkspace({
    getProject: () => makeProject("focus"),
    store: {
      list: async () => [...saved.values()],
      save: async (r) => saved.set(r.id, structuredClone(r)),
    },
    execute: async (s) => traceNonsequential(s),
    executeStudy: async (s, q, o) => runRayStudy(s, q, o),
  });
  try {
    await ui.open();
    const root = document.getElementById("nonsequential-workspace"),
      click = async (a) => {
        root.querySelector(`[data-ray="${a}"]`).click();
        await new Promise((r) => setTimeout(r, 20));
      };
    await click("example-coated");
    const select = root.querySelector("[data-object-select]");
    select.value = "0";
    select.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.ok(root.querySelector("[data-layer]"));
    await click("add-layer");
    assert.equal(root.querySelectorAll("[data-layer]").length, 2);
    await click("coating-ar");
    assert.equal(root.querySelectorAll("[data-layer]").length, 1);
    await click("add-material");
    const box = root.querySelector("[data-custom-material]");
    box.querySelector("[data-custom-name]").value = "My data";
    await click("update-material");
    assert.match(root.textContent, /My data/);
    await click("study");
    assert.match(root.textContent, /Study completed/);
    await click("study-save");
    assert.equal(saved.size, 1);
    root.querySelector("[data-history]").value = [...saved.keys()][0];
    await click("open");
    assert.match(root.textContent, /Saved record opened/);
    await click("study-json");
    await click("study-csv");
    await click("study-replay");
    assert.match(root.textContent, /Study inputs restored/);
  } finally {
    await w.happyDOM.abort();
  }
});

test("cancelled study discards an unfinished trace and UI ignores late completion", async () => {
  let stop = false;
  const partial = runRayStudy(plate(), settings, {
    cancelled: () => stop,
    trace: (s) => {
      const r = traceNonsequential(s);
      stop = true;
      return r;
    },
  });
  assert.equal(partial.rows.length, 0);
  assert.equal(partial.status, "cancelled");
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  let finish;
  const ui = createNonsequentialWorkspace({
    getProject: () => makeProject("focus"),
    store: { list: async () => [] },
    executeStudy: async (s, q, { onEvent }) => {
      const complete = runRayStudy(s, q);
      onEvent({
        type: "study-start",
        study: { ...structuredClone(complete), status: "running", rows: [] },
      });
      onEvent({ type: "study-row", row: complete.rows[0] });
      return new Promise((r) => {
        finish = () => r(complete);
      });
    },
  });
  try {
    await ui.open();
    const root = document.getElementById("nonsequential-workspace");
    root.querySelector('[data-ray="example-coated"]').click();
    root.querySelector('[data-ray="study"]').click();
    await new Promise((r) => setTimeout(r, 10));
    root.querySelector('[data-ray="cancel"]').click();
    finish();
    await new Promise((r) => setTimeout(r, 10));
    assert.match(root.textContent, /cancelled · 1 completed points/);
    assert.doesNotMatch(root.textContent, /completed · 7 completed points/);
  } finally {
    await w.happyDOM.abort();
  }
});
