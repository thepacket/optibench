import { removePlane } from "./metrology.js";
export function validateReference(sample, reference) {
  if (!sample || !reference || sample.n !== reference.n)
    throw Error("Sample and reference must use the same ROI size.");
  for (const key of [
    "method",
    "n",
    "pixelUm",
    "wavelength",
    "geometry",
    "incidence",
    "removeTilt",
    "x",
    "y",
  ])
    if (sample.settings[key] !== reference.settings[key])
      throw Error(
        `Reference ${key} differs. Reconstruct both runs with matching settings before subtraction.`,
      );
  if (sample.version !== reference.version)
    throw Error("Reconstruct both runs using the same phase engine version.");
  if (sample.settings.method === "fourier") {
    if (sample.settings.bandwidth !== reference.settings.bandwidth)
      throw Error("Fourier sideband bandwidths must match.");
    if (
      !sample.carrier ||
      !reference.carrier ||
      sample.carrier.x * reference.carrier.x +
        sample.carrier.y * reference.carrier.y <=
        0
    )
      throw Error(
        "Fourier sidebands have incompatible phase-sign conventions.",
      );
  }
  for (const r of [sample, reference]) {
    if (
      (r.stats?.unwrapConflicts || 0) > 0 ||
      (r.stats?.stepResidual || 0) > 0.05
    )
      throw Error(
        "Resolve unwrap or phase-step diagnostics before reference subtraction.",
      );
    if (
      r.height?.length !== r.n * r.n ||
      r.mask?.length !== r.n * r.n ||
      r.corrected?.length !== r.n * r.n
    )
      throw Error("Incomplete reconstruction arrays.");
  }
}
function interpolate(values, mask, n, x, y) {
  if (x < 0 || y < 0 || x > n - 1 || y > n - 1) return NaN;
  const x0 = Math.floor(x),
    y0 = Math.floor(y),
    fx = x - x0,
    fy = y - y0;
  let sum = 0;
  for (const [xx, wx] of [
    [x0, 1 - fx],
    [Math.min(x0 + 1, n - 1), fx],
  ])
    for (const [yy, wy] of [
      [y0, 1 - fy],
      [Math.min(y0 + 1, n - 1), fy],
    ]) {
      const w = wx * wy,
        i = yy * n + xx;
      if (w === 0) continue;
      if (!mask[i] || !Number.isFinite(values[i])) return NaN;
      sum += w * values[i];
    }
  return sum;
}
export function subtractReference(
  sample,
  reference,
  { dx = 0, dy = 0, verified = false } = {},
) {
  validateReference(sample, reference);
  if (!verified)
    throw Error(
      "Verify registration and the phase-sign convention before applying subtraction.",
    );
  const n = sample.n;
  if (
    !Number.isFinite(dx) ||
    !Number.isFinite(dy) ||
    Math.abs(dx) > n / 4 ||
    Math.abs(dy) > n / 4
  )
    throw Error("Registration translation must be within ±¼ of the ROI width.");
  const raw = new Float64Array(n * n).fill(NaN),
    alignedReference = new Float64Array(n * n).fill(NaN);
  let count = 0;
  for (let i = 0; i < n * n; i++)
    if (sample.mask[i] && Number.isFinite(sample.height[i])) {
      const value = interpolate(
        reference.height,
        reference.mask,
        n,
        (i % n) + dx,
        Math.floor(i / n) + dy,
      );
      if (Number.isFinite(value)) {
        alignedReference[i] = value;
        raw[i] = sample.height[i] - value;
        count++;
      }
    }
  if (count < n * n * 0.25)
    throw Error(
      "Less than 25% valid overlap. Check the registration and masks.",
    );
  const { values: height, coeff } = removePlane(raw, n, false);
  let min = Infinity,
    max = -Infinity,
    sum2 = 0;
  for (const v of height)
    if (Number.isFinite(v)) {
      min = Math.min(min, v);
      max = Math.max(max, v);
      sum2 += v * v;
    }
  return {
    n,
    height,
    alignedReference,
    mask: Uint8Array.from(height, (v) => (Number.isFinite(v) ? 1 : 0)),
    registration: { dx, dy, verified: true, interpolation: "bilinear" },
    removedMeanNm: coeff[0],
    stats: {
      pvNm: max - min,
      rmsNm: Math.sqrt(sum2 / count),
      validFraction: count / (n * n),
    },
    unit: sample.unit,
  };
}
export function estimateTranslation(sample, reference, { radius = 12 } = {}) {
  validateReference(sample, reference);
  const n = sample.n;
  if (!Number.isInteger(radius) || radius < 1 || radius > Math.min(32, n / 4))
    throw Error(
      "Registration search radius must be 1–32 pixels and within ¼ ROI width.",
    );
  const scores = [],
    stride = Math.max(1, Math.floor(n / 64));
  for (let dy = -radius; dy <= radius; dy++)
    for (let dx = -radius; dx <= radius; dx++) {
      let a = 0,
        b = 0,
        aa = 0,
        bb = 0,
        ab = 0,
        count = 0;
      for (let y = radius; y < n - radius; y += stride)
        for (let x = radius; x < n - radius; x += stride) {
          const i = y * n + x,
            j = (y + dy) * n + x + dx;
          if (!sample.mask[i] || !reference.mask[j]) continue;
          const v = sample.corrected[i],
            w = reference.corrected[j];
          if (!Number.isFinite(v) || !Number.isFinite(w)) continue;
          a += v;
          b += w;
          aa += v * v;
          bb += w * w;
          ab += v * w;
          count++;
        }
      const denom = Math.sqrt(
        Math.max(0, (aa - (a * a) / count) * (bb - (b * b) / count)),
      );
      if (count > 100 && denom > 1e-12)
        scores.push({ dx, dy, score: (ab - (a * b) / count) / denom });
    }
  scores.sort((a, b) => b.score - a.score);
  if (!scores.length)
    throw Error(
      "Insufficient textured overlap for correlation. Set translation from known registration.",
    );
  const best = scores[0],
    alternative = scores.find(
      (s) => Math.hypot(s.dx - best.dx, s.dy - best.dy) > 2,
    ),
    gap = best.score - (alternative?.score ?? -1),
    ambiguous =
      best.score < 0.8 ||
      gap < 0.03 ||
      Math.abs(best.dx) === radius ||
      Math.abs(best.dy) === radius;
  return {
    ...best,
    gap,
    ambiguous,
    radius,
    note: ambiguous
      ? "Ambiguous or boundary correlation peak; verify manually. Periodic fringes can give false matches."
      : "Candidate translation from corrected intensity. Verify sample registration and phase sign before subtraction.",
  };
}
export function crossSection(
  result,
  { axis = "horizontal", index = Math.floor(result.n / 2), pixelUm = 1 } = {},
) {
  if (
    !["horizontal", "vertical"].includes(axis) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index >= result.n ||
    !Number.isFinite(pixelUm) ||
    pixelUm <= 0
  )
    throw Error("Invalid cross-section settings.");
  return Array.from({ length: result.n }, (_, j) => {
    const x = axis === "horizontal" ? j : index,
      y = axis === "horizontal" ? index : j,
      i = y * result.n + x;
    return {
      x,
      y,
      positionUm: (j + 0.5) * pixelUm,
      value:
        result.mask[i] && Number.isFinite(result.height[i])
          ? result.height[i]
          : null,
    };
  });
}
export function differenceCSV(d, settings) {
  const rows = [
    "x_pixel,y_pixel,x_um,y_um,valid,sample_minus_reference_nm,aligned_reference_nm",
  ];
  for (let i = 0; i < d.n * d.n; i++) {
    const x = i % d.n,
      y = Math.floor(i / d.n);
    rows.push(
      [
        settings.x + x,
        settings.y + y,
        (settings.x + x + 0.5) * settings.pixelUm,
        (settings.y + y + 0.5) * settings.pixelUm,
        d.mask[i],
        d.mask[i] ? d.height[i] : "",
        d.mask[i] ? d.alignedReference[i] : "",
      ].join(","),
    );
  }
  return rows.join("\n");
}
