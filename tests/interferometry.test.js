import test from "node:test";
import assert from "node:assert/strict";
import { makeProject, validateProject } from "../dist/project.js";
import {
  coherentField,
  measureFringes,
  phaseScan,
} from "../dist/interferometry.js";
import { instantiate } from "../dist/catalog.js";
const close = (a, b, tol = 1e-7) =>
  assert.ok(Math.abs(a - b) < tol, `${a} != ${b}`);
function setup(name = "michelson", aligned = false) {
  const p = validateProject(makeProject(name));
  if (aligned) p.items[2].angle = name === "michelson" ? 0 : 135;
  return p;
}
const camera = (p) => p.items.find((c) => c.type === "camera").id;
test("Michelson normal mirror piston gives a complete cycle every λ/2", () => {
  const p = setup("michelson", true),
    id = camera(p);
  const intensity = (d) => {
    p.items[2].pistonNm = d;
    return coherentField(p, id, { n: 1 }).at(0, 0).intensity;
  };
  const bright = intensity(0);
  assert.ok(bright > 0);
  close(intensity(633 / 4) / bright, 0, 1e-8);
  close(intensity(633 / 2) / bright, 1, 1e-8);
  const scan = phaseScan(p, id, 3);
  assert.equal(scan.length, 65);
  close(scan[0].irradiance, scan[16].irradiance, 1e-12);
});
test("ideal lossless two-port setups conserve incident power while piston redistributes it", () => {
  for (const name of ["michelson", "mach-zehnder"]) {
    const p = setup(name, true);
    for (const d of [0, 70, 158.25, 316.5]) {
      p.items[2].pistonNm = d;
      const ports = p.items.filter((c) => ["camera", "power"].includes(c.type));
      const total = ports.reduce(
        (sum, c) => sum + coherentField(p, c.id, { n: 128, width: 16 }).power,
        0,
      );
      close(total / p.items[0].power, 1, 2e-6);
    }
  }
});
test("camera row fit recovers independently predicted local fringe spacing", () => {
  for (const name of ["michelson", "mach-zehnder"]) {
    const p = setup(name),
      f = coherentField(p, camera(p));
    const m = measureFringes(f);
    assert.ok(m.fit, m.reason);
    close(m.fit.frequency / f.carrier, 1, 0.003);
    assert.ok(m.fit.visibility > 0.9 && m.fit.visibility <= 1.01);
  }
});
test("camera noise is repeatable and saturated measurements are rejected", () => {
  const p = setup(),
    id = camera(p),
    f = coherentField(p, id);
  assert.deepEqual(
    measureFringes(f, { noise: true }),
    measureFringes(f, { noise: true }),
  );
  p.items.find((c) => c.id === id).exposure = 1e6;
  const m = measureFringes(coherentField(p, id));
  assert.equal(m.fit, null);
  assert.match(m.reason, /clipping/);
});
test("finite temporal coherence reduces fringe visibility with the specified 1/e length", () => {
  const p = setup("michelson", true);
  p.items[2].pistonNm = 500;
  p.items[0].coherenceLength = 0.001;
  const f = coherentField(p, camera(p), { n: 1 });
  close(f.coherence, Math.exp(-1), 1e-7);
});
test("single arm and zero spatial carrier report no fringe fit", () => {
  const p = setup("michelson", true);
  assert.equal(measureFringes(coherentField(p, camera(p))).fit, null);
  p.items[3].enabled = false;
  const m = measureFringes(coherentField(p, camera(p)));
  assert.equal(m.fit, null);
  assert.match(m.reason, /one path/);
});
test("schema preserves piston and coherence controls and rejects invalid values", () => {
  const p = setup();
  p.items[2].pistonNm = -13.5;
  p.items[0].coherenceLength = 0.1;
  const q = validateProject(JSON.parse(JSON.stringify(p)));
  close(q.items[2].pistonNm, -13.5);
  close(q.items[0].coherenceLength, 0.1);
  p.items[0].coherenceLength = 0;
  assert.throws(() => validateProject(p));
});
test("unsupported coherent source and lens configurations fail explicitly", () => {
  const p = setup();
  p.items[0].m2 = 2;
  assert.throws(() => coherentField(p, camera(p)), /M²/);
  p.items[0].m2 = 1;
  p.items.push(instantiate("DESIGN-LENS-25.4-100", 99, 350, 450));
  assert.throws(() => coherentField(p, camera(p)), /lenses|aperture/);
});
