import test from "node:test";
import assert from "node:assert/strict";
import {
  benchmarks,
  benchmarkInput,
  runBenchmark,
  validationReport,
  baselineReport,
} from "../dist/validation.js";
for (const b of benchmarks)
  test(`validation suite: ${b.id} meets declared criterion`, () => {
    const r = runBenchmark(b.id);
    assert.equal(r.passed, true, JSON.stringify(r));
    if (b.kind === "accuracy") {
      assert.ok(r.errorRMS <= b.toleranceNm);
      assert.ok(r.validFraction > 0.99);
    } else if (b.clip) assert.ok(r.clippedPixels > 0);
    else assert.ok(r.stepResidual > 0.05);
  });
test("analytical sinusoid RMS and PV agree with independent discrete truth statistics", () => {
  const f = benchmarkInput("ideal"),
    mean = f.truth.reduce((a, b) => a + b, 0) / f.truth.length;
  assert.ok(Math.abs(mean) < 1e-10);
  assert.ok(
    Math.abs(
      Math.sqrt(f.truth.reduce((a, v) => a + v * v, 0) / f.truth.length) -
        f.expectedRMS,
    ) < 1e-10,
  );
  assert.ok(
    Math.abs(Math.max(...f.truth) - Math.min(...f.truth) - f.expectedPV) <
      1e-10,
  );
});
test("noise benchmark is deterministic and baseline rejects malformed metrics", () => {
  assert.equal(runBenchmark("noise").errorRMS, runBenchmark("noise").errorRMS);
  const report = validationReport([runBenchmark("noise")]);
  assert.equal(baselineReport(JSON.stringify(report)).results.length, 1);
  report.results[0].errorRMS = -1;
  assert.throws(() => baselineReport(JSON.stringify(report)), /Invalid/);
  assert.throws(() => runBenchmark("missing"), /Unknown/);
});
