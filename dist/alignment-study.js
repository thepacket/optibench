import { simulateRuns } from "./simulation-runs.js";
import { validateProject } from "./project.js";
import { mechanicalChecks, stageMove } from "./alignment.js";
import { seededRandom } from "./optics.js";
export function candidateProject(base, controls, offsets) {
  const p = structuredClone(base);
  controls.forEach((c, i) => {
    const j = p.items.findIndex((x) => x.id === c.id);
    p.items[j] = stageMove(p.items[j], c.axis, offsets[i]);
  });
  validateProject(p);
  const errors = mechanicalChecks(p).filter((x) => x.level === "error");
  if (errors.length) throw Error(errors.map((x) => x.text).join(" "));
  return p;
}
export function evaluateAlignment(p, detectorId) {
  const s = simulateRuns(p, {
    parameter: "exposure",
    start: 1,
    end: 1.000001,
    count: 2,
    seed: 42,
    detectorId,
  });
  const r = s.rows[0];
  if (r.status !== "complete") throw Error(r.error);
  return {
    visibility: r.visibility,
    validFraction: r.validFraction,
    errorRMSNm: r.errorRMSNm,
  };
}
export function validateAlignmentConfig(input, config) {
  const base = validateProject(structuredClone(input));
  if (
    !["visibility", "validFraction"].includes(config.target) ||
    !Number.isInteger(config.seed) ||
    config.seed < 0 ||
    config.seed > 2147483647 ||
    !Number.isInteger(config.trials) ||
    config.trials < 5 ||
    config.trials > 100
  )
    throw Error("Choose a target, integer seed and 5–100 trials.");
  if (
    ![config.minVisibility, config.minValid].every(
      (x) => Number.isFinite(x) && x >= 0 && x <= 1,
    )
  )
    throw Error("Thresholds must be fractions from 0 to 1.");
  const controls = config.controls;
  if (!Array.isArray(controls) || controls.length < 1 || controls.length > 4)
    throw Error("Choose 1–4 adjustment axes.");
  const keys = new Set();
  for (const c of controls) {
    const item = base.items.find((x) => x.id === c.id),
      key = c.id + ":" + c.axis;
    if (
      !item ||
      item.type !== "mirror" ||
      item.locked ||
      item.enabled === false ||
      !["angle", "x", "y", "pistonNm"].includes(c.axis) ||
      keys.has(key)
    )
      throw Error("Choose unique axes on enabled, unlocked mirrors.");
    keys.add(key);
    const max = c.axis === "angle" ? 0.1 : c.axis === "pistonNm" ? 10000 : 5;
    if (
      !Number.isFinite(c.bound) ||
      c.bound <= 0 ||
      c.bound > max ||
      !Number.isFinite(c.tolerance) ||
      c.tolerance < 0 ||
      c.tolerance > max
    )
      throw Error(`Invalid bounds or tolerance for ${c.axis}.`);
  }
  return base;
}
export function runAlignmentStudy(input, config, evaluate = evaluateAlignment) {
  const base = validateAlignmentConfig(input, config),
    controls = config.controls;
  const safe = (offsets) => {
    try {
      const p = candidateProject(base, controls, offsets),
        metrics = evaluate(p, config.detectorId);
      if (!Number.isFinite(metrics[config.target]))
        throw Error("Objective unavailable.");
      return { offsets: [...offsets], status: "complete", ...metrics };
    } catch (e) {
      return { offsets: [...offsets], status: "failed", error: e.message };
    }
  };
  let offsets = controls.map(() => 0),
    best = safe(offsets);
  const baseline = best,
    search = [best];
  // Bounded coordinate search, three progressively finer passes; no global optimum claim.
  for (const fraction of [1, 0.5, 0.25])
    for (let i = 0; i < controls.length; i++) {
      const center = [...offsets];
      for (const sign of [-1, 1]) {
        const next = [...center];
        next[i] = Math.max(
          -controls[i].bound,
          Math.min(
            controls[i].bound,
            center[i] + sign * controls[i].bound * fraction,
          ),
        );
        const r = safe(next);
        search.push(r);
        if (
          r.status === "complete" &&
          (best.status !== "complete" ||
            r[config.target] > best[config.target] + 1e-12)
        ) {
          best = r;
          offsets = next;
        }
      }
    }
  if (best.status !== "complete")
    throw Error("No reconstructable alignment found within the search bounds.");
  const rng = seededRandom(config.seed),
    trials = [];
  for (let i = 0; i < config.trials; i++) {
    const perturbations = controls.map((c) => (2 * rng() - 1) * c.tolerance),
      r = safe(offsets.map((v, j) => v + perturbations[j]));
    trials.push({
      ...r,
      perturbations,
      pass:
        r.status === "complete" &&
        r.visibility >= config.minVisibility &&
        r.validFraction >= config.minValid,
    });
  }
  return {
    format: "optibench-alignment-study",
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    parentRevisionId: config.parentRevisionId || null,
    baseProject: base,
    proposedProject: candidateProject(base, controls, offsets),
    config: structuredClone(config),
    baseline,
    best,
    search,
    trials,
    passed: trials.filter((x) => x.pass).length,
    failed: trials.filter((x) => x.status === "failed").length,
    method:
      "Three-pass bounded coordinate search; independent uniform positioning perturbations around the proposal. Trial perturbations may exceed search bounds. Mechanical violations and lost paths count as failed trials. 128² ideal normalized readout; each candidate uses its own normalization. No global optimum, calibrated hardware accuracy or population-yield claim.",
  };
}
