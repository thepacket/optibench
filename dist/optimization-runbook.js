import { createRunbook, newRunbookStep } from "./runbook.js";
import {
  alignmentProject,
  validateAlignment,
} from "./measured-optimization.js";
export function alignmentVerificationRunbook(run) {
  if (run?.status !== "completed" || !run.verification?.accepted)
    throw Error(
      "Complete alignment verification before creating a Runbook procedure.",
    );
  const a = validateAlignment(run.recipe),
    p = alignmentProject(a, run.bestValues),
    r = createRunbook(p),
    kind = a.goal === "power" ? "power" : "camera";
  r.name = "Verify aligned bench";
  r.notes = `Alignment run ${run.id}. Reacquires the proposed bench without changing the live bench. Each axis is checked separately; this is a new acceptance procedure.`;
  r.seed = (a.seed + 10000) % 2146900000;
  const metrics =
    a.goal === "power"
      ? ["valueMw"]
      : a.goal === "center"
        ? ["sensorCentroidXmm", "sensorCentroidYmm"]
        : ["diameterXmm", "diameterYmm"];
  r.steps = metrics.map((metric) => {
    const s = newRunbookStep(p, kind);
    s.detectorId = a.detectorId;
    s.label = `Verify ${metric}`;
    s.settings = structuredClone(a.settings);
    s.repeats = a.verificationRepeats;
    s.criterion = {
      metric,
      min:
        a.goal === "power"
          ? run.verification.metrics.powerMw.baseline.mean
          : a.goal === "center"
            ? -a.tolerance / Math.SQRT2
            : a.target - a.tolerance,
      max:
        a.goal === "power"
          ? null
          : a.goal === "center"
            ? a.tolerance / Math.SQRT2
            : a.target + a.tolerance,
    };
    return s;
  });
  return r;
}
