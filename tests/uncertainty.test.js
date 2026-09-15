import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeMeasurement,
  defaultMeasurementSettings,
} from "../dist/metrology.js";
import { analyzeRepeats } from "../dist/repeatability.js";
import { evaluateUncertainty, assessLimit } from "../dist/uncertainty.js";
const phase = (i) =>
  0.4 +
  1.3 * Math.sin((i % 64) * 0.07) +
  0.3 * Math.cos(Math.floor(i / 64) * 0.09);
const frames = (offsets = [0, 0, 0, 0]) =>
  Array.from({ length: 4 }, (_, j) => ({
    width: 64,
    height: 64,
    name: String(j),
    origin: "Imported fixture",
    values: Float64Array.from(
      { length: 4096 },
      (_, i) => 0.5 + 0.4 * Math.cos(phase(i) + (j * Math.PI) / 2 + offsets[j]),
    ),
  }));
const settings = { ...defaultMeasurementSettings(), n: 64, removeTilt: false };
const runs = Array.from({ length: 3 }, (_, i) => ({
  id: String(i),
  name: "run" + i,
  settings,
  frames: frames(),
}));
const result = analyzeMeasurement(frames(), settings),
  study = analyzeRepeats(runs, { verified: true });
const cal = {
  recordId: "TEST",
  date: "2026-09-15",
  references: "Analytical fixture",
  scope: "Independent test contributions; zero terms intentionally omitted",
  wavelengthU: 1,
  pixelU: 0.1,
  angleU: 0,
  stepU: 0,
  otherPV: 3,
  otherRMS: 4,
  k: 2,
  pvLimit: "",
  rmsLimit: "",
};
test("independent standard contributions combine in quadrature and expand by k", () => {
  const b = evaluateUncertainty(result, study, cal, { verified: true });
  for (const key of ["pv", "rms"]) {
    const value = key === "pv" ? result.stats.pvNm : result.stats.rmsNm;
    const expected = Math.hypot(value / 633, key === "pv" ? 3 : 4);
    assert.ok(Math.abs(b.outputs[key].combined - expected) < 1e-9);
    assert.equal(b.outputs[key].expanded, 2 * b.outputs[key].combined);
  }
  assert.equal(b.roiWidth.standardU, 6.4);
});
test("phase-step sensitivity agrees with independently perturbed four-frame reconstruction", () => {
  const u = 0.0001,
    rad = Math.PI / 180;
  const b = evaluateUncertainty(
    result,
    study,
    { ...cal, stepU: u },
    { verified: true },
  );
  for (const key of ["pv", "rms"]) {
    const changes = [];
    for (let j = 0; j < 4; j++) {
      const offsets = [0, 0, 0, 0];
      offsets[j] = u * rad;
      const plus = analyzeMeasurement(frames(offsets), settings);
      offsets[j] = -u * rad;
      const minus = analyzeMeasurement(frames(offsets), settings);
      changes.push((plus.stats[key + "Nm"] - minus.stats[key + "Nm"]) / 2);
    }
    assert.ok(
      Math.abs(b.outputs[key].contributions[3].u - Math.hypot(...changes)) <
        1e-7,
    );
  }
});
test("uncertainty guard band treats overlap as indeterminate", () => {
  assert.equal(assessLimit(10, 2, 12), "Within limit");
  assert.equal(assessLimit(10, 2, 8), "Indeterminate");
  assert.equal(assessLimit(10, 2, 7), "Above limit");
  assert.equal(assessLimit(10, 2, null), "No limit");
});
test("missing calibration, mask mismatch, unsupported methods and large errors are rejected", () => {
  assert.throws(() => evaluateUncertainty(result, study, cal), /Review/);
  assert.throws(
    () =>
      evaluateUncertainty(
        result,
        study,
        { ...cal, stepU: "" },
        { verified: true },
      ),
    /every standard/,
  );
  assert.throws(
    () =>
      evaluateUncertainty(
        result,
        study,
        { ...cal, stepU: 2 },
        { verified: true },
      ),
    /Small-error/,
  );
  assert.throws(
    () =>
      evaluateUncertainty(
        { ...result, settings: { ...settings, method: "fourier" } },
        study,
        cal,
        { verified: true },
      ),
    /four-step/,
  );
  const mask = study.mask.slice();
  mask[0] = 0;
  assert.throws(
    () =>
      evaluateUncertainty(result, { ...study, mask }, cal, { verified: true }),
    /identical/,
  );
});
test("simulation suppresses physical tolerance verdicts", () => {
  const b = evaluateUncertainty(
    result,
    study,
    { ...cal, pvLimit: 10000 },
    { verified: true, simulation: true },
  );
  assert.equal(b.outputs.pv.decision, "Simulation only");
});

test("near-normal reflection angle curvature suppresses a first-order verdict", () => {
  const settings2 = { ...settings, geometry: "reflection", incidence: 0 };
  const r = analyzeMeasurement(frames(), settings2),
    st = analyzeRepeats(
      runs.map((x) => ({ ...x, settings: settings2 })),
      { verified: true },
    );
  const b = evaluateUncertainty(
    r,
    st,
    { ...cal, angleU: 1, pvLimit: 10000 },
    { verified: true },
  );
  assert.equal(b.nonlinear, true);
  assert.equal(b.outputs.pv.decision, "Model review required");
});
