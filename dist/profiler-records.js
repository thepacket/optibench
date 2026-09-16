import { validateProject } from "./project.js";
import { analyzeBeamFrame, fitBeamPropagation } from "./beam-profiler.js";
import {
  summarizeProfileRepeats,
  profileFrames,
} from "./profiler-workflows.js";
import { trace } from "./optics.js";
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const text = (v, max = 2000) => (typeof v === "string" ? v.slice(0, max) : "");
const formats = [
  "optibench-beam-profile",
  "optibench-beam-scan",
  "optibench-beam-repeat",
];
function header(r) {
  if (
    !r ||
    !formats.includes(r.format) ||
    r.version !== 1 ||
    typeof r.id !== "string" ||
    r.id.length > 200 ||
    !Number.isFinite(Date.parse(r.acquiredAt))
  )
    throw Error("Unsupported or invalid OptiBench profiler record.");
  return {
    format: r.format,
    version: 1,
    id: crypto.randomUUID(),
    acquiredAt: r.acquiredAt,
    importedAt: new Date().toISOString(),
    sourceId: r.id,
    name: text(r.name, 200),
    notes: text(r.notes, 10000),
  };
}
function frameRecord(r) {
  const h = header(r);
  if (h.format !== formats[0]) throw Error("Expected a camera profile frame.");
  const project = validateProject(r.project),
    camera = project.items.find(
      (c) => c.id === r.detectorId && c.type === "camera" && c.enabled,
    ),
    n = r.frame?.n;
  if (
    !camera ||
    ![64, 128, 256, 512].includes(n) ||
    camera.pixelsX < n ||
    camera.pixelsY < n ||
    r.settings?.n !== n ||
    r.camera?.pixelPitch !== camera.pixelPitch ||
    r.camera?.exposure !== camera.exposure
  )
    throw Error("Camera, settings and frame metadata disagree.");
  for (const a of [r.frame.values, r.dark])
    if (
      !Array.isArray(a) ||
      a.length !== n * n ||
      a.some((v) => !finite(v, 0, 1))
    )
      throw Error(
        "Pixel arrays must contain finite normalized ADC values with matching dimensions.",
      );
  if (
    !finite(r.frame.saturated, 0, 1) ||
    !Number.isInteger(r.settings.seed) ||
    !finite(r.settings.seed, 0, 2147483000) ||
    ![1, 4, 8, 16].includes(r.settings.backgroundFrames) ||
    r.settings.exposure !== camera.exposure
  )
    throw Error("Invalid acquisition settings.");
  const roiX = r.settings.roiX ?? 0,
    roiY = r.settings.roiY ?? 0,
    originX = Math.floor((camera.pixelsX - n) / 2) + roiX,
    originY = Math.floor((camera.pixelsY - n) / 2) + roiY,
    pitch = camera.pixelPitch / 1000;
  if (
    !Number.isInteger(roiX) ||
    !Number.isInteger(roiY) ||
    originX < 0 ||
    originY < 0 ||
    originX + n > camera.pixelsX ||
    originY + n > camera.pixelsY ||
    r.roi?.originX !== originX ||
    r.roi?.originY !== originY
  )
    throw Error("Invalid sensor ROI metadata.");
  const roi = {
    originX,
    originY,
    widthMm: n * pitch,
    offsetXmm: (originX + (n - camera.pixelsX) / 2) * pitch,
    offsetYmm: (originY + (n - camera.pixelsY) / 2) * pitch,
  };
  const frame = {
      n,
      values: [...r.frame.values],
      saturated: Math.max(
        r.frame.saturated,
        r.frame.values.filter(
          (v) =>
            v >=
            Math.round(Math.min(1, camera.gain) * (2 ** camera.bits - 1)) /
              (2 ** camera.bits - 1),
        ).length /
          (n * n),
      ),
    },
    dark = [...r.dark];
  let analysis = null,
    analysisError = null;
  try {
    analysis = analyzeBeamFrame(frame, dark, camera.pixelPitch);
    analysis.sensorCentroidXmm = analysis.centroidXmm + roi.offsetXmm;
    analysis.sensorCentroidYmm = analysis.centroidYmm + roi.offsetYmm;
  } catch (e) {
    analysisError = e.message;
  }
  const tr = trace(project),
    hit = tr.detectors.filter((h) => h.id === camera.id),
    warnings = tr.warnings.map((w) => w.text);
  if (
    hit.length !== 1 ||
    project.items.filter((c) => c.enabled && c.type === "source").length !==
      1 ||
    project.items.some(
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
    ) ||
    tr.warnings.some((w) => w.level === "error") ||
    hit.some((h) => Math.abs(h.incidence) > 5)
  )
    warnings.push(
      "Imported bench is outside the supported single-beam acquisition model.",
    );
  if (hit[0])
    for (const encounter of tr.hits.filter((h) =>
      hit[0].path.some((c) => c.id === h.id),
    )) {
      const c = project.items.find((c) => c.id === encounter.id);
      if (
        c.type === "lens" &&
        encounter.radius * 3 > (c.aperture || c.diameter) / 2
      )
        warnings.push("A lens aperture may truncate the beam.");
    }
  if (analysis && warnings.length) analysis.valid = false;
  return {
    ...h,
    project,
    detectorId: r.detectorId,
    camera: { ...camera },
    settings: {
      n,
      seed: r.settings.seed,
      exposure: camera.exposure,
      backgroundFrames: r.settings.backgroundFrames,
      roiX,
      roiY,
    },
    roi,
    frame,
    dark,
    backgroundSeeds: Array.from(
      { length: r.settings.backgroundFrames },
      (_, i) => r.settings.seed + i + 1,
    ),
    analysis,
    analysisError,
    warnings,
    model:
      "Imported simulated camera data. Analysis recomputed from recorded signal and averaged background pixels; stored fits were discarded. File origin and optical calibration are not authenticated.",
  };
}
function sameConditions(a, b) {
  const fields = ["n", "exposure", "backgroundFrames", "roiX", "roiY"];
  return (
    a.detectorId === b.detectorId &&
    fields.every((k) => a.settings[k] === b.settings[k])
  );
}
export function importProfilerRecord(input) {
  if (typeof input === "string" && input.length > 64 * 1024 * 1024)
    throw Error("Profiler imports are limited to 64 MB.");
  let raw;
  try {
    raw = typeof input === "string" ? JSON.parse(input) : input;
  } catch {
    throw Error("The selected file is not valid JSON.");
  }
  const h = header(raw);
  if (h.format === formats[0]) return frameRecord(raw);
  const project = validateProject(raw.project);
  if (h.format === formats[2]) {
    if (
      !Array.isArray(raw.records) ||
      ![3, 5, 10].includes(raw.records.length) ||
      raw.count !== raw.records.length
    )
      throw Error("Invalid repeatability record count.");
    const records = raw.records.map(frameRecord),
      first = records[0];
    if (
      records.some(
        (r) =>
          !sameConditions(first, r) ||
          JSON.stringify(r.project) !== JSON.stringify(first.project),
      )
    )
      throw Error(
        "Repeatability frames must share the same bench and acquisition settings.",
      );
    return {
      ...h,
      project: first.project,
      settings: { ...first.settings, detectorId: first.detectorId },
      count: records.length,
      records,
      summary: summarizeProfileRepeats(records),
    };
  }
  const t = raw.travel;
  if (
    !Array.isArray(raw.points) ||
    !t ||
    raw.points.length !== t.count ||
    !Number.isInteger(t.count) ||
    t.count < 7 ||
    t.count > 21 ||
    !finite(t.start, -1500, 1500) ||
    !finite(t.end, -1500, 1500) ||
    t.end <= t.start
  )
    throw Error("Invalid propagation travel or frame count.");
  const points = raw.points.map((p) => ({
      positionMm: p.positionMm,
      record: frameRecord(p.record),
    })),
    first = points[0].record,
    base = project.items.find(
      (c) => c.id === first.detectorId && c.type === "camera",
    );
  if (!base) throw Error("Missing reference camera.");
  for (let i = 0; i < points.length; i++) {
    const p = points[i],
      expected = t.start + ((t.end - t.start) * i) / (t.count - 1),
      snapshot = structuredClone(project),
      camera = snapshot.items.find((c) => c.id === base.id);
    camera.x += Math.cos((base.angle * Math.PI) / 180) * expected;
    camera.y += Math.sin((base.angle * Math.PI) / 180) * expected;
    camera.exposure = first.camera.exposure;
    if (
      !finite(p.positionMm, -1500, 1500) ||
      Math.abs(p.positionMm - expected) > 1e-7 ||
      !sameConditions(first, p.record) ||
      JSON.stringify(validateProject(snapshot)) !==
        JSON.stringify(p.record.project)
    )
      throw Error("Scan positions or bench snapshots are inconsistent.");
  }
  const paths = points.map((p) =>
    trace(p.record.project)
      .detectors.find((h) => h.id === base.id)
      ?.path.map((h) => h.id)
      .join(","),
  );
  if (!paths[0] || paths.some((p) => p !== paths[0]))
    throw Error("Imported scan crosses an optic or loses the beam.");
  const fits = {},
    errors = {};
  for (const axis of ["x", "y"])
    try {
      fits[axis] = fitBeamPropagation(points, axis);
    } catch (e) {
      errors[axis] = e.message;
    }
  return {
    ...h,
    project,
    settings: { ...first.settings, detectorId: first.detectorId },
    travel: { ...t },
    points,
    fits,
    errors,
    model:
      "Imported propagation scan. All profiles and propagation fits recomputed from recorded pixels. File origin and calibration are not authenticated.",
  };
}

export function compareProfilerRecords(baseline, current) {
  if (!baseline || !current || baseline.format !== current.format)
    throw Error(
      "Choose a saved record of the same kind as the current result.",
    );
  const left = profileFrames(baseline)[0],
    right = profileFrames(current)[0],
    conditions = [];
  for (const key of ["n", "exposure", "backgroundFrames", "roiX", "roiY"])
    if ((left.settings[key] ?? 0) !== (right.settings[key] ?? 0))
      conditions.push(`${key} differs`);
  for (const key of [
    "pixelPitch",
    "gain",
    "qe",
    "readNoise",
    "darkCurrent",
    "fullWell",
    "bits",
    "angle",
  ])
    if (left.camera[key] !== right.camera[key])
      conditions.push(`Camera ${key} differs`);
  if (
    JSON.stringify(left.project.items) !== JSON.stringify(right.project.items)
  )
    conditions.push("Bench snapshots differ");
  const rows = [];
  function add(label, unit, a, b) {
    if (!Number.isFinite(a) || !Number.isFinite(b)) return;
    rows.push({
      label,
      unit,
      baseline: a,
      current: b,
      delta: b - a,
      percent: a === 0 ? null : ((b - a) / Math.abs(a)) * 100,
    });
  }
  if (current.format === "optibench-beam-profile") {
    if (!left.analysis?.valid || !right.analysis?.valid)
      throw Error("Both profiles must pass their measurement quality checks.");
    for (const key of [
      "diameterXmm",
      "diameterYmm",
      "sensorCentroidXmm",
      "sensorCentroidYmm",
    ])
      add(
        key,
        "mm",
        left.analysis[key] ??
          (key === "sensorCentroidXmm"
            ? left.analysis.centroidXmm + left.roi.offsetXmm
            : left.analysis.centroidYmm + left.roi.offsetYmm),
        right.analysis[key] ??
          (key === "sensorCentroidXmm"
            ? right.analysis.centroidXmm + right.roi.offsetXmm
            : right.analysis.centroidYmm + right.roi.offsetYmm),
      );
  } else if (current.format === "optibench-beam-repeat") {
    if (baseline.summary.error || current.summary.error)
      throw Error("Both repeatability records need valid statistics.");
    for (const key of Object.keys(current.summary.metrics))
      add(
        key + " mean",
        "mm",
        baseline.summary.metrics[key]?.mean,
        current.summary.metrics[key].mean,
      );
  } else if (current.format === "optibench-beam-scan") {
    const lc = baseline.project.items.find((c) => c.id === left.detectorId),
      rc = current.project.items.find((c) => c.id === right.detectorId),
      sameOrigin = ["x", "y", "z", "angle"].every((k) => lc?.[k] === rc?.[k]);
    if (!sameOrigin)
      conditions.push(
        "Waist positions use different camera origins and are not compared",
      );
    for (const axis of ["x", "y"]) {
      const a = baseline.fits[axis],
        b = current.fits[axis];
      if (!a || !b) {
        conditions.push(`${axis.toUpperCase()} fit unavailable in one record`);
        continue;
      }
      add(axis + " waist radius", "mm", a.waistRadiusMm, b.waistRadiusMm);
      add(axis + " half-angle", "mrad", a.halfAngleMrad, b.halfAngleMrad);
      if (sameOrigin)
        add(
          axis + " waist position",
          "mm",
          a.waistPositionMm,
          b.waistPositionMm,
        );
    }
  }
  if (!rows.length)
    throw Error("No valid comparable quantities are available.");
  return {
    baselineId: baseline.id,
    currentId: current.id,
    baselineAt: baseline.acquiredAt,
    currentAt: current.acquiredAt,
    conditions,
    rows,
    note: "Observed differences only; this comparison does not establish statistical significance or calibration accuracy.",
  };
}
