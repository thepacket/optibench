export function measurementQuality(
  result,
  frames = [],
  { reference = false, registration = null } = {},
) {
  if (!result)
    return {
      status: "unavailable",
      checks: [],
      warnings: ["Reconstruct phase first."],
    };
  const s = result.stats,
    n = result.n,
    checks = [];
  const add = (name, level, detail) => checks.push({ name, level, detail });
  add(
    "Clipped intensity",
    s.clippedPixels > 0 ? "review" : "clear",
    `${s.clippedPixels} / ${n * n} ROI pixels at the intensity limits; excluded from reconstruction.`,
  );
  add(
    "Fringe visibility",
    s.meanVisibility < 0.2 ? "review" : "clear",
    `Mean visibility ${(s.meanVisibility * 100).toFixed(1)}%; review threshold 20%.`,
  );
  add(
    "Valid area",
    s.validFraction < 0.75 ? "review" : "clear",
    `${(s.validFraction * 100).toFixed(1)}% retained; review threshold 75%.`,
  );
  add(
    "Phase unwrapping",
    s.unwrapConflicts > 0 ? "review" : "clear",
    `${s.unwrapConflicts} inconsistent edges. Even zero conflicts cannot establish absolute fringe order.`,
  );
  if (result.settings.method === "four-step")
    add(
      "Phase-step consistency",
      s.stepResidual > 0.05 ? "review" : "clear",
      `Residual ${(s.stepResidual * 100).toFixed(3)}%; review threshold 5%.`,
    );
  else
    add(
      "Fourier phase sign",
      "review",
      "Verify the selected sideband and physical phase sign against a known reference.",
    );
  if (reference)
    add(
      "Reference registration",
      registration?.verified ? "operator-verified" : "review",
      registration?.verified
        ? "Operator verified translation and phase sign; this is not an automatic registration certificate."
        : "Registration and phase sign have not been verified.",
    );
  const simulated = frames.some((f) =>
    /simulat|synthetic/i.test(f.origin || ""),
  );
  add(
    "Data source",
    simulated ? "simulation" : "info",
    simulated
      ? "Simulation/example data: variation does not establish physical instrument repeatability."
      : "Imported intensity: exposure, linear response and calibration require experimental verification.",
  );
  return {
    status:
      checks.some((c) => c.level === "review") || result.warnings.length
        ? "review"
        : "no-flags",
    checks,
    warnings: [...result.warnings],
    simulated,
  };
}
