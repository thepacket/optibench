import test from "node:test";
import assert from "node:assert/strict";
import {
  add,
  sub,
  scale,
  dot,
  unit,
  axes,
  normalAngles,
  intersectSurface,
  nearestSurface,
} from "../dist/ray3-geometry.js";
import {
  fresnel,
  interfaceBranches,
  fieldPower,
  initialFields,
} from "../dist/ray3-fresnel.js";
import { indexAt } from "../dist/ray3-materials.js";
import {
  newRayScene,
  newRayObject,
  rayExample,
  traceNonsequential,
  validateRayScene,
  groupDetectorPaths,
  sceneFromBench,
  parseRayScene,
} from "../dist/nonsequential.js";
import {
  raySceneSVG,
  detectorCSV,
  pathCSV,
} from "../dist/nonsequential-view.js";
import { makeProject } from "../dist/project.js";
import { Window } from "happy-dom";
import { createNonsequentialWorkspace } from "../dist/nonsequential-ui.js";
const near = (a, b, t = 1e-9) => assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
function plateScene() {
  const s = rayExample("plate");
  s.objects[0].normal = [1, 0, 0];
  s.objects[0].material = "ideal15";
  s.options.rays = 1;
  s.options.maxDepth = 64;
  s.options.minPowerFraction = 1e-14;
  s.sources[0].waist = 0;
  return s;
}

test("3D finite intersections use full XYZ geometry, surface normals and nearest positive distance", () => {
  const p = newRayObject("plate", "p");
  p.center = [10, 2, 3];
  p.width = 4;
  p.height = 6;
  p.thickness = 2;
  const h = intersectSurface([0, 2, 3], [1, 0, 0], p);
  near(h.distance, 9);
  assert.deepEqual(h.normal, [-1, 0, 0]);
  assert.equal(intersectSurface([0, 2, 8], [1, 0, 0], p), null);
  const b = newRayObject("sphere", "b");
  b.center = [20, 2, 3];
  b.radius = 2;
  assert.equal(nearestSurface([0, 2, 3], [1, 0, 0], [b, p]).object.id, "p");
  near(intersectSurface([20, 2, 3], [0, 0, 1], b).distance, 2);
  p.normal = normalAngles(30, 20);
  const normal = p.normal;
  near(
    intersectSurface(sub(p.center, scale(normal, 20)), normal, p).distance,
    19,
  );
});

test("Sellmeier dispersion matches SCHOTT reference lines and enforces the supported band", () => {
  near(indexAt("N-BK7", 587.6), 1.5168, 5e-6);
  near(indexAt("N-BK7", 486.1), 1.52238, 5e-6);
  near(indexAt("N-BK7", 656.3), 1.51432, 5e-6);
  assert.ok(indexAt("N-BK7", 450) > indexAt("N-BK7", 1000));
  assert.throws(() => indexAt("N-BK7", 200));
  assert.throws(() => indexAt("unknown", 633));
});

test("Fresnel amplitudes match normal incidence, Brewster angle, critical angle and energy conservation", () => {
  const f = fresnel(1, 1.5, 1);
  near(f.Rs, 0.04);
  near(f.Rp, 0.04);
  near(f.Ts, 0.96);
  const brewster = fresnel(1, 1.5, Math.cos(Math.atan(1.5)));
  near(brewster.Rp, 0, 1e-25);
  assert.ok(brewster.Rs > 0.1);
  for (const angle of [0, 10, 40, 60, 89.999]) {
    const q = fresnel(1, 1.5, Math.cos((angle * Math.PI) / 180));
    near(q.Rs + q.Ts, 1);
    near(q.Rp + q.Tp, 1);
  }
  const t = fresnel(1.5, 1, Math.cos(Math.PI / 3));
  assert.equal(t.tir, true);
  near(t.Rs, 1);
  near(t.Rp, 1);
  assert.notEqual(t.rs[1], 0);
  assert.notEqual(t.rp[1], 0);
  assert.equal(t.Ts, 0);
  const equal = fresnel(1, 1, 0);
  near(equal.Ts, 1);
});

test("polarized branches obey Snell and remain transverse after non-coplanar encounters", () => {
  let d = unit([1, 0.3, 0.2]),
    fields = initialFields(d, 2, 32, 21);
  const n = unit([-1, 0.1, 0.2]),
    ci = -dot(d, n),
    branches = interfaceBranches(d, n, fields, 1, 1.5),
    t = branches.find((b) => b.event === "T");
  near(Math.sqrt(1 - dot(t.direction, n) ** 2) * 1.5, Math.sqrt(1 - ci ** 2));
  near(
    branches.reduce((s, b) => s + fieldPower(b.fields), 0),
    2,
  );
  for (const branch of branches)
    for (const f of branch.fields) {
      near(
        dot(
          f.map((v) => v[0]),
          branch.direction,
        ),
        0,
      );
      near(
        dot(
          f.map((v) => v[1]),
          branch.direction,
        ),
        0,
      );
    }
  const next = interfaceBranches(
    t.direction,
    unit([-0.8, -0.2, -0.5]),
    t.fields,
    1.5,
    1,
  );
  near(
    next.reduce((s, b) => s + fieldPower(b.fields), 0),
    fieldPower(t.fields),
  );
});

test("incoherent plane-parallel plate sums the infinite reflection series and resolves ghost sequences", () => {
  const r = traceNonsequential(plateScene()),
    transmitted = r.detectors.find((d) => d.id === "detector"),
    returned = r.detectors.find((d) => d.id === "return"),
    R = 0.04;
  near(transmitted.power, (1 - R) / (1 + R), 1e-12);
  near(returned.power, (2 * R) / (1 + R), 1e-12);
  near(r.ledger.residual, 0, 1e-12);
  const paths = groupDetectorPaths(r, { detectorId: "detector" });
  near(paths.find((p) => p.reflections === 0).power, (1 - R) ** 2);
  near(paths.find((p) => p.reflections === 2).power, (1 - R) ** 2 * R ** 2);
  assert.ok(paths.find((p) => p.reflections === 4));
  near(
    transmitted.irradiance.reduce((s, v) => s + v, 0) * transmitted.pixelArea,
    transmitted.power,
  );
  assert.ok(r.surfaceStats.glass.encounters > 4);
});

test("tilted plate returns parallel rays with the analytic lateral displacement", () => {
  const s = plateScene();
  s.objects[0].normal = normalAngles(20);
  const r = traceNonsequential(s),
    hit = r.detectorHits.find(
      (h) =>
        h.detectorId === "detector" &&
        h.path.filter((p) => p.event === "R").length === 0,
    ),
    theta = (20 * Math.PI) / 180,
    refracted = Math.asin(Math.sin(theta) / 1.5),
    delta =
      (s.objects[0].thickness * Math.sin(theta - refracted)) /
      Math.cos(refracted);
  near(hit.direction[0], 1);
  near(hit.direction[1], 0);
  near(hit.point[1] - 450, delta, 1e-6);
});

test("spherical surfaces agree with paraxial thick-lens and ball-lens back focal distances", () => {
  for (const kind of ["lens", "sphere"]) {
    const s = rayExample(kind);
    s.options.rays = 1;
    s.sources[0].position[1] += 0.001;
    s.sources[0].waist = 0;
    s.objects[0].material = "ideal15";
    const r = traceNonsequential(s),
      h = r.detectorHits.find(
        (h) =>
          h.detectorId === "detector" &&
          h.path.filter((p) => p.event === "R").length === 0,
      ),
      o = s.objects[0],
      n = 1.5;
    const f =
        kind === "sphere"
          ? (n * o.radius) / (2 * (n - 1))
          : 1 /
            ((n - 1) *
              (2 / o.radius - ((n - 1) * o.thickness) / (n * o.radius ** 2))),
      bfl =
        kind === "sphere"
          ? f - o.radius
          : f * (1 - ((n - 1) * o.thickness) / (n * o.radius)),
      exit = o.center[0] + (kind === "sphere" ? o.radius : o.thickness / 2),
      focus =
        h.point[0] - ((h.point[1] - 450) / h.direction[1]) * h.direction[0];
    near(focus, exit + bfl, 1e-4);
  }
});

test("ideal splitter, absorption, escaped rays and truncation preserve explicit terminal accounting", () => {
  const s = plateScene();
  s.objects[0] = {
    ...s.objects[0],
    kind: "splitter",
    reflectivity: 0.3,
    transmission: 0.5,
  };
  const r = traceNonsequential(s);
  near(r.ledger.detected, 0.8);
  near(r.ledger.absorbed, 0.2);
  near(r.ledger.residual, 0);
  const blocked = plateScene();
  blocked.objects[0].kind = "absorber";
  near(traceNonsequential(blocked).ledger.absorbed, 1);
  const empty = plateScene();
  empty.objects = [];
  near(traceNonsequential(empty).ledger.escaped, 1);
  const truncated = plateScene();
  truncated.options.maxDepth = 1;
  const t = traceNonsequential(truncated);
  near(t.ledger.depthLimit, 1);
  near(t.ledger.residual, 0);
  const budget = plateScene();
  budget.options.rays = 128;
  budget.options.maxSegments = 100;
  const b = traceNonsequential(budget);
  assert.ok(b.ledger.budgetLimit > 0);
  near(b.ledger.residual, 0, 1e-10);
  const cancel = traceNonsequential(plateScene(), { cancelled: () => true });
  near(cancel.ledger.cancelled, 1);
  assert.equal(cancel.status, "cancelled");
});

test("unpolarized source equals the average of orthogonal polarized powers", () => {
  const s = rayExample("plate");
  s.options.rays = 1;
  s.sources[0].waist = 0;
  const p = s.sources[0];
  p.polarization = 0;
  const a = traceNonsequential(s).detectors[0].power;
  p.polarization = 90;
  const b = traceNonsequential(s).detectors[0].power;
  p.unpolarized = true;
  const c = traceNonsequential(s).detectors[0].power;
  near(c, (a + b) / 2, 1e-10);
});

test("unsupported parts, overlaps and malformed imports are rejected rather than silently approximated", () => {
  const s = sceneFromBench(makeProject("focus"));
  assert.ok(s.objects.some((o) => o.kind === "unsupported"));
  assert.throws(() => validateRayScene(s), /explicit surface/);
  const a = plateScene();
  a.objects.push({ ...a.objects[0], id: "second" });
  assert.throws(() => validateRayScene(a), /bounding boxes/);
  assert.throws(() =>
    parseRayScene(JSON.stringify({ format: "optibench-nonsequential-run" })),
  );
  const b = plateScene();
  b.sources[0].direction = [0, 0, 0];
  assert.throws(() => validateRayScene(b), /nonzero/);
  const c = plateScene();
  c.objects.push({ ...c.objects[1], id: "coincident" });
  assert.throws(() => traceNonsequential(c), /Coincident/);
});

test("path filtering, projection and CSV export preserve units, sequences and escaping", () => {
  const s = plateScene();
  s.objects[0].label = "<script>bad</script>";
  const r = traceNonsequential(s),
    g = groupDetectorPaths(r, {
      detectorId: "detector",
      contains: "glass",
      reflections: 2,
    });
  assert.equal(g.length, 1);
  const svg = raySceneSVG(r.scene, r, "oblique", g[0]);
  assert.ok(!svg.includes("<script>"));
  assert.match(svg, /&lt;script&gt;/);
  assert.match(detectorCSV(r, "detector"), /irradiance_mW_per_mm2/);
  assert.match(pathCSV(g), /glass:axial/);
});

test("ray workspace captures unsupported bench, traces examples, filters, saves, exports and replays", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLAnchorElement.prototype.click = () => {};
  const saved = new Map(),
    project = makeProject("focus"),
    before = JSON.stringify(project);
  const ui = createNonsequentialWorkspace({
    getProject: () => project,
    store: {
      list: async () => [...saved.values()],
      save: async (r) => saved.set(r.id, structuredClone(r)),
    },
    execute: async (s) => traceNonsequential(s),
  });
  try {
    await ui.open();
    const root = document.getElementById("nonsequential-workspace"),
      click = async (a) => {
        root.querySelector(`[data-ray="${a}"]`).click();
        await new Promise((r) => setTimeout(r, 20));
      };
    await click("trace");
    assert.match(root.textContent, /explicit surface/);
    await click("example-plate");
    await click("trace");
    assert.match(root.textContent, /Trace completed/);
    assert.match(root.textContent, /Power accounting/);
    assert.ok(root.querySelector("canvas"));
    await click("save-scene");
    await click("save-run");
    assert.equal(saved.size, 2);
    const select = root.querySelector("[data-object-select]");
    select.value = "0";
    select.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.match(
      root.querySelector("[data-object-editor]").textContent,
      /Center thickness/,
    );
    const filter = root.querySelector('[data-filter="reflections"]');
    filter.value = "2";
    filter.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.match(root.textContent, /1 matching path groups/);
    await click("path-csv");
    await click("detector-csv");
    await click("export-run");
    await click("replay");
    assert.equal(JSON.stringify(project), before);
    await click("close");
    assert.equal(root.hidden, true);
    assert.equal(document.getElementById("app").inert, false);
  } finally {
    await w.happyDOM.abort();
  }
});

import { runRayBenchmarks } from "../dist/nonsequential-benchmarks.js";
test("in-app physics checks publish numerical references and pass the declared tolerances", () => {
  const rows = runRayBenchmarks();
  assert.equal(rows.length, 8);
  assert.ok(
    rows.every((r) => r.pass && Number.isFinite(r.expected) && r.tolerance > 0),
  );
});
test("optical path length includes the material index and TIR preserves the analytic complex phase", () => {
  const r = traceNonsequential(plateScene()),
    direct = r.detectorHits.find(
      (h) =>
        h.detectorId === "detector" && !h.path.some((p) => p.event === "R"),
    );
  near(direct.opl, 450 + 8 * 0.5, 1e-6);
  const theta = Math.PI / 3,
    n1 = 1.5,
    n2 = 1,
    term = Math.sqrt(Math.sin(theta) ** 2 - (n2 / n1) ** 2),
    f = fresnel(n1, n2, Math.cos(theta));
  near(Math.atan2(f.rs[1], f.rs[0]), -2 * Math.atan(term / Math.cos(theta)));
  near(
    Math.atan2(f.rp[1], f.rp[0]),
    -2 * Math.atan(((n1 / n2) ** 2 * term) / Math.cos(theta)),
  );
});
test("full 3D tracing is invariant under rigid rotation of the source, fields, surfaces and detectors", () => {
  const s = plateScene();
  s.sources[0].unpolarized = true;
  const a = traceNonsequential(s);
  // A cyclic permutation is a proper 3D rotation, moving the optical axis from X to Z.
  const rotate = (v) => [v[1], v[2], v[0]];
  for (const src of s.sources) {
    src.position = rotate(src.position);
    src.direction = rotate(src.direction);
  }
  for (const o of s.objects) {
    o.center = rotate(o.center);
    o.normal = rotate(o.normal);
  }
  const b = traceNonsequential(s);
  near(a.ledger.detected, b.ledger.detected);
  near(a.ledger.escaped, b.ledger.escaped);
  near(a.detectors[0].power, b.detectors[0].power);
});
test("dielectric lens rim and rectangular plate edges form closed finite volumes", () => {
  const lens = newRayObject("lens", "lens");
  lens.center = [0, 0, 0];
  lens.radius = 50;
  lens.thickness = 8;
  lens.aperture = 20;
  const rim = intersectSurface([0, 0, 0], [0, 1, 0], lens);
  assert.equal(rim.face, "rim");
  near(rim.distance, 10);
  assert.deepEqual(rim.normal, [0, 1, 0]);
  const plate = newRayObject("plate", "plate");
  plate.center = [0, 0, 0];
  plate.width = 12;
  plate.height = 8;
  const edge = intersectSurface([0, 0, 0], [0, 0, 1], plate);
  assert.equal(edge.face, "v+");
  near(edge.distance, 4);
});
test("cancelled UI tracing retains the previous completed run and ignores a late result", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  let calls = 0,
    finish;
  const ui = createNonsequentialWorkspace({
    getProject: () => makeProject("focus"),
    store: { list: async () => [] },
    execute: async (s) => {
      calls++;
      if (calls === 2) await new Promise((r) => (finish = r));
      return traceNonsequential(s);
    },
  });
  try {
    await ui.open();
    const root = document.getElementById("nonsequential-workspace"),
      click = async (a) => {
        root.querySelector(`[data-ray="${a}"]`).click();
        await new Promise((r) => setTimeout(r, 20));
      };
    await click("example-plate");
    await click("trace");
    const initial = root.querySelector(".ray-ledger").textContent;
    await click("trace");
    await click("cancel");
    finish();
    await new Promise((r) => setTimeout(r, 20));
    assert.match(root.textContent, /Trace cancelled/);
    assert.equal(root.querySelector(".ray-ledger").textContent, initial);
    assert.equal(root.querySelector('[data-ray="trace"]').disabled, false);
  } finally {
    await w.happyDOM.abort();
  }
});

test("nearest encounter is independent of object ordering even when farther surfaces coincide", () => {
  const front = newRayObject("detector", "near");
  front.center = [10, 0, 0];
  const a = newRayObject("mirror", "a");
  a.center = [20, 0, 0];
  const b = { ...a, id: "b" };
  assert.equal(
    nearestSurface([0, 0, 0], [1, 0, 0], [a, b, front]).object.id,
    "near",
  );
  assert.equal(
    nearestSurface([0, 0, 0], [1, 0, 0], [front, b, a]).object.id,
    "near",
  );
  const bad = plateScene();
  bad.notes = { bad: "data" };
  assert.throws(() => parseRayScene(JSON.stringify(bad)), /notes/);
});
