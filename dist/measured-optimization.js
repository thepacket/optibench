import { validateProject, ENGINE_VERSION, makeProject } from "./project.js";
import { acquireBeamProfile, profilerExample } from "./beam-profiler.js";
import {
  meterDefaults,
  meterConfig,
  readMeter,
  makeZero,
} from "./power-meter.js";
import { mechanicalChecks } from "./alignment.js";
import { trace } from "./optics.js";

export const alignmentGoals = {
  center: "Center beam on camera",
  diameter: "Target camera beam diameter",
  power: "Maximize indicated power",
};
export const alignmentFields = {
  x: {
    types: [
      "lens",
      "camera",
      "power",
      "mirror",
      "filter",
      "polarizer",
      "waveplate",
    ],
    unit: "mm",
  },
  y: {
    types: [
      "lens",
      "camera",
      "power",
      "mirror",
      "filter",
      "polarizer",
      "waveplate",
    ],
    unit: "mm",
  },
  z: { types: ["lens", "camera", "power", "mirror"], unit: "mm" },
  angle: { types: ["source", "mirror"], unit: "°" },
  axis: { types: ["polarizer", "waveplate"], unit: "°" },
};
export function alignmentVariable(p, id, field) {
  const c = p.items.find((c) => c.id === id),
    span = ["angle", "axis"].includes(field) ? 1 : field === "x" ? 10 : 0.1;
  return {
    componentId: id,
    field,
    min: c[field] - span,
    max: c[field] + span,
    resolution: span / 100,
  };
}
export function createAlignmentRecipe(project, goal = "center") {
  const p = validateProject(project),
    kind = goal === "power" ? "power" : "camera",
    d = p.items.find((c) => c.enabled && c.type === kind);
  const c =
    goal === "diameter"
      ? p.items.find((c) => c.enabled && !c.locked && c.type === "lens")
      : d;
  return {
    format: "optibench-alignment-procedure",
    version: 1,
    id: crypto.randomUUID(),
    name: alignmentGoals[goal],
    notes: "",
    createdAt: new Date().toISOString(),
    project: p,
    goal,
    detectorId: d?.id ?? null,
    target: 0.25,
    tolerance: 0.01,
    settings:
      kind === "camera"
        ? {
            n: goal === "center" ? 256 : 128,
            exposure: d?.exposure ?? 2,
            backgroundFrames: 4,
            roiX: 0,
            roiY: 0,
          }
        : meterDefaults(),
    variables: c
      ? [alignmentVariable(p, c.id, goal === "diameter" ? "x" : "y")]
      : [],
    maxEvaluations: goal === "center" ? 9 : 20,
    repeats: 1,
    verificationRepeats: 3,
    seed: 42,
  };
}
export function alignmentExample(goal = "center") {
  const p = goal === "power" ? makeProject("waveplates") : profilerExample();
  if (goal === "center") p.items.find((c) => c.type === "camera").y += 0.06;
  const r = createAlignmentRecipe(p, goal);
  if (goal === "diameter") {
    r.target = 0.23;
    r.variables[0].min = 620;
    r.variables[0].max = 700;
    r.variables[0].resolution = 0.1;
  }
  if (goal === "power") {
    const c = p.items.find((c) => c.type === "waveplate");
    r.variables = [
      { componentId: c.id, field: "axis", min: 0, max: 90, resolution: 0.1 },
    ];
  }
  return r;
}
export function validateAlignment(input) {
  if (
    input?.format !== "optibench-alignment-procedure" ||
    input.version !== 1 ||
    !Object.hasOwn(alignmentGoals, input.goal) ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 200 ||
    typeof input.notes !== "string" ||
    input.notes.length > 10000
  )
    throw Error("Use a named alignment procedure with a supported goal.");
  const r = structuredClone(input);
  r.project = validateProject(r.project);
  if (
    !Number.isInteger(r.seed) ||
    r.seed < 0 ||
    r.seed > 2147000000 ||
    !Number.isInteger(r.maxEvaluations) ||
    r.maxEvaluations < 3 ||
    r.maxEvaluations > 48 ||
    !Number.isInteger(r.repeats) ||
    r.repeats < 1 ||
    r.repeats > 3 ||
    !Number.isInteger(r.verificationRepeats) ||
    r.verificationRepeats < 3 ||
    r.verificationRepeats > 8
  )
    throw Error(
      "Use 3–48 search evaluations, 1–3 search repeats and 3–8 verification repeats with a valid integer seed.",
    );
  if (
    !Number.isFinite(r.tolerance) ||
    r.tolerance <= 0 ||
    !Number.isFinite(r.target) ||
    r.target <= 0
  )
    throw Error("Diameter and tolerance must be positive finite values.");
  const d = r.project.items.find(
    (c) =>
      c.id === r.detectorId &&
      c.enabled &&
      c.type === (r.goal === "power" ? "power" : "camera"),
  );
  if (!d) throw Error("Select an enabled detector matching the goal.");
  const acquisitions = r.maxEvaluations * r.repeats + 2 * r.verificationRepeats;
  if (acquisitions > 60)
    throw Error(
      "Limit the procedure to 60 readings including verification (plus power-meter zeros).",
    );
  if (r.goal === "power") {
    r.settings = meterConfig(r.settings);
    if (r.settings.shutter)
      throw Error("Power optimization requires an open shutter.");
  } else {
    const s = r.settings;
    if (
      !s ||
      ![64, 128, 256].includes(s.n) ||
      ![1, 4, 8, 16].includes(s.backgroundFrames) ||
      !Number.isFinite(s.exposure) ||
      s.exposure < 0.001 ||
      s.exposure > 10000 ||
      ![s.roiX, s.roiY].every(Number.isInteger)
    )
      throw Error("Invalid camera acquisition settings.");
    if (2 * s.n * s.n * acquisitions > 2000000)
      throw Error(
        "Camera budget exceeds two million raw pixel values. Reduce ROI, evaluations or repeats.",
      );
    for (const [pixels, offset] of [
      [d.pixelsX, s.roiX],
      [d.pixelsY, s.roiY],
    ]) {
      const origin = Math.floor((pixels - s.n) / 2) + offset;
      if (origin < 0 || origin + s.n > pixels)
        throw Error("ROI leaves the camera sensor.");
    }
  }
  if (
    !Array.isArray(r.variables) ||
    r.variables.length < 1 ||
    r.variables.length > 3
  )
    throw Error("Select 1–3 adjustable parameters.");
  const keys = new Set();
  for (const v of r.variables) {
    const c = r.project.items.find(
        (c) => c.id === v.componentId && c.enabled && !c.locked,
      ),
      f = alignmentFields[v.field],
      key = `${v.componentId}:${v.field}`;
    if (
      !c ||
      !f?.types.includes(c.type) ||
      keys.has(key) ||
      ![v.min, v.max, v.resolution, c[v.field]].every(Number.isFinite) ||
      v.min >= v.max ||
      v.resolution <= 0 ||
      v.resolution > v.max - v.min ||
      c[v.field] < v.min ||
      c[v.field] > v.max
    )
      throw Error(
        "Each variable needs an unlocked supported component, unique parameter, bounds containing its initial value, and positive resolution.",
      );
    keys.add(key);
    for (const value of [v.min, v.max]) {
      const p = structuredClone(r.project);
      p.items.find((c) => c.id === v.componentId)[v.field] = value;
      validateGeometry(p);
    }
  }
  validateGeometry(r.project);
  return r;
}
function validateGeometry(p) {
  const q = validateProject(p),
    errors = mechanicalChecks(q).filter((w) => w.level === "error");
  if (errors.length) throw Error(errors.map((e) => e.text).join(" "));
  return q;
}
export function alignmentProject(recipe, values) {
  const p = structuredClone(recipe.project);
  if (values.length !== recipe.variables.length)
    throw Error("Variable count mismatch.");
  recipe.variables.forEach((v, i) => {
    if (
      !Number.isFinite(values[i]) ||
      values[i] < v.min - 1e-9 ||
      values[i] > v.max + 1e-9
    )
      throw Error("Candidate exceeds parameter bounds.");
    p.items.find((c) => c.id === v.componentId)[v.field] = values[i];
  });
  return validateGeometry(p);
}
export function measuredObjective(recipe, measurement) {
  if (recipe.goal === "power") {
    if (measurement?.overload || !Number.isFinite(measurement?.valueMw))
      throw Error("Power reading overloaded or unavailable.");
    return {
      loss: -measurement.valueMw,
      metrics: { powerMw: measurement.valueMw },
    };
  }
  const a = measurement?.analysis;
  if (!a?.valid || measurement.frame?.saturated > 0)
    throw Error(
      measurement?.analysisError ||
        a?.warnings?.join(" ") ||
        "Camera measurement failed quality checks.",
    );
  const {
    sensorCentroidXmm: x,
    sensorCentroidYmm: y,
    diameterXmm: dx,
    diameterYmm: dy,
  } = a;
  if (![x, y, dx, dy].every(Number.isFinite))
    throw Error("Camera metrics unavailable.");
  return {
    loss:
      recipe.goal === "center"
        ? Math.hypot(x, y)
        : Math.hypot(dx - recipe.target, dy - recipe.target) / Math.SQRT2,
    metrics: {
      centroidXmm: x,
      centroidYmm: y,
      diameterXmm: dx,
      diameterYmm: dy,
    },
  };
}
const stats = (values) => {
  const mean = values.reduce((s, v) => s + v, 0) / values.length,
    sd =
      values.length > 1
        ? Math.sqrt(
            values.reduce((s, v) => s + (v - mean) ** 2, 0) /
              (values.length - 1),
          )
        : null;
  return {
    n: values.length,
    mean,
    sd,
    sem: sd === null ? null : sd / Math.sqrt(values.length),
  };
};
export function summarizeVerification(recipe, before, after) {
  if (
    before.length !== recipe.verificationRepeats ||
    after.length !== recipe.verificationRepeats ||
    [...before, ...after].some((t) => !t.valid)
  )
    return {
      accepted: false,
      outcome: "inconclusive",
      reason:
        "Fresh baseline and candidate verification must both complete with valid readings.",
    };
  const baseline = stats(before.map((t) => t.loss)),
    candidate = stats(after.map((t) => t.loss)),
    improvement = baseline.mean - candidate.mean,
    combinedSem = Math.hypot(baseline.sem, candidate.sem);
  const metrics = Object.fromEntries(
    Object.keys(before[0].metrics).map((k) => [
      k,
      {
        baseline: stats(before.map((t) => t.metrics[k])),
        candidate: stats(after.map((t) => t.metrics[k])),
      },
    ]),
  );
  const accepted = improvement > 2 * combinedSem && improvement > 0;
  return {
    accepted,
    outcome: accepted ? "improvement observed" : "improvement not resolved",
    baseline,
    candidate,
    metrics,
    improvement,
    combinedSem,
    targetMet:
      recipe.goal === "power" ? null : candidate.mean <= recipe.tolerance,
    reason:
      "Improvement must exceed twice the combined standard error of fresh mean losses. This is a noise-screening rule, not a confidence interval or hardware uncertainty claim.",
  };
}
export async function executeAlignment(
  input,
  {
    onEvent = () => {},
    cancelled = () => false,
    camera = acquireBeamProfile,
    power = readMeter,
  } = {},
) {
  const recipe = validateAlignment(input),
    initial = recipe.variables.map(
      (v) => recipe.project.items.find((c) => c.id === v.componentId)[v.field],
    );
  const run = {
    format: "optibench-alignment-run",
    version: 1,
    id: crypto.randomUUID(),
    name: recipe.name,
    createdAt: new Date().toISOString(),
    engine: ENGINE_VERSION,
    recipe,
    status: "running",
    evaluations: [],
    verificationBefore: [],
    verificationAfter: [],
    bestValues: initial,
    verification: null,
    stopReason: null,
  };
  onEvent({ type: "start", run: structuredClone(run) });
  let acquisition = 0;
  async function evaluate(values, phase, repeats) {
    const e = {
      index: run.evaluations.length,
      phase,
      values: [...values],
      at: new Date().toISOString(),
      readings: [],
      valid: false,
      loss: null,
      error: null,
    };
    try {
      const p = alignmentProject(recipe, values),
        traced = trace(p),
        errors = traced.warnings.filter((w) => w.level === "error");
      if (errors.length) throw Error(errors.map((w) => w.text).join(" "));
      if (!traced.detectors.some((h) => h.id === recipe.detectorId))
        throw Error("No beam reaches the detector.");
      for (let i = 0; i < repeats; i++) {
        if (cancelled()) throw Error("Cancelled between acquisitions.");
        const seed = recipe.seed + acquisition++ * 100;
        let measurement,
          zeroReading = null;
        if (recipe.goal === "power") {
          zeroReading = await power(
            p,
            recipe.detectorId,
            { ...recipe.settings, shutter: true },
            { seed },
          );
          measurement = await power(p, recipe.detectorId, recipe.settings, {
            seed: seed + 20,
            zero: makeZero(zeroReading),
          });
        } else
          measurement = await camera(p, {
            ...recipe.settings,
            detectorId: recipe.detectorId,
            seed,
          });
        const reading = { seed, measurement, zeroReading };
        e.readings.push(reading);
        reading.objective = measuredObjective(recipe, measurement);
      }
      e.loss = stats(e.readings.map((r) => r.objective.loss)).mean;
      e.metrics = Object.fromEntries(
        Object.keys(e.readings[0].objective.metrics).map((k) => [
          k,
          stats(e.readings.map((r) => r.objective.metrics[k])).mean,
        ]),
      );
      e.valid = true;
    } catch (error) {
      e.error = error.message;
    }
    run.evaluations.push(e);
    onEvent({ type: "evaluation", evaluation: structuredClone(e) });
    return e;
  }
  let best = await evaluate(initial, "baseline", recipe.repeats),
    steps = recipe.variables.map((v) => (v.max - v.min) / 4),
    count = 1;
  if (!best.valid) {
    run.stopReason =
      "Baseline is invalid. Adjust the bench or instrument settings before optimizing.";
  } else {
    while (count < recipe.maxEvaluations && !cancelled()) {
      let improved = false;
      for (let i = 0; i < steps.length && count < recipe.maxEvaluations; i++) {
        const anchor = [...best.values];
        for (const sign of [-1, 1]) {
          if (cancelled() || count >= recipe.maxEvaluations) break;
          const v = recipe.variables[i],
            values = [...anchor];
          const raw = Math.min(
            v.max,
            Math.max(v.min, anchor[i] + sign * steps[i]),
          );
          values[i] = Math.min(
            v.max,
            Math.max(
              v.min,
              initial[i] +
                Math.round((raw - initial[i]) / v.resolution) * v.resolution,
            ),
          );
          if (Math.abs(values[i] - anchor[i]) < v.resolution * 0.01) continue;
          const trial = await evaluate(values, "search", recipe.repeats);
          count++;
          if (trial.valid && trial.loss < best.loss) {
            best = trial;
            improved = true;
            run.bestValues = [...best.values];
            onEvent({ type: "best", values: run.bestValues });
          }
        }
      }
      if (!improved) steps = steps.map((s) => s / 2);
      if (steps.every((s, i) => s < recipe.variables[i].resolution)) {
        run.stopReason = "Parameter resolution reached.";
        break;
      }
    }
    if (!run.stopReason) run.stopReason = "Search evaluation budget reached.";
    if (!cancelled()) {
      for (let i = 0; i < recipe.verificationRepeats && !cancelled(); i++) {
        run.verificationBefore.push(
          await evaluate(initial, "verify-baseline", 1),
        );
        if (!cancelled())
          run.verificationAfter.push(
            await evaluate(best.values, "verify-candidate", 1),
          );
      }
      run.verification = summarizeVerification(
        recipe,
        run.verificationBefore,
        run.verificationAfter,
      );
    }
  }
  run.status = cancelled()
    ? "cancelled"
    : !best.valid
      ? "blocked"
      : "completed";
  run.finishedAt = new Date().toISOString();
  return run;
}
export function applyAlignment(run, current) {
  if (run?.status !== "completed" || !run.verification?.accepted)
    throw Error(
      "Only a completed alignment with a verified improvement can be applied.",
    );
  const recipe = validateAlignment(run.recipe),
    now = validateProject(current);
  if (
    JSON.stringify(now.items) !== JSON.stringify(recipe.project.items) ||
    JSON.stringify(now.table) !== JSON.stringify(recipe.project.table) ||
    now.solver !== recipe.project.solver
  )
    throw Error(
      "The live bench changed or differs from the procedure. Capture it and run again before applying.",
    );
  const candidate = alignmentProject(recipe, run.bestValues);
  return { ...now, items: candidate.items };
}
export function parseAlignmentProcedure(text) {
  if (text.length > 2 * 1024 * 1024)
    throw Error("Alignment procedure imports are limited to 2 MB.");
  const input = JSON.parse(text),
    r = validateAlignment(input);
  r.id = crypto.randomUUID();
  r.createdAt = new Date().toISOString();
  return r;
}
