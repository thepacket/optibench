import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeRepeats,
  repeatCSV,
  repeatMapCSV,
} from "../dist/repeatability.js";
import { measurementQuality } from "../dist/measurement-quality.js";
import {
  defaultMeasurementSettings,
  analyzeMeasurement,
} from "../dist/metrology.js";
function runs() {
  return [1, 2, 3].map((amplitude, k) => ({
    id: String(k),
    acquisitionId: String(k),
    name: "Acquisition " + k,
    acquiredAt: `2026-09-15T00:0${k}:00Z`,
    settings: {
      ...defaultMeasurementSettings(),
      n: 64,
      wavelength: 200 * Math.PI,
      removeTilt: false,
    },
    frames: Array.from({ length: 4 }, (_, j) => ({
      width: 64,
      height: 64,
      name: `phase${j}`,
      origin: "synthetic test",
      values: Float64Array.from(
        { length: 4096 },
        (_, i) =>
          0.5 +
          0.4 *
            Math.cos(
              amplitude * Math.cos((2 * Math.PI * (i % 64)) / 64) +
                (j * Math.PI) / 2,
            ),
      ),
    })),
  }));
}
test("known repeat wavefronts recover sample SD and acquisition-time drift", () => {
  const s = analyzeRepeats(runs(), { verified: true });
  assert.ok(Math.abs(s.pv.mean - 400) < 1e-10);
  assert.ok(Math.abs(s.pv.sd - 200) < 1e-10);
  assert.ok(Math.abs(s.rms.mean - 100 * Math.SQRT2) < 1e-10);
  assert.ok(Math.abs(s.rms.sd - 100 * Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(s.pixelRepeatabilityNm - 100 * Math.SQRT1_2) < 1e-10);
  assert.ok(Math.abs(s.pvDriftNmMin - 200) < 1e-10);
  assert.ok(Math.abs(s.sd[0] - 100) < 1e-10);
  assert.match(s.warnings.join(" "), /simulated/);
  assert.equal(repeatMapCSV(s).split("\n").length, 4097);
  assert.equal(repeatCSV(s).split("\n").length, 4);
});
test("study rejects duplicate acquisitions, mixed settings and unverified registration", () => {
  const r = runs();
  assert.throws(() => analyzeRepeats(r), /Confirm/);
  r[1].acquisitionId = r[0].acquisitionId;
  assert.throws(
    () => analyzeRepeats(r, { verified: true }),
    /same acquisition/,
  );
  r[1].acquisitionId = "unique";
  r[1].settings.pixelUm = 11;
  assert.throws(() => analyzeRepeats(r, { verified: true }), /pixelUm/);
});
test("common mask removes clipped pixels and absent times disable drift", () => {
  const r = runs();
  r[0].frames.forEach((f) => (f.values[0] = 0));
  r[1].acquiredAt = null;
  const s = analyzeRepeats(r, { verified: true });
  assert.equal(s.mask[0], 0);
  assert.ok(Number.isNaN(s.mean[0]));
  assert.equal(s.pvDriftNmMin, null);
  assert.equal(s.commonFraction, 4095 / 4096);
  assert.match(s.warnings.join(" "), /quality flags/);
});
test("quality exposes saturation, weak fringes, unwrapping and registration", () => {
  const r = runs()[0],
    result = analyzeMeasurement(r.frames, r.settings);
  result.stats = {
    ...result.stats,
    clippedPixels: 10,
    meanVisibility: 0.1,
    validFraction: 0.4,
    unwrapConflicts: 2,
    stepResidual: 0.1,
  };
  const q = measurementQuality(result, r.frames, { reference: true });
  assert.equal(q.status, "review");
  assert.equal(q.checks.filter((c) => c.level === "review").length, 6);
});
