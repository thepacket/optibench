import { fft2 } from "./wave.js";
import { axes, dot } from "./ray3-geometry.js";
export const zernikeModes = [
  ["Piston", 0, 0],
  ["Tilt X", 1, 1],
  ["Tilt Y", 1, -1],
  ["Defocus", 2, 0],
  ["Astigmatism 45°", 2, -2],
  ["Astigmatism 0°", 2, 2],
  ["Coma Y", 3, -1],
  ["Coma X", 3, 1],
  ["Trefoil Y", 3, -3],
  ["Trefoil X", 3, 3],
  ["Spherical", 4, 0],
];
export function zernike(i, x, y) {
  const r2 = x * x + y * y;
  switch (i) {
    case 0:
      return 1;
    case 1:
      return 2 * x;
    case 2:
      return 2 * y;
    case 3:
      return Math.sqrt(3) * (2 * r2 - 1);
    case 4:
      return Math.sqrt(6) * 2 * x * y;
    case 5:
      return Math.sqrt(6) * (x * x - y * y);
    case 6:
      return Math.sqrt(8) * y * (3 * r2 - 2);
    case 7:
      return Math.sqrt(8) * x * (3 * r2 - 2);
    case 8:
      return Math.sqrt(8) * (3 * x * x * y - y * y * y);
    case 9:
      return Math.sqrt(8) * (x * x * x - 3 * x * y * y);
    case 10:
      return Math.sqrt(5) * (6 * r2 * r2 - 6 * r2 + 1);
    default:
      throw Error("Unsupported Zernike mode.");
  }
}
const finite = (v, lo, hi, name) => {
  if (!Number.isFinite(v) || v < lo || v > hi)
    throw Error(`${name} must be ${lo}–${hi}.`);
};
export function defaultPupil() {
  return {
    format: "optibench-pupil",
    version: 1,
    name: "Explicit circular pupil",
    provenance: "User-defined scalar pupil; independent of the ray bench",
    wavelength: 550,
    diameter: 10,
    focalLength: 100,
    obscuration: 0,
    grid: 64,
    remove: "piston-tilt",
    coefficients: Array(11).fill(0),
    opd: null,
  };
}
export function validatePupil(input) {
  const p = structuredClone(input);
  if (p?.format !== "optibench-pupil" || p.version !== 1)
    throw Error("Unsupported pupil format.");
  if (
    typeof p.name !== "string" ||
    p.name.length > 200 ||
    typeof p.provenance !== "string" ||
    p.provenance.length > 2000
  )
    throw Error("Provide pupil name and provenance.");
  finite(p.wavelength, 400, 1100, "Wavelength · nm");
  finite(p.diameter, 0.01, 1000, "Diameter · mm");
  finite(p.focalLength, 0.1, 100000, "Focal length · mm");
  finite(p.obscuration, 0, 0.8, "Obscuration radius ratio");
  if (p.diameter / (2 * p.focalLength) > 0.15)
    throw Error(
      "Scalar paraxial model requires diameter/(2 × focal length) ≤ 0.15.",
    );
  if (
    ![64, 128].includes(p.grid) ||
    !["piston", "piston-tilt"].includes(p.remove)
  )
    throw Error("Choose a 64 or 128 grid and supported phase removal.");
  if (!Array.isArray(p.coefficients) || p.coefficients.length !== 11)
    throw Error("Eleven coefficients are required.");
  p.coefficients.forEach((v) =>
    finite(v, -10000, 10000, "Zernike coefficient · nm"),
  );
  if (p.opd !== null) {
    if (!Array.isArray(p.opd) || p.opd.length !== p.grid ** 2)
      throw Error("OPD must have grid × grid entries.");
    for (let j = 0; j < p.opd.length; j++) {
      const [x, y] = pupilXY(j, p.grid),
        r = Math.hypot(x, y),
        inside = r <= 1 && r >= p.obscuration;
      if (inside) finite(p.opd[j], -1000000, 1000000, "Unwrapped OPD · nm");
      else if (p.opd[j] !== null)
        throw Error("OPD outside the pupil must be null.");
    }
  }
  return p;
}
export function pupilXY(j, n) {
  return [
    (2 * ((j % n) + 0.5)) / n - 1,
    (2 * (Math.floor(j / n) + 0.5)) / n - 1,
  ];
}
export function pupilSamples(input) {
  const p = validatePupil(input),
    samples = [];
  for (let j = 0; j < p.grid ** 2; j++) {
    const [x, y] = pupilXY(j, p.grid),
      r = Math.hypot(x, y);
    if (r > 1 || r < p.obscuration) continue;
    const opd =
      p.opd === null
        ? p.coefficients.reduce((s, c, i) => s + c * zernike(i, x, y), 0)
        : p.opd[j];
    samples.push({ j, x, y, opd });
  }
  return samples;
}
// Reorthogonalized modified Gram-Schmidt avoids normal-equation conditioning loss.
export function fitZernike(samples) {
  if (samples.length < 22)
    throw Error("At least 22 pupil samples are required.");
  const m = 11,
    q = [],
    R = Array.from({ length: m }, () => Array(m).fill(0));
  for (let k = 0; k < m; k++) {
    let v = samples.map((s) => zernike(k, s.x, s.y));
    for (let pass = 0; pass < 2; pass++)
      for (let j = 0; j < k; j++) {
        const a = v.reduce((s, t, i) => s + t * q[j][i], 0);
        R[j][k] += a;
        v = v.map((t, i) => t - a * q[j][i]);
      }
    const norm = Math.hypot(...v);
    if (norm < 1e-8 * Math.sqrt(samples.length))
      throw Error("Pupil sample geometry is rank deficient.");
    R[k][k] = norm;
    q.push(v.map((t) => t / norm));
  }
  const c = q.map((v) => v.reduce((s, t, i) => s + t * samples[i].opd, 0));
  for (let j = m - 1; j >= 0; j--) {
    for (let k = j + 1; k < m; k++) c[j] -= R[j][k] * c[k];
    c[j] /= R[j][j];
  }
  const residualRms = Math.sqrt(
    samples.reduce(
      (s, t) =>
        s +
        (t.opd - c.reduce((v, a, i) => v + a * zernike(i, t.x, t.y), 0)) ** 2,
      0,
    ) / samples.length,
  );
  return { coefficients: c, residualRms };
}
function energyCurve(points, total) {
  const sorted = points.slice().sort((a, b) => a.r - b.r);
  let sum = 0;
  const curve = [];
  for (const p of sorted) {
    sum += p.power;
    curve.push({ radius: p.r, fraction: sum / total });
  }
  // Preserve both the steep central rise and the low-energy tail of the curve.
  const display = [];
  const maxRadius = curve.at(-1)?.radius || 1;
  for (let i = 0; i < curve.length; i++) {
    if (i < curve.length - 1 && curve[i].radius === curve[i + 1].radius)
      continue;
    const last = display.at(-1),
      p = curve[i];
    if (
      !last ||
      p.fraction - last.fraction >= 0.004 ||
      p.radius - last.radius >= maxRadius / 256 ||
      i === curve.length - 1
    )
      display.push(p);
  }
  return {
    curve: display,
    r50: curve.find((p) => p.fraction >= 0.5)?.radius ?? null,
    r80: curve.find((p) => p.fraction >= 0.8)?.radius ?? null,
    r95: curve.find((p) => p.fraction >= 0.95)?.radius ?? null,
  };
}
export function spotStatistics(hits) {
  const good = hits.filter(
    (h) =>
      Number.isFinite(h.power) && h.power > 0 && h.uv?.every(Number.isFinite),
  );
  const power = good.reduce((s, h) => s + h.power, 0);
  if (!power)
    return { status: "no signal", power: 0, count: 0, points: [], curve: [] };
  const centroid = [0, 1].map(
    (k) => good.reduce((s, h) => s + h.power * h.uv[k], 0) / power,
  );
  let xx = 0,
    yy = 0,
    xy = 0;
  const points = good.map((h) => {
    const x = h.uv[0] - centroid[0],
      y = h.uv[1] - centroid[1];
    xx += (h.power * x * x) / power;
    yy += (h.power * y * y) / power;
    xy += (h.power * x * y) / power;
    return { u: h.uv[0], v: h.uv[1], r: Math.hypot(x, y), power: h.power };
  });
  const delta = Math.hypot(xx - yy, 2 * xy);
  return {
    status: "complete",
    power,
    count: good.length,
    centroid,
    covariance: [xx, xy, yy],
    rmsRadius: Math.sqrt(xx + yy),
    sigmaMajor: Math.sqrt(Math.max(0, (xx + yy + delta) / 2)),
    sigmaMinor: Math.sqrt(Math.max(0, (xx + yy - delta) / 2)),
    angleDeg: (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI,
    points,
    ...energyCurve(points, power),
  };
}
export function selectSpot(
  run,
  { detectorId, sourceId = "", path = "all" } = {},
) {
  if (!run?.scene || !run.detectorHits) throw Error("Trace a ray scene first.");
  const detector = run.scene.objects.find(
    (o) => o.id === detectorId && o.kind === "detector",
  );
  if (!detector) throw Error("Choose a recorded detector.");
  if (!["all", "direct", "specular", "scattered"].includes(path))
    throw Error("Unknown ray path selection.");
  const hits = run.detectorHits
    .filter(
      (h) =>
        h.detectorId === detectorId && (!sourceId || h.sourceId === sourceId),
    )
    .filter((h) => {
      const scattering = h.path.some((p) => p.event === "S"),
        reflection = h.path.some((p) => ["R", "TIR"].includes(p.event));
      return (
        path === "all" ||
        (path === "scattered"
          ? scattering
          : path === "specular"
            ? !scattering && reflection
            : !scattering && !reflection)
      );
    });
  return { detector, hits, statistics: spotStatistics(hits) };
}
export function focusScan(
  run,
  selection,
  { start = -20, end = 20, count = 21 } = {},
) {
  finite(start, -1000, 1000, "Start offset · mm");
  finite(end, -1000, 1000, "End offset · mm");
  if (end <= start || !Number.isInteger(count) || count < 3 || count > 41)
    throw Error("Use an increasing range and 3–41 focus planes.");
  const { detector, hits } = selectSpot(run, selection),
    basis = axes(detector.normal);
  if (hits.length < 3) throw Error("At least three detected rays are needed.");
  const slopes = hits.map((h) => {
    const den = dot(h.direction, detector.normal);
    if (Math.abs(den) < 1e-6)
      throw Error("A grazing ray makes the virtual focus undefined.");
    return [dot(h.direction, basis.u) / den, dot(h.direction, basis.v) / den];
  });
  const base = spotStatistics(hits),
    w = hits.map((h) => h.power / base.power),
    mean = [0, 1].map((k) => slopes.reduce((s, v, i) => s + w[i] * v[k], 0));
  let A = 0,
    B = 0;
  for (let i = 0; i < hits.length; i++)
    for (let k = 0; k < 2; k++) {
      const v = slopes[i][k] - mean[k];
      A += w[i] * v * v;
      B += w[i] * (hits[i].uv[k] - base.centroid[k]) * v;
    }
  const at = (t) =>
    spotStatistics(
      hits.map((h, i) => ({
        ...h,
        uv: h.uv.map((v, k) => v + t * slopes[i][k]),
      })),
    );
  const rows = Array.from({ length: count }, (_, i) => {
    const offset = start + ((end - start) * i) / (count - 1),
      s = at(offset);
    return { offset, rmsRadius: s.rmsRadius, r80: s.r80, power: s.power };
  });
  const optimum = A > 1e-20 ? -B / A : null;
  return {
    rows,
    optimum,
    bestInRange:
      optimum === null ? null : Math.max(start, Math.min(end, optimum)),
    minimum: optimum === null ? null : at(optimum).rmsRadius,
    warning:
      "Virtual free-space projection of already collected rays. No retracing, intervening optics, aperture changes or recovery of vignetted rays. Offsets follow the recorded detector normal.",
  };
}
export function analyzePupil(input) {
  const p = validatePupil(input),
    samples = pupilSamples(p),
    fit = fitZernike(samples),
    n = p.grid * 4,
    re = new Float64Array(n * n),
    im = new Float64Array(n * n),
    idealRe = new Float64Array(n * n),
    idealIm = new Float64Array(n * n),
    opd = Array(p.grid ** 2).fill(null),
    remove = p.remove === "piston-tilt" ? 3 : 1;
  let min = Infinity,
    max = -Infinity,
    sum = 0,
    sum2 = 0,
    maxPhaseStep = 0;
  for (const s of samples) {
    const w =
      s.opd -
      fit.coefficients
        .slice(0, remove)
        .reduce((a, c, i) => a + c * zernike(i, s.x, s.y), 0);
    opd[s.j] = w;
    min = Math.min(min, w);
    max = Math.max(max, w);
    sum += w;
    sum2 += w * w;
    const j =
        (Math.floor(s.j / p.grid) + (n - p.grid) / 2) * n +
        (s.j % p.grid) +
        (n - p.grid) / 2,
      phase = (2 * Math.PI * w) / p.wavelength;
    re[j] = Math.cos(phase);
    im[j] = Math.sin(phase);
    idealRe[j] = 1;
  }
  for (let j = 0; j < opd.length; j++)
    if (opd[j] !== null)
      for (const k of [j % p.grid < p.grid - 1 ? j + 1 : -1, j + p.grid])
        if (k >= 0 && k < opd.length && opd[k] !== null)
          maxPhaseStep = Math.max(
            maxPhaseStep,
            (2 * Math.PI * Math.abs(opd[j] - opd[k])) / p.wavelength,
          );
  fft2(re, im, n);
  fft2(idealRe, idealIm, n);
  let total = 0,
    peak = 0,
    idealPeak = 0;
  const psf = new Float64Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const j = y * n + x,
        k = ((y + n / 2) % n) * n + ((x + n / 2) % n);
      psf[k] = re[j] ** 2 + im[j] ** 2;
      total += psf[k];
      peak = Math.max(peak, psf[k]);
      idealPeak = Math.max(idealPeak, idealRe[j] ** 2 + idealIm[j] ** 2);
    }
  for (let j = 0; j < psf.length; j++) psf[j] /= total;
  const pixelMm = (p.wavelength * 1e-6 * p.focalLength) / (4 * p.diameter),
    otfRe = psf.slice(),
    otfIm = new Float64Array(n * n);
  fft2(otfRe, otfIm, n);
  const mtf = Array.from({ length: n / 2 + 1 }, (_, i) => ({
    frequency: i / (n * pixelMm),
    x: Math.hypot(otfRe[i], otfIm[i]),
    y: Math.hypot(otfRe[i * n], otfIm[i * n]),
  }));
  const radial = [];
  let edgePower = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const power = psf[y * n + x];
      radial.push({ r: Math.hypot(x - n / 2, y - n / 2) * pixelMm, power });
      if (x < 4 || y < 4 || x >= n - 4 || y >= n - 4) edgePower += power;
    }
  const warnings = [];
  if (maxPhaseStep > Math.PI)
    warnings.push(
      "Adjacent pupil phase exceeds π; wavefront sampling is insufficient.",
    );
  if (edgePower > 0.001)
    warnings.push(
      "More than 0.1% of sampled PSF power is near the image boundary; enlarge pupil sampling to check wraparound.",
    );
  warnings.push(
    "Repeat at 128 pupil samples before interpreting small features. PSF energy is normalized inside the finite FFT window.",
  );
  return {
    format: "optibench-imaging-result",
    version: 1,
    settings: p,
    fit,
    opd,
    rms: Math.sqrt(
      Math.max(0, sum2 / samples.length - (sum / samples.length) ** 2),
    ),
    pv: max - min,
    sampleCount: samples.length,
    n,
    pixelMm,
    psf: Array.from(psf),
    strehl: peak / idealPeak,
    mtf,
    cutoff: p.diameter / (p.wavelength * 1e-6 * p.focalLength),
    encircled: energyCurve(radial, 1),
    maxPhaseStep,
    edgePower,
    warnings,
  };
}
export function pupilMap(input) {
  const p = validatePupil(input);
  return {
    ...p,
    opd: Array.from({ length: p.grid ** 2 }, (_, j) => {
      const [x, y] = pupilXY(j, p.grid),
        r = Math.hypot(x, y);
      return r > 1 || r < p.obscuration
        ? null
        : (p.opd?.[j] ??
            p.coefficients.reduce((s, c, i) => s + c * zernike(i, x, y), 0));
    }),
  };
}
export function parsePupil(text) {
  if (text.length > 4000000) throw Error("Pupil input exceeds 4 MB.");
  return validatePupil(JSON.parse(text));
}
export function imagingCSV(result) {
  return [
    "frequency_cycles_per_mm,mtf_x,mtf_y",
    ...result.mtf.map((p) => `${p.frequency},${p.x},${p.y}`),
  ].join("\n");
}
