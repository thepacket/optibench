import { makeProject } from "./project.js";
import { simulateRuns } from "./simulation-runs.js";
import { createSweepArchive } from "./sweep-archive.js";
import {
  createRequirements,
  requirementDefaults,
  evaluateAcceptance,
} from "./acceptance.js";
import { createLayout, createProjectBundle } from "./project-navigator.js";
export function guidedSetup() {
  const project = makeProject("michelson");
  project.title = "First experiment · Michelson";
  const wavelength = project.items.find((x) => x.type === "source").wavelength;
  return {
    project,
    config: {
      parameter: "piston",
      detectorId: project.items.find((x) => x.type === "camera").id,
      mirrorId: project.items.find((x) => x.type === "mirror").id,
      start: 0,
      end: wavelength / 2,
      count: 9,
      seed: 42,
    },
  };
}
export function guidedSweep(setup, preview = false, progress = () => {}) {
  return createSweepArchive(
    simulateRuns(
      setup.project,
      preview ? { ...setup.config, count: 2 } : setup.config,
      { onProgress: progress },
    ),
    {
      title: setup.project.title,
      revisionName: preview
        ? "Initial fringe inspection"
        : "One piston fringe cycle",
    },
  );
}
export function guidedAssessment(source, progress = () => {}) {
  const requirements = createRequirements(
    "Michelson introductory checks",
    {
      ...requirementDefaults,
      minVisibility: 0.5,
      minValidFraction: 0.75,
      maxErrorRMSNm: 1,
      requireTolerance: false,
      requireSampling: true,
      maxSamplingChange: 0.02,
    },
    "Instructional limits for the ideal synthetic preset; not instrument specifications. No tolerance claim.",
  );
  return {
    requirements,
    report: evaluateAcceptance(requirements, source, progress),
  };
}
export function guidedBundle(setup, source, assessment) {
  const layout = createLayout(setup.project, setup.project.title);
  const records = [
    layout,
    source,
    assessment.requirements,
    assessment.report,
    ...source.study.rows.filter((r) => r.run).map((r) => r.run),
  ];
  return createProjectBundle(
    records,
    records.map((r) => r.id),
    {
      title: setup.project.title,
      notes:
        "Guided synthetic Michelson experiment. Piston sweep, four-phase reconstruction and instructional acceptance checks.",
    },
  );
}
