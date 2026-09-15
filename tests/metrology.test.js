import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMeasurement,
  demoFrames,
  defaultMeasurementSettings,
  removePlane,
  unwrapQuality,
  wrapPhase,
  measurementCSV,
} from "../dist/metrology.js";
import { serializable } from "../dist/run-store.js";
const n = 64,
  s = () => ({ ...defaultMeasurementSettings(), n }),
  close = (a, b, t = 1e-8) => assert.ok(Math.abs(a - b) < t, `${a} ≠ ${b}`);
function reference(n) {
  return Float64Array.from(
    { length: n * n },
    (_, i) =>
      (2 * Math.PI * (12 * (i % n) + 5 * Math.floor(i / n))) / n +
      1.8 *
        Math.exp(
          -(((i % n) - n * 0.5) ** 2 + (Math.floor(i / n) - n * 0.5) ** 2) /
            (n * 0.2) ** 2,
        ),
  );
}
test("four-step phase recovers known multi-wrap wavefront and visibility", () => {
  const r = analyzeMeasurement(demoFrames(n), s()),
    truth = removePlane(reference(n), n).values;
  for (let i = 0; i < n * n; i++) close(r.phase[i], truth[i]);
  close(r.stats.meanVisibility, 0.8);
  assert.equal(r.stats.unwrapConflicts, 0);
  assert.equal(r.stats.validFraction, 1);
});
test("single-image Fourier method detects the two-dimensional carrier and recovers smooth phase", () => {
  const n = 128,
    r = analyzeMeasurement(demoFrames(n).slice(0, 1), {
      ...s(),
      n,
      method: "fourier",
    });
  assert.deepEqual([r.carrier.x, r.carrier.y], [12, 5]);
  const truth = removePlane(
    Float64Array.from(reference(n), (v, i) => (r.mask[i] ? v : NaN)),
    n,
  ).values;
  let error = 0,
    count = 0;
  for (let i = 0; i < n * n; i++)
    if (r.mask[i]) {
      error += (truth[i] - r.phase[i]) ** 2;
      count++;
    }
  assert.ok(Math.sqrt(error / count) < 0.03);
  assert.equal(r.stats.unwrapConflicts, 0);
  assert.ok(r.stats.validFraction > 0.5);
});
test("opposite Fourier sideband reverses the recovered phase sign", () => {
  const p = {
      ...s(),
      method: "fourier",
      autoCarrier: false,
      carrierX: 12,
      carrierY: 5,
    },
    f = demoFrames(n).slice(0, 1),
    a = analyzeMeasurement(f, p),
    b = analyzeMeasurement(f, { ...p, carrierX: -12, carrierY: -5 });
  for (let i = 0; i < n * n; i++)
    if (a.mask[i] && b.mask[i]) close(a.phase[i], -b.phase[i], 1e-7);
});
test("dark subtraction and flat correction recover the undistorted phase", () => {
  const frames = demoFrames(n),
    dark = {
      name: "dark",
      width: n,
      height: n,
      values: new Float64Array(n * n).fill(0.05),
    },
    flat = {
      name: "flat",
      width: n,
      height: n,
      values: Float64Array.from(
        { length: n * n },
        (_, i) => 0.5 + (0.15 * (i % n)) / n,
      ),
    };
  const distorted = frames.map((f) => ({
    ...f,
    values: Float64Array.from(
      f.values,
      (v, i) => dark.values[i] + v * (flat.values[i] - dark.values[i]),
    ),
  }));
  const a = analyzeMeasurement(frames, s()),
    b = analyzeMeasurement(distorted, s(), { dark, flat });
  for (let i = 0; i < n * n; i++) close(a.phase[i], b.phase[i]);
});
test("reflection height includes double pass and incidence factor", () => {
  const f = demoFrames(n),
    a = analyzeMeasurement(f, s()),
    b = analyzeMeasurement(f, {
      ...s(),
      geometry: "reflection",
      incidence: 60,
    });
  close(a.stats.pvNm, b.stats.pvNm);
  const c = analyzeMeasurement(f, {
    ...s(),
    geometry: "reflection",
    incidence: 0,
  });
  close(c.stats.pvNm, a.stats.pvNm / 2);
});
test("ROI is cropped at native sample coordinates and bounds are checked", () => {
  const frames = demoFrames(128),
    r = analyzeMeasurement(frames, { ...s(), x: 12, y: 20 });
  close(r.corrected[0], frames[0].values[20 * 128 + 12]);
  assert.throws(
    () => analyzeMeasurement(frames, { ...s(), x: 100 }),
    /fit inside/,
  );
  assert.throws(
    () => analyzeMeasurement(frames, { ...s(), pixelUm: 0 }),
    /pixel scale/,
  );
});
test("clipping is excluded and exposure inconsistency generates a diagnostic", () => {
  const f = demoFrames(n);
  f[0].values[100] = 1;
  const r = analyzeMeasurement(f, s());
  assert.equal(r.mask[100], 0);
  assert.equal(r.stats.clippedPixels, 1);
  f[1].values = Float64Array.from(f[1].values, (v) => v * 0.6);
  assert.ok(
    analyzeMeasurement(f, s()).warnings.some((w) => w.includes("phase-step")),
  );
});
test("quality unwrap excludes disconnected islands rather than inventing their phase order", () => {
  const n = 4,
    w = Float64Array.from({ length: 16 }, (_, i) => wrapPhase(i * 0.2)),
    q = new Float64Array(16).fill(1),
    mask = new Uint8Array(16);
  mask[0] = mask[1] = mask[15] = 1;
  q[0] = 2;
  const r = unwrapQuality(w, q, mask, n);
  assert.equal(r.count, 2);
  assert.ok(Number.isNaN(r.values[15]));
  close(r.values[1] - 0.2, 0);
});
test("invalid phase sequences and overlapping Fourier filters fail explicitly", () => {
  assert.throws(
    () => analyzeMeasurement(demoFrames(n).slice(0, 1), s()),
    /four frames/,
  );
  assert.throws(
    () =>
      analyzeMeasurement(demoFrames(n).slice(0, 1), {
        ...s(),
        method: "fourier",
        autoCarrier: false,
        carrierX: 2,
        carrierY: 0,
      }),
    /overlaps/,
  );
});
test("portable decoded data reproduces analysis and CSV retains invalid masks", () => {
  const frames = demoFrames(n);
  frames[0].values[17] = 1;
  const r = analyzeMeasurement(frames, s()),
    saved = serializable({ frames, settings: s(), result: r }),
    r2 = analyzeMeasurement(saved.frames, saved.settings);
  close(r.stats.rmsNm, r2.stats.rmsNm);
  assert.equal(saved.result.phase[17], null);
  const csv = measurementCSV(r);
  assert.equal(csv.split("\n").length, n * n + 1);
  assert.equal(csv.split("\n")[18].split(",")[4], "0");
});
