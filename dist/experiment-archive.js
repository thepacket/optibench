import {
  analyzeMeasurement,
  demoFrames,
  defaultMeasurementSettings,
} from "./metrology.js";
import { analyzeRepeats } from "./repeatability.js";
import { evaluateUncertainty } from "./uncertainty.js";
import { subtractReference } from "./reference-analysis.js";
import { validateProject, makeProject } from "./project.js";
import { serializable } from "./run-store.js";
export function createArchive({
  current,
  repeats = [],
  study = null,
  bench,
  title,
  revisionName,
  revisionNotes = "",
  parent = null,
}) {
  if (!current?.result)
    throw Error("Reconstruct a measurement before archiving.");
  if (!String(revisionName || "").trim()) throw Error("Name this revision.");
  const { reference, ...rest } = current;
  const compact = (r) => {
    const { reference, uncertainty, comparison, ...plain } = r;
    return plain;
  };
  return serializable({
    format: "optibench-experiment",
    version: 1,
    id: crypto.randomUUID(),
    experimentId: parent?.experimentId || crypto.randomUUID(),
    parentRevisionId: parent?.id || null,
    createdAt: new Date().toISOString(),
    title: String(title || current.name).slice(0, 120),
    revisionName: String(revisionName).slice(0, 120),
    revisionNotes: String(revisionNotes).slice(0, 10000),
    bench: validateProject(bench),
    current: { ...rest, reference: reference ? compact(reference) : null },
    repeats: repeats.map(compact),
    study,
    evidence: current.frames.some((f) =>
      /synthetic|simulat/i.test(f.origin || ""),
    )
      ? "Synthetic / simulation"
      : "Imported intensity; physical provenance requires verification",
  });
}
const reconstruct = (r) =>
  analyzeMeasurement(r.frames, r.settings, { dark: r.dark, flat: r.flat });
export function recomputeArchive(a) {
  if (
    a?.format !== "optibench-experiment" ||
    a.version !== 1 ||
    typeof a.id !== "string" ||
    typeof a.experimentId !== "string" ||
    !a.current ||
    !Array.isArray(a.repeats) ||
    a.repeats.length > 20
  )
    throw Error("Unsupported experiment archive.");
  const bench = validateProject(a.bench),
    result = reconstruct(a.current),
    checks = [];
  function metric(label, saved, current) {
    const available = Number.isFinite(saved) && Number.isFinite(current),
      delta = available ? current - saved : null;
    checks.push({
      label,
      saved: available ? saved : null,
      recomputed: Number.isFinite(current) ? current : null,
      delta,
      status: available
        ? Math.abs(delta) <= 1e-7 + Math.abs(saved) * 1e-9
          ? "match"
          : "changed"
        : "unavailable",
    });
  }
  function compareMap(label, old, next) {
    if (!old?.height || old.height.length !== next.height.length) {
      checks.push({ label, status: "unavailable" });
      return;
    }
    let max = 0,
      changedMask = 0;
    for (let i = 0; i < next.height.length; i++) {
      if (Boolean(old.mask?.[i]) !== Boolean(next.mask[i])) changedMask++;
      if (next.mask[i]) {
        if (!Number.isFinite(old.height[i])) {
          max = Infinity;
          break;
        }
        max = Math.max(max, Math.abs(old.height[i] - next.height[i]));
      }
    }
    checks.push({
      label,
      status: max <= 1e-7 && changedMask === 0 ? "match" : "changed",
      maxDifferenceNm: Number.isFinite(max) ? max : null,
      changedMaskPixels: changedMask,
    });
  }
  metric("Sample PV · nm", a.current.result?.stats?.pvNm, result.stats.pvNm);
  metric("Sample RMS · nm", a.current.result?.stats?.rmsNm, result.stats.rmsNm);
  compareMap("Sample pixel map", a.current.result, result);
  const restoredRepeats = a.repeats.map((r) => ({
    ...r,
    result: reconstruct(r),
  }));
  let comparison = null,
    study = null,
    budget = null;
  const warnings = [];
  if (a.current.reference && a.current.comparison) {
    try {
      comparison = subtractReference(
        result,
        reconstruct(a.current.reference),
        a.current.comparison.registration,
      );
      metric(
        "Reference difference RMS · nm",
        a.current.comparison.stats?.rmsNm,
        comparison.stats.rmsNm,
      );
    } catch (e) {
      warnings.push("Reference comparison: " + e.message);
    }
  }
  // A saved study reuses its recorded operator assertions; report that fact explicitly.
  if (a.study) {
    try {
      study = analyzeRepeats(a.repeats, {
        verified: a.study.verified === true,
      });
      metric("Repeat PV sample SD · nm", a.study.pv?.sd, study.pv.sd);
      metric("Repeat RMS sample SD · nm", a.study.rms?.sd, study.rms.sd);
      compareMap(
        "Repeat mean map",
        { height: a.study.mean, mask: a.study.mask },
        { height: study.mean, mask: study.mask },
      );
      compareMap(
        "Repeat SD map",
        { height: a.study.sd, mask: a.study.mask },
        { height: study.sd, mask: study.mask },
      );
    } catch (e) {
      warnings.push("Repeat study: " + e.message);
    }
  }
  if (a.current.uncertainty?.budget) {
    try {
      budget = evaluateUncertainty(
        result,
        study,
        a.current.uncertainty.calibration,
        {
          verified: true,
          simulation:
            a.current.frames.some((f) =>
              /synthetic|simulat/i.test(f.origin || ""),
            ) || study?.rows.some((r) => r.quality.simulated),
        },
      );
      budget.sample = {
        name: a.current.name,
        acquisitionId: a.current.acquisitionId,
        acquiredAt: a.current.acquiredAt,
      };
      budget.restored = true;
      for (const k of ["pv", "rms"]) {
        metric(
          k.toUpperCase() + " expanded uncertainty · nm",
          a.current.uncertainty.budget.outputs?.[k]?.expanded,
          budget.outputs[k].expanded,
        );
        const old = a.current.uncertainty.budget.outputs?.[k]?.decision;
        checks.push({
          label: k.toUpperCase() + " tolerance decision",
          status: old === budget.outputs[k].decision ? "match" : "changed",
          savedDecision: old || "Unavailable",
          recomputedDecision: budget.outputs[k].decision,
        });
      }
    } catch (e) {
      warnings.push("Uncertainty budget: " + e.message);
    }
  }
  return {
    bench,
    repeats: restoredRepeats,
    result,
    comparison,
    study,
    budget,
    checks,
    warnings,
    summary: warnings.length
      ? "Needs review"
      : checks.some((c) => c.status !== "match")
        ? "Results differ or unavailable"
        : "Results reproduced",
    review:
      "Historical operator assertions were reused for recomputation. Review calibration, same-sample conditions and registration before new measurement decisions.",
  };
}
export function guidedArchive() {
  const bench = makeProject("michelson"),
    settings = { ...defaultMeasurementSettings(), n: 64 },
    repeats = [];
  for (let j = 0; j < 3; j++) {
    const frames = demoFrames(64).map((f, k) => ({
      ...f,
      values: Float64Array.from(
        f.values,
        (v, i) => v + 0.0005 * Math.sin(i * 1.731 + j * 2.41 + k * 0.71),
      ),
    }));
    repeats.push({
      format: "optibench-measurement",
      version: 1,
      id: crypto.randomUUID(),
      acquisitionId: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      acquiredAt: `2026-01-01T00:0${j}:00Z`,
      name: `Guided synthetic acquisition ${j + 1}`,
      notes:
        "Generated fixture; timestamps are illustrative. Frames are analytical examples, not a trace of the archived Michelson layout.",
      frames,
      settings,
      project: bench,
      dark: null,
      flat: null,
      result: reconstruct({ frames, settings }),
    });
  }
  const study = analyzeRepeats(repeats, { verified: true }),
    current = {
      ...repeats[0],
      profile: { axis: "horizontal", index: 32, source: "sample" },
    },
    calibration = {
      recordId: "SYNTHETIC-EXAMPLE",
      date: "2026-01-01",
      references: "Illustrative software fixture; no laboratory certificate",
      scope:
        "Synthetic only. Ideal phase steps and incidence have zero uncertainty by construction. Other values illustrate budget entry; they are not instrument specifications.",
      wavelengthU: 0.1,
      pixelU: 0.01,
      angleU: 0,
      stepU: 0,
      otherPV: 0.1,
      otherRMS: 0.1,
      k: 2,
      pvLimit: 10000,
      rmsLimit: 10000,
    };
  const budget = evaluateUncertainty(current.result, study, calibration, {
    verified: true,
    simulation: true,
  });
  current.uncertainty = { calibration, budget };
  return createArchive({
    current,
    repeats,
    study,
    bench,
    title: "Guided synthetic experiment",
    revisionName: "Worked example",
    revisionNotes:
      "1. Inspect the archived Michelson setup. 2. Review analytical frames and reconstruction. 3. Inspect three-repeat study. 4. Review illustrative uncertainty. 5. Run Validate benchmarks from the bench. Layout and analytical frames are independent examples.",
  });
}
