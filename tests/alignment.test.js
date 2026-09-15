import test from "node:test";
import assert from "node:assert/strict";
import { makeProject, validateProject } from "../dist/project.js";
import { instantiate } from "../dist/catalog.js";
import { trace } from "../dist/optics.js";
import {
  alignmentTargets,
  pairAlignment,
  stageMove,
  mechanicalChecks,
} from "../dist/alignment.js";
import { coherentField } from "../dist/interferometry.js";
import { solveWave } from "../dist/wave.js";
const close = (a, b, t = 1e-8) =>
  assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
function bench(items) {
  return validateProject({ ...makeProject("empty"), items });
}
const laser = (o = {}) =>
  instantiate("DESIGN-LASER-633", 1, 100, 200, { z: 100, waist: 0.3, ...o });
const screen = (x, y, o = {}) =>
  instantiate("DESIGN-SCREEN-50", 3, x, y, { z: 100, terminate: true, ...o });
test("vertical source elevation produces the expected free-space centroid rise", () => {
  const p = bench([laser({ pitch: 0.1 }), screen(1100, 200)]),
    r = trace(p);
  close(r.detectors[0].z, 100 + 1000 * Math.tan((0.1 * Math.PI) / 180));
  close(r.segments[0].z0, 100);
});
test("mirror normal tip produces the projected double-angle vertical deflection", () => {
  const p = bench([
    laser(),
    instantiate("DESIGN-MIRROR-25.4", 2, 400, 200, {
      z: 100,
      pitch: 0.1,
      angle: 135,
    }),
    screen(400, 700, { angle: 90 }),
  ]);
  const h = trace(p).detectors[0];
  close(h.slope, (Math.SQRT2 * 0.1 * Math.PI) / 180);
  close(h.z, 100 + 500 * h.slope);
});
test("splitter elevation changes only the reflected branch", () => {
  const p = bench([
    laser(),
    instantiate("DESIGN-BS-50", 2, 400, 200, {
      z: 100,
      pitch: 0.1,
      angle: 135,
    }),
    screen(1100, 200),
    { ...screen(400, 700, { angle: 90 }), id: 4 },
  ]);
  const r = trace(p);
  close(r.detectors.find((h) => h.id === 3).z, 100);
  assert.ok(r.detectors.find((h) => h.id === 4).z > 101);
});
test("a thin lens steers a vertically decentered centroid toward its focal plane", () => {
  const p = bench([
    laser({ z: 101 }),
    instantiate("DESIGN-LENS-25.4-100", 2, 300, 200, { z: 100 }),
    screen(400, 200),
  ]);
  close(trace(p).detectors[0].verticalOffset, 0);
});
test("a missed elevated mirror is bypassed while a blocked iris stops its path", () => {
  const p = bench([
    laser(),
    instantiate("DESIGN-MIRROR-25.4", 2, 400, 200, { z: 140, angle: 135 }),
    screen(1100, 200),
  ]);
  const r = trace(p);
  assert.equal(r.hits.find((h) => h.id === 2).missed, true);
  assert.equal(r.detectors.length, 1);
  p.items[1] = {
    ...instantiate("DESIGN-IRIS-1", 2, 400, 200),
    z: 102,
    angle: 0,
  };
  const blocked = trace(p);
  assert.equal(blocked.detectors.length, 0);
  assert.equal(blocked.hits.at(-1).blocked, true);
});
test("a descending beam terminates exactly at the table surface", () => {
  const p = bench([laser({ z: 1, pitch: -1 }), screen(1100, 200)]),
    r = trace(p);
  assert.equal(r.detectors.length, 0);
  close(r.segments.at(-1).z1, 0);
  assert.ok(r.warnings.some((w) => w.text.includes("table surface")));
});
test("dual-iris targets recover the initial alignment template pointing error", () => {
  const p = validateProject(makeProject("alignment")),
    targets = alignmentTargets(p, trace(p)),
    pair = pairAlignment(targets);
  close(pair.verticalMrad, Math.tan((0.015 * Math.PI) / 180) * 1000);
  close(pair.horizontalMrad, Math.sin((0.03 * Math.PI) / 180) * 1000);
  assert.equal(pair.centred, false);
  p.items[0].angle = 0;
  p.items[0].pitch = 0;
  assert.equal(pairAlignment(alignmentTargets(p, trace(p))).centred, true);
});
test("stage fine moves stop at travel limits and mount checks flag mechanical incompatibility", () => {
  const p = validateProject(makeProject("alignment")),
    stage = p.items[4];
  close(stageMove(stage, "z", 12.5).z, 112.5);
  assert.throws(() => stageMove(stage, "z", 12.6), /travel/);
  assert.throws(
    () => stageMove({ ...stage, locked: true }, "x", 0.1),
    /Unlock/,
  );
  stage.mountThread = "1/4-20";
  stage.z = 200;
  const checks = mechanicalChecks(p);
  assert.ok(checks.some((c) => c.text.includes("extension")));
  assert.ok(checks.some((c) => c.text.includes("thread")));
  assert.ok(checks.some((c) => c.text.includes("travel")));
});
test("height, mounting assembly and stage references survive project round trips", () => {
  const p = validateProject(makeProject("alignment"));
  p.items[4].z += 1;
  const q = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(q.items[4].stageOriginZ, 100);
  assert.equal(q.items[4].z, 101);
  assert.equal(q.items[4].mountType, "xyz");
  p.items[0].pitch = 2;
  assert.throws(() => validateProject(p), /elevation/);
});
test("wave solvers reject unsupported elevation rather than reporting planar fringe data", () => {
  const p = validateProject(makeProject("michelson"));
  p.items[0].pitch = 0.001;
  assert.throws(() => coherentField(p, 5), /common beam height/);
  const f = validateProject(makeProject("focus"));
  f.items[1].z += 0.01;
  assert.throws(() => solveWave(f, { detectorId: 3 }), /common beam height/);
});
