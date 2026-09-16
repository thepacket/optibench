import {
  validateRunbook,
  planRunbook,
  evaluateRunbookTrial,
  summarizeRunbook,
  runbookMetrics,
} from "./runbook.js";
import { importProfilerRecord } from "./profiler-records.js";
import { validateProject } from "./project.js";
import { meterConfig, makeZero } from "./power-meter.js";
export const canonical = (v) =>
  JSON.stringify(v, (_, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, x[k]]),
        )
      : x,
  );
function signature(r) {
  return canonical({
    table: r.project.table,
    items: r.project.items,
    stopOnFailure: r.stopOnFailure,
    steps: r.steps.map(({ id, label, ...s }) => s),
  });
}
export function compareRunbookRuns(baseline, current) {
  if (
    !baseline ||
    !current ||
    baseline.format !== "optibench-runbook-run" ||
    current.format !== "optibench-runbook-run"
  )
    throw Error("Choose a saved run and a current run.");
  if (signature(baseline.recipe) !== signature(current.recipe))
    throw Error(
      "Compare runs with the same bench, procedure settings and limits. Noise seeds may differ.",
    );
  const key = (r, t) =>
      `${r.recipe.steps.findIndex((s) => s.id === t.stepId)}:${t.index}:${t.repeat}`,
    old = new Map(baseline.trials.map((t) => [key(baseline, t), t])),
    rows = [];
  for (const t of current.trials) {
    const a = old.get(key(current, t));
    if (!a) continue;
    rows.push({
      label: t.label,
      index: t.index,
      repeat: t.repeat,
      metric: t.decision.metric || a.decision.metric || null,
      unit:
        runbookMetrics[t.kind][t.decision.metric || a.decision.metric]?.[1] ||
        "",
      kind: t.kind,
      baseline: a.decision.value,
      current: t.decision.value,
      delta:
        Number.isFinite(a.decision.value) && Number.isFinite(t.decision.value)
          ? t.decision.value - a.decision.value
          : null,
      before: a.decision.status,
      after: t.decision.status,
    });
  }
  if (!rows.length)
    throw Error("No matching completed acquisitions are available.");
  return {
    baselineId: baseline.id,
    currentId: current.id,
    rows,
    unmatchedBaseline: baseline.trials.length - rows.length,
    unmatchedCurrent: current.trials.length - rows.length,
    warnings: [
      ...(baseline.recipe.seed === current.recipe.seed
        ? [
            "The same noise seed was used. These runs are not independent repeatability samples.",
          ]
        : []),
      ...(baseline.status !== "completed" || current.status !== "completed"
        ? [
            "One or both runs are incomplete; comparison covers retained acquisitions only.",
          ]
        : []),
    ],
    note: "Observed differences and decision changes only; no statistical significance or hardware accuracy claim.",
  };
}

function reviewMeter(raw, expected, settings, seed, zero = null) {
  if (
    raw?.format !== "optibench-power-reading" ||
    raw.version !== 1 ||
    raw.detectorId !== expected.detectorId ||
    raw.seed !== seed ||
    !Number.isFinite(Date.parse(raw.acquiredAt))
  )
    throw Error("Invalid meter acquisition metadata.");
  const config = meterConfig(raw.settings),
    project = validateProject(raw.project);
  if (
    canonical(config) !== canonical(settings) ||
    canonical(project) !== canonical(expected.project) ||
    !Array.isArray(raw.samplesMw) ||
    raw.samplesMw.length !== config.averages ||
    raw.samplesMw.some((v) => !Number.isFinite(v) || Math.abs(v) > 1e9)
  )
    throw Error("Meter samples or acquisition conditions are inconsistent.");
  const samples = [...raw.samplesMw],
    mean = samples.reduce((s, v) => s + v, 0) / samples.length,
    overload = samples.some((v) => Math.abs(v) > config.rangeMw),
    resolutionMw = config.rangeMw / 100000;
  return {
    format: "optibench-power-reading",
    version: 1,
    id: crypto.randomUUID(),
    sourceId: raw.id,
    acquiredAt: raw.acquiredAt,
    project,
    detectorId: raw.detectorId,
    head: project.items.find((c) => c.id === raw.detectorId),
    settings: config,
    seed,
    zero,
    valueMw: overload
      ? null
      : Math.round((mean - (zero?.offsetMw || 0)) / resolutionMw) *
        resolutionMw,
    overload,
    resolutionMw,
    samplesMw: samples,
    sampleSdMw:
      samples.length > 1
        ? Math.sqrt(
            samples.reduce((s, v) => s + (v - mean) ** 2, 0) /
              (samples.length - 1),
          )
        : null,
    warnings: [],
    model:
      "Imported meter samples. Indicated power, overload and zero correction recomputed from raw samples. Physical provenance and calibration are not authenticated.",
  };
}
export function importRunbookData(text) {
  if (typeof text === "string" && text.length > 64 * 1024 * 1024)
    throw Error("Runbook imports are limited to 64 MB.");
  let raw;
  try {
    raw = typeof text === "string" ? JSON.parse(text) : text;
  } catch {
    throw Error("The selected file is not valid JSON.");
  }
  if (raw?.format === "optibench-runbook") {
    const r = validateRunbook(raw);
    planRunbook(r);
    return {
      ...r,
      id: crypto.randomUUID(),
      sourceId: r.id,
      importedAt: new Date().toISOString(),
    };
  }
  if (
    raw?.format !== "optibench-runbook-run" ||
    raw.version !== 1 ||
    typeof raw.id !== "string" ||
    raw.id.length > 200 ||
    !Number.isFinite(Date.parse(raw.createdAt)) ||
    !Number.isFinite(Date.parse(raw.finishedAt)) ||
    !["completed", "stopped", "cancelled", "interrupted"].includes(raw.status)
  )
    throw Error("Unsupported or unfinished Runbook data.");
  const { recipe, trials: planned } = planRunbook(raw.recipe);
  if (
    !Array.isArray(raw.trials) ||
    raw.trials.length > planned.length ||
    raw.expected !== planned.length ||
    (raw.status === "completed" && raw.trials.length !== planned.length)
  )
    throw Error("Run acquisition count does not match the procedure.");
  const trials = [];
  for (let i = 0; i < raw.trials.length; i++) {
    const r = raw.trials[i],
      p = planned[i],
      step = recipe.steps.find((s) => s.id === p.stepId);
    if (
      [
        "key",
        "stepId",
        "index",
        "repeat",
        "kind",
        "detectorId",
        "seed",
        "value",
      ].some((k) => r[k] !== p[k]) ||
      !Number.isFinite(Date.parse(r.startedAt)) ||
      !Number.isFinite(Date.parse(r.finishedAt))
    )
      throw Error(
        "Acquisitions must follow the recorded procedure order and seeds.",
      );
    let measurement = null,
      zeroReading = null,
      error = null;
    if (r.error !== null) {
      if (
        typeof r.error !== "string" ||
        !r.error ||
        r.error.length > 5000 ||
        r.measurement !== null
      )
        throw Error("Invalid acquisition error record.");
      error = r.error;
    }
    if (p.kind === "power") {
      if (r.zeroReading) {
        if (!step.captureZero) throw Error("Unexpected zero acquisition.");
        zeroReading = reviewMeter(
          r.zeroReading,
          p,
          { ...p.settings, shutter: true },
          p.seed + 1,
        );
      }
      if (!error) {
        if (step.captureZero && !zeroReading)
          throw Error("Missing zero acquisition.");
        measurement = reviewMeter(
          r.measurement,
          p,
          p.settings,
          p.seed + 2,
          zeroReading ? makeZero(zeroReading) : null,
        );
      }
    } else if (!error) {
      const m = r.measurement,
        s = m?.settings;
      if (
        !s ||
        m.frame?.n !== p.settings.n ||
        m.detectorId !== p.detectorId ||
        ["n", "backgroundFrames", "roiX", "roiY"].some(
          (k) => (s[k] ?? 0) !== p.settings[k],
        )
      )
        throw Error("Camera acquisition settings do not match the procedure.");
      if (step.autoExposure) {
        if (
          !Number.isFinite(s.exposure) ||
          s.exposure < 0.001 ||
          s.exposure > 10000 ||
          !Number.isInteger(s.seed) ||
          s.seed < p.seed ||
          s.seed > p.seed + 224 ||
          (s.seed - p.seed) % 32 !== 0
        )
          throw Error("Invalid automatic-exposure settings or seed.");
      } else if (s.exposure !== p.settings.exposure || s.seed !== p.seed)
        throw Error("Camera exposure or seed does not match the procedure.");
      const expected = structuredClone(p.project);
      expected.items.find((c) => c.id === p.detectorId).exposure = s.exposure;
      if (
        canonical(validateProject(m.project)) !==
        canonical(validateProject(expected))
      )
        throw Error("Camera bench snapshot does not match the procedure.");
      measurement = importProfilerRecord(m);
    }
    const trial = {
      ...p,
      startedAt: r.startedAt,
      finishedAt: r.finishedAt,
      measurement,
      zeroReading,
      error,
    };
    delete trial.project;
    delete trial.settings;
    trial.decision = evaluateRunbookTrial(
      p.kind,
      measurement,
      step.criterion,
      error,
    );
    trials.push(trial);
    if (
      recipe.stopOnFailure &&
      ["fail", "inconclusive", "error"].includes(trial.decision.status) &&
      i < raw.trials.length - 1
    )
      throw Error(
        "Recorded acquisitions continue past the procedure stop condition.",
      );
  }
  if (
    raw.status === "stopped" &&
    (!recipe.stopOnFailure ||
      !["fail", "inconclusive", "error"].includes(
        trials.at(-1)?.decision.status,
      ))
  )
    throw Error("The declared stop has no matching stop condition.");
  const run = {
    format: "optibench-runbook-run",
    version: 1,
    id: crypto.randomUUID(),
    sourceId: raw.id,
    importedAt: new Date().toISOString(),
    name: recipe.name,
    createdAt: raw.createdAt,
    finishedAt: raw.finishedAt,
    engine:
      typeof raw.engine === "string" ? raw.engine.slice(0, 50) : "unknown",
    recipe,
    expected: planned.length,
    status: raw.status,
    trials,
    events: trials.map((t) => ({
      at: t.finishedAt,
      type: "reviewed",
      message: `${t.label}: ${t.decision.status} (recomputed from imported data)`,
      key: t.key,
    })),
    reviewNote:
      "Imported acquisitions and decisions were recomputed from recorded pixels and meter samples. The imported execution log was reconstructed; file origin, timestamps and hardware calibration are not authenticated.",
  };
  run.summary = summarizeRunbook(run);
  return run;
}
