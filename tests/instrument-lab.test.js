import test from "node:test";
import assert from "node:assert/strict";
import { instrumentSetup, acquireInstrument } from "../dist/instrument-lab.js";
import { cameraResponse } from "../dist/wave.js";
import { coherentField } from "../dist/interferometry.js";
import { analyzeRepeats } from "../dist/repeatability.js";
import { analyzeMeasurement } from "../dist/metrology.js";
const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
test("instrument capture uses shared physical camera response with native pixel calibration", () => {
  const p = instrumentSetup(),
    camera = p.items.find((c) => c.type === "camera"),
    n = 64;
  const r = acquireInstrument(p, { seed: 100, n });
  const field = coherentField(p, camera.id, {
    n,
    width: (n * camera.pixelPitch) / 1000,
  });
  const expected = cameraResponse(
    field.values,
    n,
    field.width,
    { ...camera, pixelsX: n, pixelsY: n },
    field.wavelength,
    { seed: 100, noise: true },
  );
  assert.deepEqual(r.frames[0].values, Array.from(expected.values));
  assert.equal(r.settings.pixelUm, camera.pixelPitch);
  assert.deepEqual(
    analyzeMeasurement(r.frames, r.settings).stats,
    r.result.stats,
  );
  assert.deepEqual(acquireInstrument(p, { seed: 100, n }).frames, r.frames);
  assert.notDeepEqual(acquireInstrument(p, { seed: 200, n }).frames, r.frames);
  const changed = structuredClone(p);
  changed.items.find((c) => c.type === "camera").exposure *= 2;
  const bright = acquireInstrument(changed, { seed: 100, n });
  const ratio = mean(bright.frames[0].values) / mean(r.frames[0].values);
  assert.ok(
    ratio > 1.9 && ratio < 2.1,
    `exposure should double signal: ${ratio}`,
  );
  changed.items.find((c) => c.type === "camera").exposure = 100000;
  const saturated = acquireInstrument(changed, { seed: 100, n });
  assert.ok(Math.max(...saturated.simulation.saturated) > 0.9);
  assert.ok(
    saturated.simulation.analysisError || saturated.result.warnings.length,
  );
  assert.equal(p.items.find((c) => c.type === "camera").exposure, 100);
});
test("instrument repeats reject changed conditions and reused noise streams", () => {
  const p = instrumentSetup(),
    runs = [10, 20, 30].map((seed) => acquireInstrument(p, { seed, n: 64 }));
  assert.ok(analyzeRepeats(runs, { verified: true }).rms.sd > 0);
  const copy = structuredClone(runs);
  copy[2].project.items[0].power *= 2;
  assert.throws(() => analyzeRepeats(copy, { verified: true }), /unchanged/);
  const duplicated = [
    runs[0],
    runs[1],
    acquireInstrument(p, { seed: 10, n: 64 }),
  ];
  assert.throws(
    () => analyzeRepeats(duplicated, { verified: true }),
    /independent noise/,
  );
});
test("instrument fails unsupported geometry instead of inventing acquisitions", () => {
  const p = instrumentSetup();
  p.items.find((c) => c.type === "mirror").enabled = false;
  assert.throws(() => acquireInstrument(p, { seed: 1, n: 64 }), /arms|path/i);
  assert.throws(
    () => acquireInstrument(instrumentSetup(), { seed: -1, n: 64 }),
    /seed/,
  );
});
