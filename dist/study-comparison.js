import { reopenSimulationStudy } from "./sweep-archive.js";
export const comparisonMetrics = [
  ["intensity", "Center intensity · normalized"],
  ["visibility", "Mean visibility"],
  ["errorRMSNm", "Reconstruction error RMS · nm"],
  ["validFraction", "Valid area fraction"],
];
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function benchDifferences(a, b) {
  const changes = [];
  function walk(x, y, path) {
    if (same(x, y)) return;
    if (
      x &&
      y &&
      typeof x === "object" &&
      typeof y === "object" &&
      !Array.isArray(x) &&
      !Array.isArray(y)
    ) {
      for (const key of new Set([...Object.keys(x), ...Object.keys(y)]))
        walk(x[key], y[key], path ? path + "." + key : key);
    } else changes.push({ path, a: x ?? null, b: y ?? null });
  }
  for (const key of ["table", "solver", "wave", "notes", "title"])
    walk(a[key], b[key], "Bench." + key);
  const aa = new Map(a.items.map((c) => [c.id, c])),
    bb = new Map(b.items.map((c) => [c.id, c]));
  for (const id of new Set([...aa.keys(), ...bb.keys()]))
    walk(aa.get(id), bb.get(id), `Component ${id}`);
  return changes;
}
export function compareStudies(left, right) {
  if (left?.id === right?.id)
    throw Error("Choose two different saved revisions.");
  const ra = reopenSimulationStudy(left),
    rb = reopenSimulationStudy(right),
    a = ra.study,
    b = rb.study,
    issues = [],
    warnings = [];
  if (a.config.parameter !== b.config.parameter)
    issues.push("Different swept parameters or units.");
  if (
    a.rows.length !== b.rows.length ||
    a.rows.some(
      (r, i) => !b.rows[i] || Math.abs(r.value - b.rows[i].value) > 1e-9,
    )
  )
    issues.push(
      "Different sweep grids or ranges. No interpolation is applied.",
    );
  if (a.config.detectorId !== b.config.detectorId)
    issues.push(
      "Different detector IDs; establish detector correspondence before comparing.",
    );
  if (
    ["piston", "angle"].includes(a.config.parameter) &&
    a.config.mirrorId !== b.config.mirrorId
  )
    issues.push("Different swept mirror IDs.");
  const settingsA = a.rows.find((r) => r.run)?.run.settings,
    settingsB = b.rows.find((r) => r.run)?.run.settings;
  if (!settingsA || !settingsB)
    issues.push("One study has no successful reconstruction.");
  else
    for (const key of new Set([
      ...Object.keys(settingsA),
      ...Object.keys(settingsB),
    ]))
      if (!same(settingsA[key], settingsB[key]))
        issues.push(`Measurement setting differs: ${key}.`);
  if (a.config.seed !== b.config.seed)
    warnings.push(
      "Noise seeds differ; differences can include random realization effects.",
    );
  const pa = a.rows.find((r) => r.run)?.run.simulation,
    pb = b.rows.find((r) => r.run)?.run.simulation;
  const sameScale =
    pa &&
    pb &&
    Math.abs(pa.normalizationPeak - pb.normalizationPeak) <=
      1e-9 * Math.max(pa.normalizationPeak, pb.normalizationPeak);
  if (!sameScale)
    warnings.push(
      "Base intensity normalizations differ. Intensity overlays/deltas are disabled; visibility and error may also reflect this readout change.",
    );
  if (
    ra.checks.some((c) => c.status !== "match") ||
    rb.checks.some((c) => c.status !== "match")
  )
    warnings.push(
      "Saved results changed on recomputation. This comparison uses the current regenerated results.",
    );
  warnings.push(
    "Component correspondence uses saved IDs. Review replacements and renamed components in the change list.",
    "Model-to-model comparison only. Lower error under the illustrative readout is not proof of better physical accuracy.",
  );
  const compatible = issues.length === 0,
    rows = Array.from(
      { length: Math.max(a.rows.length, b.rows.length) },
      (_, i) => {
        const r = a.rows[i],
          s = b.rows[i];
        const deltas = {};
        for (const [key] of comparisonMetrics)
          deltas[key] =
            compatible &&
            (key !== "intensity" || sameScale) &&
            r?.status === "complete" &&
            s?.status === "complete" &&
            Number.isFinite(r[key]) &&
            Number.isFinite(s[key])
              ? s[key] - r[key]
              : null;
        return {
          valueA: r?.value ?? null,
          valueB: s?.value ?? null,
          statusA: r?.status ?? "missing",
          statusB: s?.status ?? "missing",
          errorA: r?.error || null,
          errorB: s?.error || null,
          a: Object.fromEntries(
            comparisonMetrics.map(([k]) => [
              k,
              Number.isFinite(r?.[k]) ? r[k] : null,
            ]),
          ),
          b: Object.fromEntries(
            comparisonMetrics.map(([k]) => [
              k,
              Number.isFinite(s?.[k]) ? s[k] : null,
            ]),
          ),
          deltas,
        };
      },
    );
  return {
    format: "optibench-study-comparison",
    version: 1,
    createdAt: new Date().toISOString(),
    a: {
      id: left.id,
      title: left.title,
      revisionName: left.revisionName,
      createdAt: left.createdAt,
      studyId: a.id,
      config: a.config,
    },
    b: {
      id: right.id,
      title: right.title,
      revisionName: right.revisionName,
      createdAt: right.createdAt,
      studyId: b.id,
      config: b.config,
    },
    compatible,
    issues,
    warnings,
    intensityComparable: !!sameScale,
    rows,
    seriesA: a.rows.map((r) => ({
      value: r.value,
      status: r.status,
      ...Object.fromEntries(
        comparisonMetrics.map(([k]) => [
          k,
          Number.isFinite(r?.[k]) ? r[k] : null,
        ]),
      ),
    })),
    seriesB: b.rows.map((r) => ({
      value: r.value,
      status: r.status,
      ...Object.fromEntries(
        comparisonMetrics.map(([k]) => [
          k,
          Number.isFinite(r?.[k]) ? r[k] : null,
        ]),
      ),
    })),
    changes: benchDifferences(a.baseProject, b.baseProject),
    recomputation: { a: ra.checks, b: rb.checks },
  };
}
