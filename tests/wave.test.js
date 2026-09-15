import test from "node:test";
import assert from "node:assert/strict";
import {
  fft,
  fft2,
  propagateField,
  intensity,
  sum,
  rmsRadius,
  solveWave,
  cameraResponse,
  poisson,
} from "../dist/wave.js";
import {
  gaussianQ,
  propagateQ,
  beamRadius,
  seededRandom,
} from "../dist/optics.js";
import { makeProject } from "../dist/project.js";
import { instantiate } from "../dist/catalog.js";
const near = (a, b, t) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
test("complex FFT roundtrip preserves phase and amplitude", () => {
  const re = Float64Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    im = Float64Array.from([0.5, 0, -1, 2, 0, 1, 0, -1]),
    r = Array.from(re),
    m = Array.from(im);
  fft(re, im);
  fft(re, im, true);
  for (let i = 0; i < 8; i++) {
    near(re[i], r[i], 1e-10);
    near(im[i], m[i], 1e-10);
  }
});
test("2D FFT and angular-spectrum propagation conserve energy", () => {
  const n = 64,
    re = Float64Array.from({ length: n * n }, (_, i) =>
      Math.exp(
        -(((i % n) - n / 2) ** 2 + (Math.floor(i / n) - n / 2) ** 2) / 64,
      ),
    ),
    im = new Float64Array(n * n),
    before = sum(intensity(re, im));
  propagateField(re, im, n, 4, 0.000532, 500);
  near(sum(intensity(re, im)), before, 1e-8);
});
test("numerical Gaussian diffraction agrees with analytical radius", () => {
  const n = 128,
    width = 4,
    w = 0.15,
    z = 150,
    lambda = 532,
    re = new Float64Array(n * n),
    im = new Float64Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      re[y * n + x] = Math.exp(
        -((((x - n / 2) * width) / n) ** 2 + (((y - n / 2) * width) / n) ** 2) /
          (w * w),
      );
  propagateField(re, im, n, width, lambda * 1e-6, z);
  const actual = rmsRadius(intensity(re, im), n, width);
  const expected = beamRadius(propagateQ(gaussianQ(w, lambda), z), lambda);
  near(actual.wx, expected, 1e-5);
  near(actual.wy, expected, 1e-5);
});
test("neutral density filter scales numerical field power", () => {
  const p = makeProject("empty");
  p.items = [
    instantiate("DESIGN-LASER-532", 1, 100, 450, { waist: 0.2 }),
    instantiate("DESIGN-ND-1", 2, 300, 450),
    instantiate("DESIGN-SCREEN-50", 3, 500, 450, { terminate: true }),
  ];
  const r = solveWave(p, { n: 128, width: 4, detectorId: 3 });
  near(r.power, 0.1, 1e-9);
});
test("Fourier solver rejects folded geometry, multiple sources and M² > 1", () => {
  const p = makeProject();
  assert.throws(() => solveWave(p, { detectorId: 5 }), /straight common axis/);
  const q = makeProject("focus");
  q.items[0].m2 = 2;
  assert.throws(() => solveWave(q, { detectorId: 3 }), /M²/);
  q.items.push(instantiate("DESIGN-LASER-532", 4, 100, 100));
  assert.throws(() => solveWave(q, { detectorId: 3 }), /exactly one/);
});
test("double-slit field produces nonuniform diffraction with conserved power", () => {
  const p = makeProject("diffraction");
  const r = solveWave(p, { n: 256, width: 6, detectorId: 2 });
  near(r.power, p.items[0].power, 1e-12);
  assert.ok(r.moments.wx > 0.2);
  assert.ok(Math.max(...r.values) > (r.power / r.values.length) * 3);
});
test("source images propagate as fields and empty source fails explicitly", () => {
  const p = makeProject("diffraction");
  p.items[0].pattern = "image";
  assert.throws(
    () =>
      solveWave(p, {
        n: 128,
        width: 6,
        detectorId: 2,
        imageData: new Float64Array(128 * 128),
      }),
    /empty/,
  );
});
test("camera responds to exposure, full-well clipping and ADC quantization", () => {
  const n = 16,
    v = new Float64Array(n * n).fill(1e-12),
    c = instantiate("DESIGN-CAMERA", 1, 0, 0, {
      exposure: 1,
      pixelsX: 16,
      pixelsY: 16,
      pixelPitch: 10,
      qe: 1,
      fullWell: 100000,
      darkCurrent: 0,
      gain: 1,
    });
  const a = cameraResponse(v, n, 0.16, c, 532, { noise: false });
  c.exposure = 2;
  const b = cameraResponse(v, n, 0.16, c, 532, { noise: false });
  near(b.peakElectrons, a.peakElectrons * 2, 1e-9);
  c.fullWell = 1;
  c.exposure = 1e6;
  const sat = cameraResponse(v, n, 0.16, c, 532, { noise: false });
  assert.equal(sat.saturated, 1);
  assert.ok(sat.values.every((v) => v === 1));
});
test("noise model is seeded and Poisson sample mean follows expected counts", () => {
  const rng = seededRandom(9),
    samples = Array.from({ length: 10000 }, () => poisson(5, rng)),
    mean = sum(samples) / samples.length;
  near(mean, 5, 0.1);
  const v = new Float64Array(256).fill(1e-12),
    c = instantiate("DESIGN-CAMERA", 1, 0, 0);
  assert.deepEqual(
    cameraResponse(v, 16, 1, c, 532, { seed: 5 }),
    cameraResponse(v, 16, 1, c, 532, { seed: 5 }),
  );
});
test("full-well clipping occurs before fractional digital gain", () => {
  const n = 16,
    v = new Float64Array(n * n).fill(1),
    c = instantiate("DESIGN-CAMERA", 1, 0, 0, {
      fullWell: 1,
      gain: 0.5,
      bits: 12,
    });
  const r = cameraResponse(v, n, 10, c, 532, { noise: false });
  assert.equal(r.saturated, 1);
  near(r.values[0], 0.5, 1 / 4095);
});
test("numerical thin-lens focusing agrees with the ABCD solver", async () => {
  const { trace } = await import("../dist/optics.js");
  const p = makeProject("focus"),
    h = trace(p).detectors[0],
    r = solveWave(p, { n: 512, width: 6, detectorId: 3 });
  near(r.moments.wx, h.radius, 1e-5);
  near(r.moments.wy, h.radius, 1e-5);
  assert.deepEqual(r.warnings, []);
});
