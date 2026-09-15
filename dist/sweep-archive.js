import { simulateRuns } from "./simulation-runs.js";
import { validateProject } from "./project.js";
import { validateFrame } from "./metrology.js";
import { serializable } from "./run-store.js";
export function validateSimulationStudy(s) {
  if (
    s?.format !== "optibench-simulation-study" ||
    s.version !== 1 ||
    typeof s.id !== "string" ||
    !s.config ||
    !Array.isArray(s.rows) ||
    !Number.isInteger(s.config.count) ||
    s.config.count < 2 ||
    s.config.count > 12 ||
    s.rows.length !== s.config.count
  )
    throw Error("Unsupported or incomplete simulation study.");
  validateProject(s.baseProject);
  const ids = new Set();
  for (let i = 0; i < s.rows.length; i++) {
    const r = s.rows[i],
      expected =
        s.config.start +
        ((s.config.end - s.config.start) * i) / (s.config.count - 1);
    if (
      !Number.isFinite(r.value) ||
      !Number.isFinite(expected) ||
      Math.abs(r.value - expected) > 1e-9 ||
      !["complete", "failed"].includes(r.status)
    )
      throw Error("Invalid sweep point sequence.");
    const frames = r.status === "complete" ? r.run?.frames : r.frames;
    if (r.status === "complete") {
      if (!r.run || typeof r.run.id !== "string" || ids.has(r.run.id))
        throw Error("Invalid or duplicate acquisition ID.");
      ids.add(r.run.id);
      validateProject(r.run.project);
      if (!frames)
        throw Error("A completed sweep point is missing its frames.");
    } else if (typeof r.error !== "string")
      throw Error("Failed cases must retain their error.");
    if (frames) {
      if (!Array.isArray(frames) || frames.length !== 4)
        throw Error("Each captured point must have four phase frames.");
      for (const f of frames) {
        if (f.width !== 128 || f.height !== 128)
          throw Error("Sweep frames must use the recorded 128² grid.");
        validateFrame(f);
      }
    }
  }
  return s;
}
export function createSweepArchive(
  study,
  { title, revisionName, revisionNotes = "", parent = null } = {},
) {
  validateSimulationStudy(study);
  if (typeof revisionName !== "string" || !revisionName.trim())
    throw Error("Name the sweep revision.");
  return serializable({
    format: "optibench-sweep-archive",
    version: 1,
    id: crypto.randomUUID(),
    experimentId: parent?.experimentId || crypto.randomUUID(),
    parentRevisionId: parent?.id || null,
    createdAt: new Date().toISOString(),
    title: String(title || "Simulation study").slice(0, 120),
    revisionName: revisionName.slice(0, 120),
    revisionNotes: String(revisionNotes).slice(0, 10000),
    evidence: "Controlled synthetic simulation",
    study,
  });
}
export function readSweepFile(input) {
  if (input?.format === "optibench-sweep-archive") {
    if (
      input.version !== 1 ||
      typeof input.id !== "string" ||
      typeof input.experimentId !== "string" ||
      typeof input.revisionName !== "string"
    )
      throw Error("Unsupported sweep archive.");
    return { study: validateSimulationStudy(input.study), archive: input };
  }
  return { study: validateSimulationStudy(input), archive: null };
}
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
export function reopenSimulationStudy(input) {
  const { study: old, archive } = readSweepFile(input),
    fresh = simulateRuns(old.baseProject, old.config),
    checks = [];
  for (let i = 0; i < fresh.rows.length; i++) {
    const a = old.rows[i],
      b = fresh.rows[i];
    let changed = a.status !== b.status,
      maxFrameDelta = 0,
      maxMapDelta = 0,
      changedMask = 0,
      metricDelta = 0;
    const savedFrames = a.run?.frames || a.frames,
      freshFrames = b.run?.frames || b.frames;
    if (savedFrames && freshFrames) {
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < savedFrames[j].values.length; k++)
          maxFrameDelta = Math.max(
            maxFrameDelta,
            Math.abs(savedFrames[j].values[k] - freshFrames[j].values[k]),
          );
      changed ||= maxFrameDelta > 1e-12;
    } else if (Boolean(savedFrames) !== Boolean(freshFrames)) changed = true;
    const projectChanged =
      JSON.stringify(canonical(a.run?.project || a.project)) !==
      JSON.stringify(canonical(b.run?.project || b.project));
    changed ||= projectChanged;
    if (a.status === "complete" && b.status === "complete") {
      for (let j = 0; j < 4; j++)
        for (let k = 0; k < a.run.frames[j].values.length; k++)
          maxFrameDelta = Math.max(
            maxFrameDelta,
            Math.abs(a.run.frames[j].values[k] - b.run.frames[j].values[k]),
          );
      for (const key of [
        "intensity",
        "visibility",
        "pvNm",
        "rmsNm",
        "errorRMSNm",
        "errorOverlap",
        "validFraction",
      ]) {
        if (!Number.isFinite(a[key]) || !Number.isFinite(b[key])) {
          if (a[key] !== b[key]) changed = true;
        } else metricDelta = Math.max(metricDelta, Math.abs(a[key] - b[key]));
      }
      if (a.run.result?.height?.length !== b.run.result.height.length)
        changed = true;
      else
        for (let k = 0; k < b.run.result.height.length; k++) {
          if (Boolean(a.run.result.mask?.[k]) !== Boolean(b.run.result.mask[k]))
            changedMask++;
          if (b.run.result.mask[k]) {
            if (!Number.isFinite(a.run.result.height[k])) changed = true;
            else
              maxMapDelta = Math.max(
                maxMapDelta,
                Math.abs(a.run.result.height[k] - b.run.result.height[k]),
              );
          }
        }
      changed ||=
        maxFrameDelta > 1e-12 ||
        metricDelta > 1e-7 ||
        maxMapDelta > 1e-7 ||
        changedMask > 0;
      // A replay is not a new independent acquisition. Preserve original identity.
      b.run.id = a.run.id;
      b.run.acquisitionId = a.run.acquisitionId || a.run.id;
      b.run.createdAt = a.run.createdAt;
      b.run.acquiredAt = a.run.acquiredAt || null;
    } else if (a.status === "failed" && b.status === "failed")
      changed ||= a.error !== b.error;
    if (b.run) b.run.simulation.studyId = old.id;
    else if (b.simulation) b.simulation.studyId = old.id;
    checks.push({
      index: i,
      value: b.value,
      savedStatus: a.status,
      recomputedStatus: b.status,
      status: changed ? "changed" : "match",
      maxFrameDelta,
      maxMapDelta,
      changedMaskPixels: changedMask,
      projectChanged,
      maxMetricDelta: metricDelta,
      savedError: a.error || null,
      recomputedError: b.error || null,
    });
  }
  fresh.id = old.id;
  fresh.createdAt = old.createdAt;
  fresh.recomputedAt = new Date().toISOString();
  fresh.reopenChecks = checks;
  return {
    study: fresh,
    archive,
    checks,
    summary: checks.every((c) => c.status === "match")
      ? "All sweep points reproduced"
      : "Sweep results changed; review the comparison",
  };
}
