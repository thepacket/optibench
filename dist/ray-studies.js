import { traceNonsequential, validateRayScene } from "./nonsequential.js";
import { normalAngles } from "./ray3-geometry.js";
export function summarizeRayRun(run, detectorId) {
  const d = run.detectors.find((d) => d.id === detectorId);
  if (!d) throw Error("Select a detector in this scene.");
  const groups = { direct: 0, specular: 0, scattered: 0 };
  for (const h of run.detectorHits.filter((h) => h.detectorId === detectorId)) {
    const key = h.path.some((p) => p.event === "S")
      ? "scattered"
      : h.path.some((p) => p.event === "R" || p.event === "TIR")
        ? "specular"
        : "direct";
    groups[key] += h.power;
  }
  const l = run.ledger,
    unresolved = l.threshold + l.depthLimit + l.budgetLimit + l.cancelled;
  return {
    detectorId,
    power: d.power,
    efficiency: d.power / l.launched,
    pixels: d.pixels,
    groups,
    ledger: l,
    unresolvedFraction: unresolved / l.launched,
    segments: run.segments.length,
  };
}
export function studyPlan(input, settings) {
  const scene = validateRayScene(input),
    s = structuredClone(settings);
  if (
    !["wavelength", "angle", "convergence"].includes(s.kind) ||
    !scene.objects.some((o) => o.id === s.detectorId && o.kind === "detector")
  )
    throw Error("Choose a study type and detector.");
  if (s.kind === "convergence") {
    if (
      !Array.isArray(s.levels) ||
      s.levels.length < 3 ||
      s.levels.length > 6 ||
      s.levels.some(
        (v, i) =>
          !Number.isInteger(v) ||
          v < 1 ||
          v > 2048 ||
          (i && v <= s.levels[i - 1]),
      )
    )
      throw Error("Use 3–6 increasing ray counts, at most 2048 per source.");
    if (!Number.isFinite(s.tolerance) || s.tolerance <= 0 || s.tolerance > 0.5)
      throw Error(
        "Convergence tolerance must be greater than 0 and at most 0.5.",
      );
  } else {
    if (
      !Number.isInteger(s.count) ||
      s.count < 2 ||
      s.count > 15 ||
      ![s.start, s.end].every(Number.isFinite) ||
      s.start === s.end
    )
      throw Error("Use 2–15 distinct finite sweep points.");
    if (s.kind === "wavelength") {
      if (
        !scene.sources.some((o) => o.id === s.sourceId) ||
        Math.min(s.start, s.end) < 400 ||
        Math.max(s.start, s.end) > 1100
      )
        throw Error("Choose a source and wavelengths 400–1100 nm.");
    } else if (
      !scene.objects.some((o) => o.id === s.objectId) ||
      Math.max(Math.abs(s.start), Math.abs(s.end)) > 180
    )
      throw Error("Choose an object and yaw angles from −180 to 180 degrees.");
  }
  const values =
    s.kind === "convergence"
      ? s.levels
      : Array.from(
          { length: s.count },
          (_, i) => s.start + ((s.end - s.start) * i) / (s.count - 1),
        );
  if (values.length * scene.options.maxSegments > 500000)
    throw Error(
      "Study exceeds 500,000 permitted segments. Reduce points or the per-trace segment budget.",
    );
  // Validate every point before acquiring; a partial material band must never be extrapolated.
  const points = values.map((value) => {
    const p = structuredClone(scene);
    if (s.kind === "convergence") p.options.rays = value;
    else if (s.kind === "wavelength")
      p.sources.find((o) => o.id === s.sourceId).wavelength = value;
    else {
      const o = p.objects.find((o) => o.id === s.objectId),
        pitch = (Math.asin(o.normal[2]) * 180) / Math.PI;
      o.normal = normalAngles(value, pitch);
    }
    return { value, scene: validateRayScene(p) };
  });
  return { scene, settings: s, points };
}
export function convergenceVerdict(rows, tolerance) {
  if (rows.length < 3 || rows.some((r) => r.error || !r.result))
    return {
      status: "inconclusive",
      reason: "At least three completed levels are required.",
    };
  const pairs = [];
  for (let i = 1; i < rows.length; i++) {
    const a = rows[i - 1].result,
      b = rows[i].result;
    if (a.power <= 0 || b.power <= 0)
      return {
        status: "inconclusive",
        reason: "No detected signal at one or more levels.",
      };
    const relativePower = Math.abs(a.power - b.power) / b.power,
      l1 = b.pixels.reduce(
        (sum, v, j) => sum + Math.abs(v / b.power - a.pixels[j] / a.power),
        0,
      );
    pairs.push({
      from: rows[i - 1].value,
      to: rows[i].value,
      relativePower,
      normalizedMapL1: l1,
    });
  }
  const tail = pairs.slice(-2),
    limitsClear = rows
      .slice(-3)
      .every((r) => r.result.unresolvedFraction <= 1e-5),
    within = tail.every(
      (p) => p.relativePower <= tolerance && p.normalizedMapL1 <= tolerance,
    );
  return {
    status: limitsClear && within ? "stable at tested levels" : "not resolved",
    pairs,
    tolerance,
    reason: !limitsClear
      ? "Unresolved power exceeds 0.001% of launched power."
      : "Both detector power and normalized-map L1 change are checked on the final two refinements. This is a numerical diagnostic, not a confidence interval; vary scattering seeds and binning.",
  };
}
export function runRayStudy(
  input,
  settings,
  {
    onEvent = () => {},
    cancelled = () => false,
    trace = traceNonsequential,
  } = {},
) {
  const plan = studyPlan(input, settings),
    study = {
      format: "optibench-ray-study",
      version: 1,
      id: crypto.randomUUID(),
      name: `${plan.scene.name} · ${settings.kind}`,
      createdAt: new Date().toISOString(),
      scene: plan.scene,
      settings: plan.settings,
      status: "running",
      rows: [],
    };
  onEvent({ type: "study-start", study: structuredClone(study) });
  for (const p of plan.points) {
    if (cancelled()) {
      study.status = "cancelled";
      break;
    }
    const row = { value: p.value, result: null, error: null };
    try {
      row.result = summarizeRayRun(
        trace(p.scene, { cancelled }),
        settings.detectorId,
      );
    } catch (e) {
      row.error = e.message;
    }
    if (cancelled()) {
      study.status = "cancelled";
      break;
    }
    study.rows.push(row);
    onEvent({ type: "study-row", row: structuredClone(row) });
    if (cancelled()) {
      study.status = "cancelled";
      break;
    }
  }
  if (study.status === "running")
    study.status = study.rows.some((r) => r.error)
      ? "completed with errors"
      : "completed";
  study.finishedAt = new Date().toISOString();
  if (settings.kind === "convergence")
    study.convergence =
      study.status === "completed"
        ? convergenceVerdict(study.rows, settings.tolerance)
        : { status: "inconclusive", reason: "The study did not complete." };
  return study;
}
export function rayStudyCSV(study) {
  const cell = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  return [
    [
      "parameter",
      study.settings.kind === "wavelength"
        ? "nm"
        : study.settings.kind === "angle"
          ? "degrees"
          : "rays_per_source",
      "detector_power_mW",
      "efficiency",
      "direct_mW",
      "specular_mW",
      "scattered_mW",
      "unresolved_fraction",
      "error",
    ],
    ...study.rows.map((r) => [
      study.settings.kind,
      r.value,
      r.result?.power,
      r.result?.efficiency,
      r.result?.groups.direct,
      r.result?.groups.specular,
      r.result?.groups.scattered,
      r.result?.unresolvedFraction,
      r.error ? "'" + r.error : "",
    ]),
  ]
    .map((r) => r.map(cell).join(","))
    .join("\n");
}
