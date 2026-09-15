import test from "node:test";
import assert from "node:assert/strict";
import {
  gaussianQ,
  propagateQ,
  lensQ,
  beamRadius,
  reflection,
  trace,
  monteCarlo,
  designExpander,
  layoutChecks,
} from "../dist/optics.js";
import { makeProject, validateProject } from "../dist/project.js";
import { catalog, instantiate } from "../dist/catalog.js";
const close = (a, b, tol = 1e-8) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≠ ${b}`);
test("free-space Gaussian propagation agrees with Rayleigh-range formula", () => {
  const w = 0.6,
    l = 532,
    q = gaussianQ(w, l),
    z = 1500;
  close(beamRadius(propagateQ(q, z), l), w * Math.sqrt(1 + (z / q.im) ** 2));
});
test("thin lens changes curvature but preserves beam width at the plane", () => {
  const q = propagateQ(gaussianQ(0.6, 532), 500);
  close(beamRadius(q, 532), beamRadius(lensQ(q, 100), 532));
});
test("4x afocal expander produces 4x waist radius in collimated limit", () => {
  let q = gaussianQ(1.2, 532);
  q = lensQ(q, 50);
  q = propagateQ(q, 250);
  q = lensQ(q, 200);
  close(beamRadius(q, 532), 4.8, 0.001);
});
test("plane mirror reflects into downward axis and preserves norm", () => {
  const reflected = reflection(
    { x: 1, y: 0 },
    { x: -Math.SQRT1_2, y: Math.SQRT1_2 },
  );
  close(reflected.x, 0);
  close(reflected.y, 1);
  close(Math.hypot(reflected.x, reflected.y), 1);
});
test("default pickoff gives complementary transmitted and reflected power", () => {
  const p = makeProject(),
    r = trace(p),
    a = r.detectors.find((d) => d.id === 5),
    b = r.detectors.find((d) => d.id === 6);
  assert.ok(a && b);
  close(a.power, 0.9, 1e-6);
  close(b.power, 0.1, 1e-6);
  close(a.radius / b.radius, 1, 0.002);
  assert.equal(r.warnings.filter((w) => w.level === "error").length, 0);
});
test("folded layout hits its downstream detector", () => {
  const r = trace(makeProject("folded"));
  assert.equal(r.detectors.length, 1);
  close(r.detectors[0].power, 0.99 ** 2);
  assert.equal(r.hits.length, 3);
});
test("polarization analyzer obeys Malus law", () => {
  const p = makeProject("polarization");
  close(trace(p).detectors[0].power, 0.5);
  p.items[2].axis = 90;
  assert.equal(trace(p).detectors.length, 0);
});
test("a disabled mirror no longer intercepts a beam", () => {
  const p = makeProject("folded");
  p.items[1].enabled = false;
  assert.equal(trace(p).detectors.length, 0);
});
test("geometrical focusing brings marginal rays to the focal plane", () => {
  const p = makeProject("empty");
  p.items = [
    instantiate("DESIGN-LASER-532", 1, 100, 450, { waist: 0.5 }),
    instantiate("DESIGN-LENS-25.4-100", 2, 300, 450),
    instantiate("DESIGN-SCREEN-50", 3, 400, 450, { terminate: true }),
  ];
  const r = trace(p, { rays: true });
  assert.equal(r.detectors.length, 13);
  for (const d of r.detectors) close(d.offset, 0, 1e-7);
});
test("lens incidence above paraxial limit stops path with diagnostic", () => {
  const p = makeProject("focus");
  p.items[1].angle = 20;
  const r = trace(p);
  assert.equal(r.detectors.length, 0);
  assert.ok(
    r.warnings.some((w) => w.level === "error" && w.text.includes("incidence")),
  );
});
test("tolerance trials are reproducible and zero tolerances reproduce nominal", () => {
  const p = makeProject();
  const settings = { trials: 20, position: 0, angle: 0, focal: 0, seed: 11 };
  const a = monteCarlo(p, 5, settings),
    b = monteCarlo(p, 5, settings);
  assert.deepEqual(a, b);
  close(a.mean, trace(p).detectors.find((d) => d.id === 5).radius * 2);
  assert.equal(a.missed, 0);
});
test("reverse design finds a 4x catalog pair with correct separation", () => {
  const r = designExpander(
    catalog.filter((c) => c.provenance !== "ideal"),
    1.2,
    4.8,
    1000,
    532,
  );
  assert.ok(r.length);
  close(r[0].error, 0, 1e-6);
  close(r[0].separation, r[0].a.f + r[0].b.f);
});
test("table overlap and boundary checks flag actionable placement", () => {
  const p = makeProject();
  p.items[1].x = p.items[0].x;
  p.items[1].y = p.items[0].y;
  p.items[2].x = 0;
  const warnings = layoutChecks(p);
  assert.ok(warnings.some((w) => w.text.includes("overlap")));
  assert.ok(warnings.some((w) => w.text.includes("beyond")));
});
test("all templates survive versioned project round-trip", () => {
  for (const id of [
    "expander",
    "focus",
    "folded",
    "relay",
    "diffraction",
    "polarization",
    "empty",
  ]) {
    const p = makeProject(id);
    assert.equal(
      validateProject(JSON.parse(JSON.stringify(p))).items.length,
      p.items.length,
    );
  }
});
test("schema rejects nonfinite optical parameters and unphysical gain", () => {
  const p = makeProject();
  p.items[1].f = 0;
  assert.throws(() => validateProject(p), /Focal length/);
  p.items[1].f = NaN;
  assert.throws(() => validateProject(p), /focal/);
  const q = makeProject();
  q.items[3].transmission = 0.95;
  assert.throws(() => validateProject(q), /cannot exceed/);
});
test("schema rejects duplicate IDs, oversized tables and out-of-bounds placement", () => {
  const p = makeProject();
  p.items[1].id = 1;
  assert.throws(() => validateProject(p), /Duplicate/);
  const q = makeProject();
  q.table.width = 1e20;
  assert.throws(() => validateProject(q), /table width/);
  const t = makeProject();
  t.items[0].x = -1;
  assert.throws(() => validateProject(t), /X position/);
});
test("legacy projects migrate with optical transmission units intact", () => {
  const p = validateProject({
    version: 1,
    title: "Legacy",
    wavelength: 532,
    items: [
      { type: "source", name: "laser", x: 90, power: 5, waist: 1.2 },
      { type: "filter", name: "ND", x: 300, transmission: 50 },
    ],
  });
  close(p.items[1].transmission, 0.5);
  assert.equal(p.version, 2);
});
test("catalog IDs are unique and placed catalog components validate", () => {
  assert.equal(new Set(catalog.map((c) => c.id)).size, catalog.length);
  for (const c of catalog) {
    const p = makeProject("empty");
    p.items = [instantiate(c, 1, 500, 450)];
    assert.doesNotThrow(() => validateProject(p), c.id);
  }
});
