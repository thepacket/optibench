import { validateProject } from "./project.js";
import { validateSimulationStudy } from "./sweep-archive.js";
import { validateAlignmentConfig } from "./alignment-study.js";
import { validateFrame, validateMeasurementSettings } from "./metrology.js";
import { serializable } from "./run-store.js";
export const kinds = {
  "optibench-layout": "Bench layouts",
  "optibench-measurement": "Measurements",
  "optibench-experiment": "Measurement archives",
  "optibench-sweep-archive": "Sweep revisions",
  "optibench-study-comparison": "Comparisons",
  "optibench-alignment-study": "Alignment studies",
};
export const recordTitle = (r) =>
  r.title ||
  r.name ||
  r.baseProject?.title ||
  r.revisionName ||
  kinds[r.format] ||
  "Record";
export function links(r) {
  return [
    ...new Set(
      [
        r.parentRevisionId,
        r.sourceAlignmentId,
        r.simulation?.studyId,
        ...(r.format === "optibench-study-comparison"
          ? [r.a?.id, r.b?.id]
          : []),
      ].filter(Boolean),
    ),
  ];
}
export function createLayout(
  project,
  title,
  notes = "",
  sourceAlignmentId = null,
) {
  return {
    format: "optibench-layout",
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: String(title || project.title).slice(0, 120),
    notes: String(notes).slice(0, 10000),
    project: validateProject(structuredClone(project)),
    sourceAlignmentId,
  };
}
function validateRun(r) {
  if (
    !r ||
    !Array.isArray(r.frames) ||
    ![1, 4].includes(r.frames.length) ||
    !r.settings
  )
    throw Error("Incomplete measurement inputs.");
  r.frames.forEach((f) => validateFrame(f));
  validateMeasurementSettings(r.settings, r.frames[0]);
  for (const f of [r.dark, r.flat]) if (f) validateFrame(f);
  if (r.project) validateProject(r.project);
}
export function validateRecord(r) {
  if (
    !r ||
    !Object.hasOwn(kinds, r.format) ||
    r.version !== 1 ||
    typeof r.id !== "string" ||
    !r.id ||
    r.id.length > 200
  )
    throw Error("Unsupported project record.");
  if (r.format === "optibench-layout") validateProject(r.project);
  if (r.format === "optibench-measurement") validateRun(r);
  if (r.format === "optibench-experiment") {
    validateProject(r.bench);
    validateRun(r.current);
    if (!Array.isArray(r.repeats) || r.repeats.length > 20)
      throw Error("Invalid repeat archive.");
    r.repeats.forEach(validateRun);
  }
  if (r.format === "optibench-sweep-archive") validateSimulationStudy(r.study);
  if (r.format === "optibench-alignment-study")
    validateAlignmentConfig(r.baseProject, r.config);
  if (
    r.format === "optibench-study-comparison" &&
    (!r.a?.id || !r.b?.id || !Array.isArray(r.rows))
  )
    throw Error("Incomplete comparison references.");
  return r;
}
export function createProjectBundle(
  records,
  selected,
  { title, notes = "", parent = null },
) {
  if (!String(title || "").trim()) throw Error("Name the project.");
  const map = recordIndex(records),
    chosen = new Map();
  const include = (id) => {
    if (!map.has(id)) return;
    const r = map.get(id);
    if (chosen.has(r.id)) return;
    validateRecord(r);
    chosen.set(r.id, r);
    links(r).forEach(include);
  };
  if (selected.some((id) => !map.has(id)))
    throw Error("A selected record is unavailable. Refresh and select again.");
  selected.forEach(include);
  if (!chosen.size) throw Error("Select at least one record for this project.");
  const missing = [
    ...new Set(
      [...chosen.values()]
        .flatMap(links)
        .filter((id) => !chosen.has(map.get(id)?.id)),
    ),
  ];
  return serializable({
    format: "optibench-project-bundle",
    version: 1,
    id: crypto.randomUUID(),
    projectId: parent?.projectId || crypto.randomUUID(),
    parentRevisionId: parent?.id || null,
    createdAt: new Date().toISOString(),
    title: String(title).slice(0, 120),
    notes: String(notes).slice(0, 10000),
    records: [...chosen.values()],
    missingReferences: missing,
  });
}
export function validateBundle(b) {
  if (
    b?.format !== "optibench-project-bundle" ||
    b.version !== 1 ||
    typeof b.id !== "string" ||
    typeof b.projectId !== "string" ||
    typeof b.title !== "string" ||
    (b.missingReferences != null &&
      (!Array.isArray(b.missingReferences) ||
        !b.missingReferences.every((x) => typeof x === "string"))) ||
    !Array.isArray(b.records) ||
    !b.records.length ||
    b.records.length > 1000
  )
    throw Error("Unsupported project backup (1–1000 records required).");
  const ids = new Set();
  for (const r of b.records) {
    validateRecord(r);
    if (ids.has(r.id) || r.id === b.id)
      throw Error("Duplicate record identity in backup.");
    ids.add(r.id);
  }
  return b;
}
export function canonical(v) {
  if (Array.isArray(v)) return "[" + v.map(canonical).join(",") + "]";
  if (v && typeof v === "object")
    return (
      "{" +
      Object.keys(v)
        .sort()
        .map((k) => JSON.stringify(k) + ":" + canonical(v[k]))
        .join(",") +
      "}"
    );
  return JSON.stringify(v);
}
export function planImport(bundle, existing) {
  validateBundle(bundle);
  const map = new Map(existing.map((r) => [r.id, r])),
    add = [];
  for (const r of [...bundle.records, bundle]) {
    const old = map.get(r.id);
    if (old) {
      if (canonical(old) !== canonical(r))
        throw Error(`Conflicting saved identity: ${r.id}. Nothing imported.`);
    } else add.push(r);
  }
  return add;
}
export function searchRecord(r, query) {
  const bench = r.project || r.bench || r.baseProject || r.study?.baseProject;
  return [
    recordTitle(r),
    r.revisionName,
    r.notes,
    r.revisionNotes,
    r.createdAt,
    r.id,
    ...(bench?.items || []).map((c) => [c.label, c.part, c.type].join(" ")),
  ]
    .join(" ")
    .toLowerCase()
    .includes(query.trim().toLowerCase());
}

export function sourceBench(r) {
  return r.project || r.bench || r.baseProject || r.study?.baseProject || null;
}
export function recordIndex(records) {
  const map = new Map(records.map((r) => [r.id, r])),
    studies = new Map();
  for (const r of records)
    if (r.study?.id) {
      const list = studies.get(r.study.id) || [];
      list.push(r);
      studies.set(r.study.id, list);
    }
  for (const [id, list] of studies)
    if (list.length === 1 && !map.has(id)) map.set(id, list[0]);
  return map;
}
