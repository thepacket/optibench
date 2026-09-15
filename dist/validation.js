import {
  analyzeMeasurement,
  defaultMeasurementSettings,
  METROLOGY_VERSION,
} from "./metrology.js";
export const VALIDATION_VERSION = "1.0.0";
export const benchmarks = [
  {
    id: "ideal",
    name: "Known sinusoidal OPD",
    kind: "accuracy",
    a: 1.2,
    b: 0.4,
    toleranceNm: 1e-7,
    description:
      "φ = 1.2 cos(2πx/N) + 0.4 sin(2πy/N); exact quadrature, λ = 633 nm.",
  },
  {
    id: "multiwrap",
    name: "Multi-wrap phase recovery",
    kind: "accuracy",
    a: 8,
    b: 3,
    toleranceNm: 1e-7,
    description:
      "φ = 8 cos(2πx/N) + 3 sin(2πy/N); smooth adjacent phase changes below π.",
  },
  {
    id: "reflection",
    name: "Reflecting surface at 30°",
    kind: "accuracy",
    a: 1.2,
    b: 0.4,
    reflection: true,
    toleranceNm: 1e-7,
    description: "Known phase converted using λ/(4π cos 30°).",
  },
  {
    id: "noise",
    name: "Seeded camera noise",
    kind: "accuracy",
    a: 1.2,
    b: 0.4,
    noise: 0.003,
    toleranceNm: 1,
    description:
      "Independent uniform intensity noise with σ = 0.003, seed 4731; error RMS must stay below 1 nm.",
  },
  {
    id: "steps",
    name: "Phase-step calibration fault",
    kind: "diagnostic",
    a: 1.2,
    b: 0.4,
    step: 0.4,
    description:
      "90° frame offset by +0.4 rad. Expected: phase-step consistency residual above 5%.",
  },
  {
    id: "drift",
    name: "Exposure drift",
    kind: "diagnostic",
    a: 1.2,
    b: 0.4,
    drift: 1.25,
    description:
      "90° frame gain ×1.25. Expected: phase-step consistency residual above 5%.",
  },
  {
    id: "motion",
    name: "Inter-frame misregistration",
    kind: "diagnostic",
    a: 8,
    b: 3,
    shift: 8,
    description:
      "90° frame shifted 8 pixels in X. Expected: phase-step consistency residual above 5%.",
  },
  {
    id: "clipping",
    name: "Saturated camera samples",
    kind: "diagnostic",
    a: 1.2,
    b: 0.4,
    clip: true,
    description:
      "Intensity offset 0.6 and modulation 0.45, clipped to [0,1]. Expected: clipped pixels detected and excluded.",
  },
];
export function benchmarkInput(id) {
  const spec = benchmarks.find((b) => b.id === id);
  if (!spec) throw Error("Unknown benchmark.");
  const n = 128,
    settings = {
      ...defaultMeasurementSettings(),
      n,
      removeTilt: false,
      geometry: spec.reflection ? "reflection" : "opd",
      incidence: spec.reflection ? 30 : 0,
    },
    truth = new Float64Array(n * n);
  let seed = 4731;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const phase = (x, y) =>
      spec.a * Math.cos((2 * Math.PI * x) / n) +
      spec.b * Math.sin((2 * Math.PI * y) / n),
    scale =
      633 / (2 * Math.PI) / (spec.reflection ? 2 * Math.cos(Math.PI / 6) : 1);
  for (let i = 0; i < n * n; i++)
    truth[i] = phase(i % n, Math.floor(i / n)) * scale;
  const frames = Array.from({ length: 4 }, (_, j) => ({
    name: `${id}-${j * 90}.json`,
    origin: "synthetic validation benchmark",
    width: n,
    height: n,
    values: Float64Array.from({ length: n * n }, (_, i) => {
      const p = phase(
          (i % n) + (j === 1 ? spec.shift || 0 : 0),
          Math.floor(i / n),
        ),
        delta = (j * Math.PI) / 2 + (j === 1 ? spec.step || 0 : 0);
      let v =
        (spec.clip ? 0.6 : 0.5) +
        (spec.clip ? 0.45 : 0.4) * Math.cos(p + delta);
      if (j === 1 && spec.drift) v *= spec.drift;
      if (spec.noise) v += (random() - 0.5) * Math.sqrt(12) * spec.noise;
      return Math.max(0, Math.min(1, v));
    }),
  }));
  return {
    spec,
    n,
    settings,
    frames,
    truth,
    expectedPV: 2 * (spec.a + spec.b) * scale,
    expectedRMS: (Math.hypot(spec.a, spec.b) / Math.sqrt(2)) * scale,
  };
}
export function runBenchmark(id) {
  const input = benchmarkInput(id),
    { spec, n, truth } = input;
  try {
    const r = analyzeMeasurement(input.frames, input.settings);
    let count = 0,
      mean = 0;
    for (let i = 0; i < n * n; i++)
      if (r.mask[i]) {
        count++;
        mean += truth[i];
      }
    mean /= count;
    let sq = 0,
      max = 0;
    for (let i = 0; i < n * n; i++)
      if (r.mask[i]) {
        const e = r.height[i] - (truth[i] - mean);
        sq += e * e;
        max = Math.max(max, Math.abs(e));
      }
    const errorRMS = Math.sqrt(sq / count),
      diagnostic = spec.clip
        ? r.stats.clippedPixels > 0
        : r.stats.stepResidual > 0.05;
    const passed =
      spec.kind === "accuracy"
        ? errorRMS <= spec.toleranceNm &&
          r.stats.validFraction > 0.99 &&
          r.stats.unwrapConflicts === 0
        : diagnostic;
    return {
      id,
      name: spec.name,
      kind: spec.kind,
      passed,
      engine: METROLOGY_VERSION,
      spec: { ...spec },
      settings: input.settings,
      seed: 4731,
      expectedPV: input.expectedPV,
      expectedRMS: input.expectedRMS,
      recoveredPV: r.stats.pvNm,
      recoveredRMS: r.stats.rmsNm,
      errorRMS,
      maxError: max,
      validFraction: r.stats.validFraction,
      stepResidual: r.stats.stepResidual,
      clippedPixels: r.stats.clippedPixels,
      unwrapConflicts: r.stats.unwrapConflicts,
      warnings: r.warnings,
      profile: Array.from({ length: n }, (_, x) => {
        const i = (n / 2) * n + x;
        return {
          x,
          expected: truth[i] - mean,
          recovered: r.mask[i] ? r.height[i] : null,
        };
      }),
    };
  } catch (e) {
    return {
      id,
      name: spec.name,
      kind: spec.kind,
      passed: false,
      spec: { ...spec },
      error: e.message,
    };
  }
}
export function validationReport(results) {
  return {
    format: "optibench-validation",
    version: VALIDATION_VERSION,
    engine: METROLOGY_VERSION,
    createdAt: new Date().toISOString(),
    evidence:
      "Analytical and synthetic only; no physical instrument validation.",
    results,
  };
}
export function baselineReport(text) {
  if (text.length > 2e6) throw Error("Baseline report must be below 2 MB.");
  const r = JSON.parse(text);
  if (
    r.format !== "optibench-validation" ||
    r.version !== VALIDATION_VERSION ||
    !Array.isArray(r.results) ||
    r.results.length > benchmarks.length
  )
    throw Error("Unsupported validation baseline.");
  const seen = new Set();
  for (const v of r.results) {
    if (!benchmarks.some((b) => b.id === v.id) || seen.has(v.id))
      throw Error("Unknown or duplicate baseline case.");
    seen.add(v.id);
    if (v.errorRMS != null && (!Number.isFinite(v.errorRMS) || v.errorRMS < 0))
      throw Error("Invalid baseline error.");
  }
  return r;
}
