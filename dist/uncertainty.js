import { removePlane } from "./metrology.js";
export const UNCERTAINTY_VERSION = "1.0.0";
export function assessLimit(value, expanded, limit) {
  if (limit === null || limit === "") return "No limit";
  if (!Number.isFinite(limit) || limit < 0)
    throw Error("Upper tolerance must be nonnegative.");
  return value + expanded <= limit
    ? "Within limit"
    : value - expanded > limit
      ? "Above limit"
      : "Indeterminate";
}
function metrics(values, mask) {
  let lo = Infinity,
    hi = -Infinity,
    sum = 0,
    count = 0;
  for (let i = 0; i < values.length; i++)
    if (mask[i]) {
      const v = values[i];
      if (!Number.isFinite(v)) throw Error("Invalid wavefront map.");
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      sum += v * v;
      count++;
    }
  return { pv: hi - lo, rms: Math.sqrt(sum / count) };
}
export function evaluateUncertainty(
  result,
  study,
  calibration,
  { verified = false, simulation = false } = {},
) {
  if (!verified)
    throw Error(
      "Review the calibration, independence and model scope before evaluating.",
    );
  if (!result || result.settings.method !== "four-step")
    throw Error("This budget supports four-step sample measurements only.");
  if (!study || study.rows.length < 3)
    throw Error(
      "Analyze at least three independent repeat acquisitions first.",
    );
  for (const key of Object.keys(result.settings))
    if (result.settings[key] !== study.settings[key])
      throw Error("Repeatability study settings must match this measurement.");
  if (
    study.mask.length !== result.mask.length ||
    result.mask.some((m, i) => Boolean(m) !== Boolean(study.mask[i]))
  )
    throw Error(
      "The current measurement and repeat study must have identical valid masks.",
    );
  if (
    result.stats.unwrapConflicts > 0 ||
    result.stats.stepResidual > 0.05 ||
    result.stats.validFraction < 0.75 ||
    result.stats.meanVisibility < 0.2 ||
    study.rows.some((r) => r.quality.status === "review")
  )
    throw Error(
      "Resolve measurement and repeat-study quality flags before uncertainty evaluation.",
    );
  const c = { ...calibration };
  for (const key of ["recordId", "date", "references", "scope"])
    if (typeof c[key] !== "string" || !c[key].trim())
      throw Error("Complete calibration ID, date, references and scope notes.");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(c.date) ||
    !Number.isFinite(Date.parse(c.date))
  )
    throw Error("Enter a valid calibration date.");
  for (const key of [
    "wavelengthU",
    "pixelU",
    "angleU",
    "stepU",
    "otherPV",
    "otherRMS",
    "k",
  ]) {
    if (
      c[key] === "" ||
      c[key] === null ||
      !Number.isFinite(Number(c[key])) ||
      Number(c[key]) < 0
    )
      throw Error(
        "Enter every standard uncertainty explicitly (zero requires justification in scope notes).",
      );
    c[key] = Number(c[key]);
  }
  if (c.k < 1 || c.k > 5) throw Error("Coverage factor k must be 1–5.");
  const s = result.settings;
  if (
    c.wavelengthU > s.wavelength * 0.01 ||
    c.pixelU > s.pixelUm * 0.05 ||
    c.angleU > 1 ||
    c.stepU > 1
  )
    throw Error(
      "Small-error model limits: wavelength 1%, pixel scale 5%, incidence and independent phase-step uncertainties 1° each.",
    );
  const nominal = metrics(result.height, result.mask),
    rad = Math.PI / 180,
    factor =
      s.wavelength /
      (2 * Math.PI) /
      (s.geometry === "reflection" ? 2 * Math.cos(s.incidence * rad) : 1),
    phaseTerms = { pv: [], rms: [] };
  let nonlinear = false;
  // Four independent spatially uniform step offsets. dφ/dδ = sin²φ/2 or cos²φ/2.
  for (let j = 0; j < 4; j++) {
    const derivative = Float64Array.from(result.wrapped, (p, i) =>
      result.mask[i]
        ? factor * 0.5 * (j % 2 ? Math.cos(p) ** 2 : Math.sin(p) ** 2)
        : NaN,
    );
    const projected = removePlane(derivative, result.n, s.removeTilt).values;
    const h = Math.max(c.stepU * rad, 1e-6),
      plus = metrics(
        Float64Array.from(result.height, (v, i) => v + h * projected[i]),
        result.mask,
      ),
      minus = metrics(
        Float64Array.from(result.height, (v, i) => v - h * projected[i]),
        result.mask,
      );
    for (const key of ["pv", "rms"]) {
      const a = plus[key] - nominal[key],
        b = minus[key] - nominal[key];
      if (
        c.stepU > 0 &&
        Math.abs(a + b) > 0.2 * Math.max(Math.abs(a), Math.abs(b), 1e-9)
      )
        nonlinear = true;
      phaseTerms[key].push((Math.abs(a - b) / (2 * h)) * c.stepU * rad);
    }
  }
  if (s.geometry === "reflection" && c.angleU > 0) {
    const theta = s.incidence * rad,
      u = c.angleU * rad;
    const a = Math.cos(theta) / Math.cos(theta + u) - 1,
      b = Math.cos(theta) / Math.cos(theta - u) - 1;
    if (Math.abs(a + b) > 0.2 * Math.max(Math.abs(a), Math.abs(b), 1e-12))
      nonlinear = true;
  }
  const rows = study.rows.map((r) => ({
      id: r.id,
      name: r.name,
      acquiredAt: r.acquiredAt,
      pvNm: r.pvNm,
      rmsNm: r.rmsNm,
    })),
    outputs = {};
  for (const key of ["pv", "rms"]) {
    const value = nominal[key],
      contributions = [
        { name: "Single-acquisition repeatability", u: study[key].sd },
        {
          name: "Wavelength calibration",
          u: (value * c.wavelengthU) / s.wavelength,
        },
        {
          name: "Incidence calibration",
          u:
            s.geometry === "reflection"
              ? value * Math.abs(Math.tan(s.incidence * rad)) * c.angleU * rad
              : 0,
        },
        {
          name: "Four independent phase-step offsets",
          u: Math.hypot(...phaseTerms[key]),
        },
        {
          name: "Other evaluated effects",
          u: c[key === "pv" ? "otherPV" : "otherRMS"],
        },
      ];
    const combined = Math.hypot(...contributions.map((c) => c.u)),
      expanded = c.k * combined;
    const raw = c[key === "pv" ? "pvLimit" : "rmsLimit"],
      limit = raw === "" || raw == null ? null : Number(raw);
    const decision = assessLimit(value, expanded, limit);
    outputs[key] = {
      value,
      contributions,
      combined,
      expanded,
      limit,
      decision: simulation
        ? "Simulation only"
        : combined === 0
          ? "No quantified uncertainty"
          : nonlinear
            ? "Model review required"
            : decision,
    };
  }
  return {
    format: "optibench-uncertainty",
    version: UNCERTAINTY_VERSION,
    createdAt: new Date().toISOString(),
    calibration: c,
    settings: { ...s },
    repeatAcquisitions: rows,
    outputs,
    simulation,
    nonlinear,
    roiWidth: {
      value: result.n * s.pixelUm,
      standardU: result.n * c.pixelU,
      unit: "µm",
    },
    notes: [
      "Single-acquisition PV/RMS on a fixed pixel ROI; Type A is sample SD, not SD/√N. Removed piston and tilt are outside scope.",
      "All contributions are treated as independent. Phase-step offsets are equal-u, independent and uniform across the image; correlated phase errors require external evaluation.",
      "Phase contribution uses central finite differences of projected phase sensitivities. Wavelength and incidence use first-order sensitivities. Asymmetric ±u responses (over 20%) suppress tolerance decisions; affected estimates require a higher-order model.",
      "Pixel scale affects reported ROI width, not PV/RMS of fixed pixels. Coordinate-dependent ROI selection and registration errors require external evaluation.",
      "Other evaluated effects must cover relevant residual camera response, reference optics, environment and model errors without double-counting repeatability. Known biases must be corrected before analysis.",
      "U = k × combined standard uncertainty. No coverage probability is claimed; small repeat samples may need a larger justified k.",
      "Upper-limit rule: within only when value + U ≤ limit; above only when value − U > limit; otherwise indeterminate. Decisions are conditional on the declared budget.",
    ],
  };
}
