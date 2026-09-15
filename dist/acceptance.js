import { reopenSimulationStudy } from "./sweep-archive.js";
import { runAlignmentStudy } from "./alignment-study.js";
import { checkSampling } from "./sampling-check.js";
const canonical = (value) => JSON.stringify(value, function(key, item) {
  return item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item;
});
export const requirementDefaults = {
  minVisibility: 0.5,
  minValidFraction: 0.75,
  maxErrorRMSNm: 1,
  requireTolerance: true,
  minTrialFraction: 0.9,
  minTrials: 20,
  requireSampling: true,
  samplingMetric: "visibility",
  maxSamplingChange: 0.01,
};
export function validateRequirements(r) {
  if (
    r?.format !== "optibench-requirements" ||
    r.version !== 1 ||
    typeof r.id !== "string" ||
    !r.id ||
    typeof r.title !== "string" ||
    !r.title.trim()
  )
    throw Error("Name and save a requirements revision.");
  const x = r.limits;
  if (
    !x ||
    ![x.minVisibility, x.minValidFraction, x.minTrialFraction].every(
      (v) => Number.isFinite(v) && v >= 0 && v <= 1,
    ) ||
    ![x.maxErrorRMSNm, x.maxSamplingChange].every(
      (v) => Number.isFinite(v) && v >= 0,
    ) ||
    !Number.isInteger(x.minTrials) ||
    x.minTrials < 5 ||
    x.minTrials > 100 ||
    !["visibility", "validFraction", "pvNm", "rmsNm"].includes(
      x.samplingMetric,
    ) ||
    typeof x.requireTolerance !== "boolean" ||
    typeof x.requireSampling !== "boolean"
  )
    throw Error(
      "Invalid requirement limits. Fractions must be 0–1; limits nonnegative; trials 5–100.",
    );
  return r;
}
export function createRequirements(title, limits, notes = "", parent = null) {
  return validateRequirements({
    format: "optibench-requirements",
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: String(title).trim().slice(0, 120),
    notes: String(notes).slice(0, 10000),
    parentRevisionId: parent?.id || null,
    limits: structuredClone(limits),
  });
}
export function assessEvidence(requirements, evidence) {
  validateRequirements(requirements);
  const l = requirements.limits,
    checks = [];
  const add = (name, limit, observed, status, reason) =>
    checks.push({ name, limit, observed, status, reason });
  const rows = evidence.rows || [];
  for (const [key, name, limit, minimum] of [
    ["visibility", "Minimum fringe visibility", l.minVisibility, true],
    [
      "validFraction",
      "Minimum valid detector fraction",
      l.minValidFraction,
      true,
    ],
    [
      "errorRMSNm",
      "Maximum reconstruction error RMS · nm",
      l.maxErrorRMSNm,
      false,
    ],
  ]) {
    const values = rows
      .filter((r) => r.status === "complete" && Number.isFinite(r[key]))
      .map((r) => r[key]);
    const observed = values.length
      ? minimum
        ? Math.min(...values)
        : Math.max(...values)
      : null;
    const violation =
        observed !== null && (minimum ? observed < limit : observed > limit),
      complete = rows.length > 0 && values.length === rows.length;
    add(
      name,
      limit,
      observed,
      violation ? "fails" : complete ? "meets" : "insufficient evidence",
      `Worst value across ${rows.length} evaluated design cases; ${rows.length - values.length} failed or missing values. ${evidence.error || ""}`,
    );
  }
  if (l.requireTolerance) {
    const trials = evidence.trials,
      complete = Array.isArray(trials) && trials.length >= l.minTrials;
    const passed =
      trials?.filter(
        (r) =>
          r.status === "complete" &&
          Number.isFinite(r.visibility) &&
          Number.isFinite(r.validFraction) &&
          Number.isFinite(r.errorRMSNm) &&
          r.visibility >= l.minVisibility &&
          r.validFraction >= l.minValidFraction &&
          r.errorRMSNm <= l.maxErrorRMSNm,
      ).length || 0;
    const observed = trials?.length ? passed / trials.length : null;
    add(
      "Minimum tolerance-trial fraction",
      l.minTrialFraction,
      observed,
      !complete
        ? "insufficient evidence"
        : observed >= l.minTrialFraction
          ? "meets"
          : "fails",
      `${passed}/${trials?.length || 0} trials meet all three metric limits; at least ${l.minTrials} required. Failed trials count in the denominator. No population-yield or confidence claim.`,
    );
  }
  if (l.requireSampling) {
    const samples = evidence.sampling || [],
      changes = [];
    let missing = 0;
    for (const sample of samples) {
      if (
        sample.rows?.length !== 3 ||
        sample.rows.some(
          (r) =>
            r.status !== "complete" || !Number.isFinite(r[l.samplingMetric]),
        )
      ) {
        missing++;
        continue;
      }
      for (let i = 1; i < 3; i++)
        changes.push(
          Math.abs(
            sample.rows[i][l.samplingMetric] -
              sample.rows[i - 1][l.samplingMetric],
          ),
        );
    }
    const observed = changes.length ? Math.max(...changes) : null,
      complete =
        rows.length > 0 &&
        samples.length === rows.length &&
        !missing &&
        changes.length === rows.length * 2;
    add(
      `Maximum successive grid change · ${l.samplingMetric}`,
      l.maxSamplingChange,
      observed,
      observed !== null && observed > l.maxSamplingChange
        ? "fails"
        : complete
          ? "meets"
          : "insufficient evidence",
      `Absolute changes across 64²→128² and 128²→256² for every design case; ${missing} unavailable grid sets. This checks the stated numerical limit, not convergence proof.`,
    );
  }
  return {
    checks,
    status: checks.some((c) => c.status === "fails")
      ? "fails"
      : checks.some((c) => c.status === "insufficient evidence")
        ? "insufficient evidence"
        : "meets",
  };
}
export function evaluateAcceptance(
  requirements,
  source,
  onProgress = () => {},
) {
  validateRequirements(requirements);
  const evidence = { rows: [], sampling: [] };
  let cases = [],
    replay = null;
  try {
    if (source?.format === "optibench-sweep-archive") {
      onProgress("Recomputing saved sweep");
      const r = reopenSimulationStudy(source);
      replay = { summary: r.summary, checks: r.checks };
      evidence.rows = r.study.rows.map((x) => ({
        value: x.value,
        status: x.status,
        error: x.error,
        visibility: x.visibility,
        validFraction: x.validFraction,
        errorRMSNm: x.errorRMSNm,
      }));
      cases = r.study.rows.map((x) => x.run?.project || null);
    } else if (source?.format === "optibench-alignment-study") {
      onProgress("Recomputing alignment and tolerance trials");
      const r = runAlignmentStudy(source.baseProject, source.config);
      replay = {
        summary:
          "Alignment search and seeded trials regenerated; saved proposal identity checked.",
        savedProposalMatches:
          canonical(source.proposedProject) === canonical(r.proposedProject),
      };
      if (!replay.savedProposalMatches)
        throw Error("Recomputed proposal differs from saved layout; saved design cannot be assessed.");
      evidence.rows = [r.best];
      evidence.trials = r.trials;
      cases = [r.proposedProject];
    } else throw Error("Select a saved sweep revision or alignment study.");
    if (requirements.limits.requireSampling)
      cases.forEach((p, i) => {
        onProgress(`Sampling design ${i + 1} of ${cases.length}`);
        evidence.sampling.push(
          p
            ? checkSampling(
                p,
                source.config?.detectorId ?? source.study.config.detectorId,
              )
            : { rows: [] },
        );
      });
  } catch (e) {
    evidence.error = e.message;
  }
  const verdict = assessEvidence(requirements, evidence);
  return {
    format: "optibench-acceptance-report",
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    title: requirements.title + " · acceptance",
    requirementsId: requirements.id,
    sourceId: source?.id || null,
    requirements: structuredClone(requirements),
    source: {
      id: source?.id,
      format: source?.format,
      title: source?.title || source?.baseProject?.title,
      createdAt: source?.createdAt,
      proposedProject: source?.proposedProject,
      config: source?.config || source?.study?.config,
      baseProject: source?.baseProject || source?.study?.baseProject,
    },
    evaluatedLayouts: cases,
    replay,
    evidence,
    ...verdict,
    interpretation:
      "Simulation-based assessment under the recorded model and requirements. Bounds are inclusive. Known violations take precedence over missing evidence; otherwise all enabled requirements must have sufficient evidence to meet. Reconstruction error is against ideal readout on the same modeled bench, not physical measurement accuracy. Saved historical verdicts are not reused.",
  };
}
