import { trace } from "./optics.js";
import { validateProject, ENGINE_VERSION, makeProject } from "./project.js";
import { profilerExample, acquireBeamProfile } from "./beam-profiler.js";
import { autoExposeProfile } from "./profiler-workflows.js";
import {
  meterConfig,
  meterDefaults,
  readMeter,
  makeZero,
  incidentPower,
} from "./power-meter.js";

export const runbookMetrics = {
  camera: {
    diameterXmm: ["X diameter", "mm"],
    diameterYmm: ["Y diameter", "mm"],
    sensorCentroidXmm: ["Sensor X centroid", "mm"],
    sensorCentroidYmm: ["Sensor Y centroid", "mm"],
    ellipticity: ["Ellipticity", "ratio"],
  },
  power: { valueMw: ["Indicated power", "mW"] },
};
export const sweepFields = {
  x: { types: ["lens", "camera", "power"], unit: "mm" },
  y: { types: ["lens", "camera", "power"], unit: "mm" },
  axis: { types: ["polarizer", "waveplate"], unit: "°" },
  power: { types: ["source"], unit: "mW" },
  exposure: { types: ["camera"], unit: "ms" },
};
export function newRunbookStep(project, kind) {
  const detectors = project.items.filter(
    (c) => c.enabled && (c.type === "camera" || c.type === "power"),
  );
  const type =
      kind || (detectors.some((c) => c.type === "camera") ? "camera" : "power"),
    detector = detectors.find((c) => c.type === type);
  return {
    id: crypto.randomUUID(),
    label: type === "camera" ? "Camera profile" : "Power reading",
    kind: type,
    detectorId: detector?.id ?? null,
    repeats: 1,
    settings:
      type === "camera"
        ? {
            n: 256,
            exposure: detector?.exposure ?? 2,
            backgroundFrames: 4,
            roiX: 0,
            roiY: 0,
          }
        : meterDefaults(),
    autoExposure: false,
    captureZero: true,
    sweep: null,
    criterion: null,
  };
}
export function createRunbook(project) {
  const p = validateProject(project);
  return {
    format: "optibench-runbook",
    version: 1,
    id: crypto.randomUUID(),
    name: "New experiment procedure",
    notes: "",
    createdAt: new Date().toISOString(),
    project: p,
    seed: 42,
    stopOnFailure: true,
    steps: [newRunbookStep(p)],
  };
}
export function runbookExample(kind = "camera") {
  const r = createRunbook(
    kind === "camera" ? profilerExample() : makeProject("waveplates"),
  );
  r.name =
    kind === "camera"
      ? "Camera exposure qualification"
      : "Waveplate transmission survey";
  r.stopOnFailure = false;
  const s = r.steps[0];
  if (kind === "camera") {
    s.label = "Exposure sweep";
    s.sweep = {
      componentId: s.detectorId,
      field: "exposure",
      start: 0.5,
      end: 4,
      count: 5,
    };
    s.criterion = { metric: "diameterXmm", min: 0.2, max: 0.35 };
  } else {
    s.label = "Half-wave plate angle sweep";
    s.sweep = { componentId: 2, field: "axis", start: 0, end: 90, count: 9 };
    s.criterion = { metric: "valueMw", min: 0, max: 0.00002 };
  }
  return r;
}
export function validateRunbook(input) {
  if (
    input?.format !== "optibench-runbook" ||
    input.version !== 1 ||
    typeof input.id !== "string" ||
    !/^[a-zA-Z0-9_-]+$/.test(input.id) ||
    input.id.length > 200 ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 200 ||
    typeof input.notes !== "string" ||
    input.notes.length > 10000
  )
    throw Error("Name the procedure and use a supported Runbook format.");
  const r = structuredClone(input);
  r.project = validateProject(r.project);
  if (
    !Number.isInteger(r.seed) ||
    r.seed < 0 ||
    r.seed > 2147000000 ||
    typeof r.stopOnFailure !== "boolean" ||
    !Array.isArray(r.steps) ||
    r.steps.length < 1 ||
    r.steps.length > 12
  )
    throw Error("Use 1–12 steps and an integer seed from 0 to 2147000000.");
  const ids = new Set();
  for (const s of r.steps) {
    if (
      typeof s.id !== "string" ||
      !/^[a-zA-Z0-9_-]+$/.test(s.id) ||
      ids.has(s.id) ||
      s.id.length > 200 ||
      typeof s.label !== "string" ||
      !s.label.trim() ||
      s.label.length > 200 ||
      !["camera", "power"].includes(s.kind) ||
      !Number.isInteger(s.repeats) ||
      s.repeats < 1 ||
      s.repeats > 10 ||
      typeof s.autoExposure !== "boolean" ||
      typeof s.captureZero !== "boolean"
    )
      throw Error(
        "Each step needs a unique ID, name, instrument and 1–10 repeats.",
      );
    ids.add(s.id);
    const detector = r.project.items.find(
      (c) => c.id === s.detectorId && c.enabled && c.type === s.kind,
    );
    if (!detector)
      throw Error(`${s.label}: select an enabled ${s.kind} detector.`);
    if (s.kind === "power") {
      s.settings = meterConfig(s.settings);
      if (s.settings.shutter)
        throw Error(
          "Runbook power readings require an open shutter; zeroing is automatic when selected.",
        );
      if (s.autoExposure)
        throw Error("Automatic exposure is available only for camera steps.");
    } else {
      const c = s.settings;
      if (
        !c ||
        ![64, 128, 256].includes(c.n) ||
        ![1, 4, 8, 16].includes(c.backgroundFrames) ||
        !Number.isFinite(c.exposure) ||
        c.exposure < 0.001 ||
        c.exposure > 10000 ||
        ![c.roiX, c.roiY].every(Number.isInteger)
      )
        throw Error(`${s.label}: invalid camera settings.`);
    }
    if (s.sweep) {
      const v = s.sweep,
        c = r.project.items.find((c) => c.id === v.componentId && c.enabled),
        def = sweepFields[v.field];
      if (
        !c ||
        !def ||
        !def.types.includes(c.type) ||
        ![v.start, v.end].every(Number.isFinite) ||
        v.start === v.end ||
        !Number.isInteger(v.count) ||
        v.count < 2 ||
        v.count > 21
      )
        throw Error(
          `${s.label}: select a supported component parameter and 2–21 distinct sweep points.`,
        );
      if (
        s.autoExposure &&
        v.field === "exposure" &&
        v.componentId === s.detectorId
      )
        throw Error("An exposure sweep cannot also use automatic exposure.");
      if (
        v.field === "exposure" &&
        (v.componentId !== s.detectorId || s.kind !== "camera")
      )
        throw Error("Exposure sweeps must target this step’s camera.");
    }
    if (s.criterion) {
      const c = s.criterion;
      if (
        !Object.hasOwn(runbookMetrics[s.kind], c.metric) ||
        !["min", "max"].every((k) => c[k] === null || Number.isFinite(c[k])) ||
        (c.min === null && c.max === null) ||
        (c.min !== null && c.max !== null && c.min > c.max)
      )
        throw Error(
          `${s.label}: choose a measured quantity and valid acceptance bounds.`,
        );
    }
  }
  return r;
}
export function planRunbook(input) {
  const recipe = validateRunbook(input),
    trials = [];
  let pixelValues = 0;
  for (const step of recipe.steps)
    for (let index = 0; index < (step.sweep?.count || 1); index++)
      for (let repeat = 0; repeat < step.repeats; repeat++) {
        if (trials.length >= 40)
          throw Error(
            "Procedure exceeds the browser budget of 40 acquisitions.",
          );
        const project = structuredClone(recipe.project),
          settings = structuredClone(step.settings),
          value = step.sweep
            ? step.sweep.start +
              ((step.sweep.end - step.sweep.start) * index) /
                (step.sweep.count - 1)
            : null;
        if (step.sweep) {
          project.items.find((c) => c.id === step.sweep.componentId)[
            step.sweep.field
          ] = value;
          if (step.sweep.field === "exposure") settings.exposure = value;
        }
        if (step.kind === "camera") {
          project.items.find((c) => c.id === step.detectorId).exposure =
            settings.exposure;
          const cam = project.items.find((c) => c.id === step.detectorId),
            ox = Math.floor((cam.pixelsX - settings.n) / 2) + settings.roiX,
            oy = Math.floor((cam.pixelsY - settings.n) / 2) + settings.roiY;
          if (
            ox < 0 ||
            oy < 0 ||
            ox + settings.n > cam.pixelsX ||
            oy + settings.n > cam.pixelsY
          )
            throw Error(`${step.label}: ROI leaves the camera sensor.`);
          pixelValues += 2 * settings.n ** 2;
          if (pixelValues > 2000000)
            throw Error(
              "Procedure exceeds the browser budget of two million stored camera pixel values.",
            );
        }
        const snapshot = validateProject(project);
        if (
          snapshot.items.some(
            (c) =>
              c.enabled &&
              (c.x < 0 ||
                c.y < 0 ||
                c.x > snapshot.table.width ||
                c.y > snapshot.table.height),
          )
        )
          throw Error("A sweep position leaves the optical table.");
        trials.push({
          key: `${step.id}:${index}:${repeat}`,
          stepId: step.id,
          label: step.label,
          kind: step.kind,
          detectorId: step.detectorId,
          index,
          repeat,
          value,
          settings,
          project: snapshot,
          seed: recipe.seed + trials.length * 10000,
        });
      }
  if (trials.length > 40 || pixelValues > 2000000)
    throw Error(
      "Procedure exceeds the browser budget: at most 40 acquisitions and two million stored camera pixel values. Reduce repeats, points or ROI size.",
    );
  return { recipe, trials, pixelValues };
}
export const runbookStore = {
  access(value) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("optibench-runbooks", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("records", { keyPath: "id" });
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("records", value ? "readwrite" : "readonly"),
          q = value
            ? tx.objectStore("records").put(value)
            : tx.objectStore("records").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(q.result);
        };
        tx.onerror = tx.onabort = () => {
          db.close();
          reject(tx.error || Error("Runbook storage failed. Export a backup."));
        };
      };
    });
  },
  save(value) {
    return this.access(value);
  },
  list() {
    return this.access();
  },
};

export function preflightRunbook(input) {
  let plan;
  try {
    plan = planRunbook(input);
  } catch (e) {
    return {
      ok: false,
      errors: [e.message],
      warnings: [],
      acquisitions: 0,
      pixelValues: 0,
    };
  }
  const errors = new Set(),
    warnings = new Set();
  for (const t of plan.trials) {
    try {
      const tr = trace(t.project);
      if (t.kind === "camera") {
        if (
          t.project.items.filter((c) => c.enabled && c.type === "source")
            .length !== 1 ||
          t.project.items.some(
            (c) =>
              c.enabled &&
              ![
                "source",
                "camera",
                "screen",
                "lens",
                "filter",
                "polarizer",
                "waveplate",
                "mechanical",
              ].includes(c.type),
          )
        )
          throw Error(
            "Camera profiling requires a supported single-source straight path.",
          );
        const hits = tr.detectors.filter((h) => h.id === t.detectorId);
        if (hits.length !== 1)
          throw Error("Exactly one beam must reach the camera.");
        if (hits[0].incidence > 5)
          throw Error("Camera incidence exceeds the supported 5° limit.");
        if (tr.warnings.some((w) => w.level === "error"))
          throw Error(
            tr.warnings
              .filter((w) => w.level === "error")
              .map((w) => w.text)
              .join(" "),
          );
      } else {
        incidentPower(t.project, t.detectorId);
        if (!tr.detectors.some((h) => h.id === t.detectorId))
          warnings.add(
            `${t.label}: no traced beam reaches the power head at one or more points.`,
          );
      }
      for (const w of tr.warnings) warnings.add(`${t.label}: ${w.text}`);
    } catch (e) {
      errors.add(`${t.label}, point ${t.index + 1}: ${e.message}`);
    }
  }
  if (plan.recipe.steps.some((s) => s.autoExposure))
    warnings.add(
      "Automatic exposure may change exposure between acquisitions. Recorded values retain the final settings.",
    );
  if (plan.recipe.steps.some((s) => !s.criterion))
    warnings.add(
      "Steps without acceptance limits are recorded as measured, never as passed.",
    );
  return {
    ok: errors.size === 0,
    errors: [...errors],
    warnings: [...warnings],
    acquisitions: plan.trials.length,
    pixelValues: plan.pixelValues,
  };
}
export function evaluateRunbookTrial(
  kind,
  measurement,
  criterion,
  error = null,
) {
  if (error) return { status: "error", value: null, reason: error, criterion };
  if (kind === "camera" && !measurement?.analysis?.valid)
    return {
      status: "inconclusive",
      value: null,
      reason:
        measurement?.analysisError ||
        measurement?.analysis?.warnings?.join(" ") ||
        measurement?.warnings?.join(" ") ||
        "Camera quality checks failed.",
      criterion,
    };
  if (
    kind === "power" &&
    (measurement?.overload || !Number.isFinite(measurement?.valueMw))
  )
    return {
      status: "inconclusive",
      value: null,
      reason: "Power reading overloaded or unavailable.",
      criterion,
    };
  const metric =
      criterion?.metric || (kind === "camera" ? "diameterXmm" : "valueMw"),
    value =
      kind === "camera" ? measurement.analysis[metric] : measurement[metric];
  if (!Number.isFinite(value))
    return {
      status: "inconclusive",
      value: null,
      reason: "Requested measured quantity is unavailable.",
      criterion,
    };
  if (!criterion)
    return {
      status: "measured",
      value,
      metric,
      reason: "No acceptance limits specified.",
      criterion: null,
    };
  const passed =
    (criterion.min === null || value >= criterion.min) &&
    (criterion.max === null || value <= criterion.max);
  return {
    status: passed ? "pass" : "fail",
    value,
    metric,
    reason: passed
      ? "Measured value is within inclusive bounds."
      : "Measured value is outside the specified bounds.",
    criterion: structuredClone(criterion),
  };
}
export function summarizeRunbook(run) {
  const counts = { pass: 0, fail: 0, inconclusive: 0, error: 0, measured: 0 };
  for (const t of run.trials) counts[t.decision.status]++;
  const complete =
    run.trials.length === run.expected && run.status === "completed";
  return {
    ...counts,
    recorded: run.trials.length,
    expected: run.expected,
    outcome: counts.fail
      ? "fail"
      : !complete || counts.inconclusive || counts.error
        ? "inconclusive"
        : counts.measured
          ? counts.pass
            ? "partially evaluated"
            : "not evaluated"
          : "pass",
  };
}
export async function executeRunbook(
  input,
  {
    onEvent = () => {},
    cancelled = () => false,
    camera = acquireBeamProfile,
    power = readMeter,
    auto = autoExposeProfile,
  } = {},
) {
  const check = preflightRunbook(input);
  if (!check.ok) throw Error(check.errors.join("\n"));
  const { recipe, trials } = planRunbook(input),
    run = {
      format: "optibench-runbook-run",
      version: 1,
      id: crypto.randomUUID(),
      name: recipe.name,
      createdAt: new Date().toISOString(),
      finishedAt: null,
      engine: ENGINE_VERSION,
      recipe,
      expected: trials.length,
      preflight: check,
      status: "running",
      trials: [],
      events: [],
    };
  function log(type, message, key = null) {
    const event = { at: new Date().toISOString(), type, message, key };
    run.events.push(event);
    onEvent({ type: "event", event });
  }
  onEvent({ type: "start", run: structuredClone(run) });
  log("started", "Procedure started.");
  for (const t of trials) {
    if (cancelled()) {
      run.status = "cancelled";
      log("cancelled", "Cancelled between acquisitions.");
      break;
    }
    const step = recipe.steps.find((s) => s.id === t.stepId),
      trial = {
        ...t,
        startedAt: new Date().toISOString(),
        measurement: null,
        zeroReading: null,
        error: null,
      };
    delete trial.project;
    delete trial.settings;
    log(
      "acquiring",
      `${t.label} · point ${t.index + 1} · repeat ${t.repeat + 1}`,
      t.key,
    );
    try {
      if (t.kind === "camera")
        trial.measurement = await (step.autoExposure ? auto : camera)(
          t.project,
          { ...t.settings, detectorId: t.detectorId, seed: t.seed },
        );
      else {
        let zero = null;
        if (step.captureZero) {
          trial.zeroReading = await power(
            t.project,
            t.detectorId,
            { ...t.settings, shutter: true },
            { seed: t.seed + 1 },
          );
          zero = makeZero(trial.zeroReading);
        }
        trial.measurement = await power(t.project, t.detectorId, t.settings, {
          seed: t.seed + 2,
          zero,
        });
      }
    } catch (e) {
      trial.error = e.message;
    }
    trial.finishedAt = new Date().toISOString();
    trial.decision = evaluateRunbookTrial(
      t.kind,
      trial.measurement,
      step.criterion,
      trial.error,
    );
    run.trials.push(trial);
    onEvent({ type: "trial", trial: structuredClone(trial) });
    log("recorded", `${t.label}: ${trial.decision.status}`, t.key);
    if (
      recipe.stopOnFailure &&
      ["fail", "inconclusive", "error"].includes(trial.decision.status)
    ) {
      run.status = "stopped";
      log("stopped", "Stopped after a failed or inconclusive acquisition.");
      break;
    }
  }
  if (run.status === "running") run.status = "completed";
  run.finishedAt = new Date().toISOString();
  run.summary = summarizeRunbook(run);
  log(
    run.status,
    `Procedure ${run.status}; ${run.trials.length}/${run.expected} acquisitions retained.`,
  );
  return run;
}
