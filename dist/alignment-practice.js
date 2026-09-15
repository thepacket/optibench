import { makeProject } from "./project.js";
import { candidateProject } from "./alignment-study.js";
import { coherentField } from "./interferometry.js";
import { simulateRuns } from "./simulation-runs.js";
import { createSweepArchive } from "./sweep-archive.js";
import { createLayout, createProjectBundle } from "./project-navigator.js";
export function practiceSetup() {
  const base = makeProject("michelson");
  base.title = "Michelson alignment practice";
  return {
    base,
    detectorId: base.items.find((x) => x.type === "camera").id,
    controls: base.items
      .filter((x) => x.type === "mirror")
      .map((x) => ({ id: x.id, axis: "angle" })),
    initial: [0.08, 0],
  };
}
export function evaluatePractice(setup, offsets) {
  if (
    !Array.isArray(offsets) ||
    offsets.length !== 2 ||
    offsets.some((x) => !Number.isFinite(x) || Math.abs(x) > 0.1)
  )
    throw Error("Mirror offsets must be between −0.1° and +0.1°.");
  const project = candidateProject(setup.base, setup.controls, offsets);
  try {
    const field = coherentField(project, setup.detectorId, { n: 128 });
    if (field.paths.length !== 2)
      throw Error("Both returning arms must reach the detector.");
    const study = simulateRuns(project, {
      parameter: "exposure",
      start: 1,
      end: 1.000001,
      count: 2,
      seed: 42,
      detectorId: setup.detectorId,
    });
    const row = study.rows[0];
    if (row.status !== "complete") throw Error(row.error);
    const separationMm = Math.abs(
      field.paths[0].offset - field.paths[1].offset,
    );
    return {
      project,
      offsets: [...offsets],
      status: "complete",
      visibility: row.visibility,
      validFraction: row.validFraction,
      separationMm,
      aligned:
        row.visibility >= 0.5 &&
        row.validFraction >= 0.75 &&
        separationMm <= 0.5,
      source: createSweepArchive(study, {
        title: project.title,
        revisionName: "Mirror offsets " + offsets.join(", ") + " degrees",
      }),
    };
  } catch (e) {
    return {
      project,
      offsets: [...offsets],
      status: "failed",
      error: e.message,
      aligned: false,
    };
  }
}
export function practiceHint(current, previous) {
  if (current.status !== "complete")
    return (
      current.error +
      " Undo the last adjustment or restart the challenge to recover both paths."
    );
  if (current.aligned)
    return "Practice targets met. Compare the starting and current layouts, then save your result. This is a simulation exercise, not an instrument certification.";
  const worse =
    previous?.status === "complete" &&
    (current.separationMm > previous.separationMm + 0.01 ||
      current.validFraction < previous.validFraction - 0.01);
  return (
    (worse
      ? "The last adjustment increased beam separation or reduced usable area. Reverse its direction and use a smaller step. "
      : "Try a small yaw adjustment on one mirror, then observe the other arm. ") +
    (current.separationMm > 0.5
      ? "Bring the beam centers closer together. "
      : "Beam centers are close; refine the mirror angles while watching visibility and usable area. ") +
    (current.validFraction < 0.75
      ? "Usable detector area is below the practice target."
      : "")
  );
}
export function practiceBundle(start, current) {
  if (current.status !== "complete" || start.status !== "complete")
    throw Error("Recover a valid two-arm result before saving.");
  const records = [
    createLayout(start.project, "Practice · starting bench"),
    createLayout(current.project, "Practice · adjusted bench"),
    start.source,
    current.source,
  ];
  const unique = [...new Map(records.map((x) => [x.id, x])).values()];
  return createProjectBundle(
    unique,
    unique.map((x) => x.id),
    {
      title: "Michelson alignment practice",
      notes: JSON.stringify({
        scope:
          "Synthetic alignment exercise; center separation is an overlap proxy, not an overlap integral.",
        startingOffsets: start.offsets,
        finalOffsets: current.offsets,
        targets: { visibility: 0.5, validFraction: 0.75, separationMm: 0.5 },
        targetsMet: current.aligned,
      }),
    },
  );
}
