import { fft2 } from "./wave.js";
export const METROLOGY_VERSION = "1.0.0";
const TAU = 2 * Math.PI;
export const wrapPhase = (x) => Math.atan2(Math.sin(x), Math.cos(x));
export const defaultMeasurementSettings = () => ({
  method: "four-step",
  n: 256,
  x: 0,
  y: 0,
  pixelUm: 10,
  wavelength: 633,
  geometry: "opd",
  incidence: 0,
  minVisibility: 0.1,
  removeTilt: true,
  bandwidth: 5,
  carrierX: 0,
  carrierY: 0,
  autoCarrier: true,
});
function finite(v, min, max, label) {
  if (!Number.isFinite(v) || v < min || v > max)
    throw Error(`Invalid ${label}. Expected ${min}–${max}.`);
  return v;
}
export function validateFrame(f) {
  if (!f || !Number.isInteger(f.width) || !Number.isInteger(f.height))
    throw Error("Frame dimensions are required.");
  finite(f.width, 64, 2048, "frame width");
  finite(f.height, 64, 2048, "frame height");
  if (!f.values || f.values.length !== f.width * f.height)
    throw Error("Frame dimensions do not match its samples.");
  for (const v of f.values) finite(v, 0, 1, "normalized image sample");
  return f;
}
export function validateMeasurementSettings(s, frame) {
  const out = { ...defaultMeasurementSettings(), ...s };
  if (
    typeof out.removeTilt !== "boolean" ||
    typeof out.autoCarrier !== "boolean"
  )
    throw Error("Analysis switches must be boolean values.");
  if (!["four-step", "fourier"].includes(out.method))
    throw Error("Unknown phase reconstruction method.");
  if (![64, 128, 256, 512].includes(out.n))
    throw Error("ROI size must be 64, 128, 256 or 512 pixels.");
  for (const key of ["x", "y"])
    if (!Number.isInteger(out[key]) || out[key] < 0)
      throw Error("ROI origin must be nonnegative whole pixels.");
  if (frame && (out.x + out.n > frame.width || out.y + out.n > frame.height))
    throw Error(
      "The square ROI must fit inside every image. Reduce its size or move its origin.",
    );
  finite(out.pixelUm, 0.000001, 100000, "object-plane pixel scale");
  finite(out.wavelength, 200, 20000, "wavelength");
  finite(out.incidence, 0, 80, "incidence");
  finite(out.minVisibility, 0.01, 0.95, "visibility threshold");
  finite(out.bandwidth, 1, 32, "sideband radius");
  finite(out.carrierX, -out.n / 2, out.n / 2, "carrier X");
  finite(out.carrierY, -out.n / 2, out.n / 2, "carrier Y");
  if (!["opd", "reflection"].includes(out.geometry))
    throw Error("Choose OPD or reflecting-surface height.");
  return out;
}
export function cropFrame(frame, s) {
  const a = new Float64Array(s.n * s.n);
  for (let y = 0; y < s.n; y++)
    for (let x = 0; x < s.n; x++)
      a[y * s.n + x] = frame.values[(s.y + y) * frame.width + s.x + x];
  return a;
}
// Quality-guided flood unwrap: only the connected component containing the best
// modulation sample is reported, so islands never acquire a fictitious shared offset.
export function unwrapQuality(wrapped, quality, mask, n) {
  const out = new Float64Array(n * n).fill(NaN),
    seen = new Uint8Array(n * n),
    heap = [];
  let seed = -1;
  for (let i = 0; i < mask.length; i++)
    if (mask[i] && (seed < 0 || quality[i] > quality[seed])) seed = i;
  if (seed < 0)
    throw Error(
      "No valid fringe pixels remain. Check exposure, contrast and calibration frames.",
    );
  const push = (i, parent) => {
    if (seen[i] || !mask[i]) return;
    seen[i] = 1;
    const item = { i, parent, q: quality[i] };
    heap.push(item);
    let k = heap.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heap[p].q >= item.q) break;
      heap[k] = heap[p];
      k = p;
    }
    heap[k] = item;
  };
  const pop = () => {
    const top = heap[0],
      last = heap.pop();
    if (heap.length) {
      let k = 0;
      while (k * 2 + 1 < heap.length) {
        let c = k * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1].q > heap[c].q) c++;
        if (heap[c].q <= last.q) break;
        heap[k] = heap[c];
        k = c;
      }
      heap[k] = last;
    }
    return top;
  };
  push(seed, -1);
  let count = 0;
  while (heap.length) {
    const { i, parent } = pop();
    out[i] =
      parent < 0
        ? wrapped[i]
        : out[parent] + wrapPhase(wrapped[i] - wrapped[parent]);
    count++;
    const x = i % n,
      y = Math.floor(i / n);
    if (x) push(i - 1, i);
    if (x < n - 1) push(i + 1, i);
    if (y) push(i - n, i);
    if (y < n - 1) push(i + n, i);
  }
  let conflicts = 0,
    edges = 0;
  for (let i = 0; i < out.length; i++)
    if (Number.isFinite(out[i]))
      for (const j of [
        i % n < n - 1 ? i + 1 : -1,
        i + n < out.length ? i + n : -1,
      ])
        if (j >= 0 && Number.isFinite(out[j])) {
          edges++;
          if (
            Math.abs(out[j] - out[i] - wrapPhase(wrapped[j] - wrapped[i])) >
            Math.PI
          )
            conflicts++;
        }
  return { values: out, count, conflicts, edges };
}
export function removePlane(values, n, tilt = true) {
  const sums = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  let count = 0,
    mean = 0;
  for (let i = 0; i < values.length; i++)
    if (Number.isFinite(values[i])) {
      const v = [1, (i % n) / n - 0.5, Math.floor(i / n) / n - 0.5];
      count++;
      mean += values[i];
      for (let j = 0; j < 3; j++) {
        for (let k = 0; k < 3; k++) sums[j][k] += v[j] * v[k];
        sums[j][3] += v[j] * values[i];
      }
    }
  let coeff = [mean / count, 0, 0];
  if (tilt) {
    for (let j = 0; j < 3; j++) {
      let p = j;
      for (let i = j + 1; i < 3; i++)
        if (Math.abs(sums[i][j]) > Math.abs(sums[p][j])) p = i;
      [sums[j], sums[p]] = [sums[p], sums[j]];
      const d = sums[j][j];
      if (Math.abs(d) < 1e-9)
        throw Error("Valid phase region is too narrow to remove a plane.");
      for (let k = j; k < 4; k++) sums[j][k] /= d;
      for (let i = 0; i < 3; i++)
        if (i !== j) {
          const a = sums[i][j];
          for (let k = j; k < 4; k++) sums[i][k] -= a * sums[j][k];
        }
    }
    coeff = sums.map((r) => r[3]);
  }
  return {
    values: Float64Array.from(
      values,
      (v, i) =>
        v -
        coeff[0] -
        coeff[1] * ((i % n) / n - 0.5) -
        coeff[2] * (Math.floor(i / n) / n - 0.5),
    ),
    coeff,
  };
}
export function analyzeMeasurement(
  frames,
  settings,
  { dark = null, flat = null } = {},
) {
  if (!frames.length)
    throw Error("Import a fringe image or load a demonstration first.");
  frames.forEach(validateFrame);
  const s = validateMeasurementSettings(settings, frames[0]),
    n = s.n,
    len = n * n;
  if (s.method === "four-step" && frames.length !== 4)
    throw Error(
      "Four-step analysis requires four frames in 0°, 90°, 180°, 270° order.",
    );
  if (s.method === "fourier" && frames.length !== 1)
    throw Error("Single-image Fourier analysis requires exactly one frame.");
  for (const f of [...frames, dark, flat].filter(Boolean)) {
    validateFrame(f);
    if (f.width !== frames[0].width || f.height !== frames[0].height)
      throw Error(
        "All signal and calibration frames must have matching dimensions.",
      );
  }
  const raw = frames.map((f) => cropFrame(f, s)),
    d = dark ? cropFrame(dark, s) : new Float64Array(len),
    fl = flat ? cropFrame(flat, s) : null;
  const valid = new Uint8Array(len).fill(1),
    corrected = raw.map(() => new Float64Array(len));
  let clipped = 0,
    badFlat = 0;
  for (let i = 0; i < len; i++) {
    if (raw.some((f) => f[i] >= 1 || f[i] <= 0)) {
      valid[i] = 0;
      clipped++;
    }
    const denom = fl ? fl[i] - d[i] : 1;
    if (denom <= 1e-5 || (fl && fl[i] >= 1) || d[i] >= 1) {
      valid[i] = 0;
      badFlat++;
    }
    for (let j = 0; j < raw.length; j++)
      corrected[j][i] = Math.max(0, (raw[j][i] - d[i]) / Math.max(denom, 1e-5));
  }
  const wrapped = new Float64Array(len),
    modulation = new Float64Array(len),
    visibility = new Float64Array(len),
    warnings = [];
  let carrier = null,
    spectrum = null,
    stepResidual = 0;
  if (s.method === "four-step") {
    for (let i = 0; i < len; i++) {
      const [a, b, c, d] = corrected.map((f) => f[i]),
        dc = (a + b + c + d) / 4,
        cos = a - c,
        sin = d - b;
      modulation[i] = Math.hypot(cos, sin) / 2;
      visibility[i] = dc > 0 ? modulation[i] / dc : 0;
      wrapped[i] = Math.atan2(sin, cos);
      if (valid[i])
        stepResidual += ((a + c - b - d) / (4 * Math.max(dc, 1e-9))) ** 2;
    }
    stepResidual = Math.sqrt(
      stepResidual /
        Math.max(
          1,
          valid.reduce((a, b) => a + b, 0),
        ),
    );
    if (stepResidual > 0.05)
      warnings.push(
        "Opposing phase-step sums disagree. Exposure drift, motion or phase-step error may invalidate the reconstruction.",
      );
  } else {
    const re = new Float64Array(len),
      im = new Float64Array(len),
      mean = corrected[0].reduce((a, b) => a + b, 0) / len;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const w =
          Math.sin((Math.PI * x) / (n - 1)) ** 2 *
          Math.sin((Math.PI * y) / (n - 1)) ** 2;
        re[y * n + x] = (corrected[0][y * n + x] - mean) * w;
      }
    fft2(re, im, n);
    spectrum = new Float64Array(len);
    let peak = -1,
      kx = s.carrierX,
      ky = s.carrierY;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const fx = x < n / 2 ? x : x - n,
          fy = y < n / 2 ? y : y - n,
          p = re[y * n + x] ** 2 + im[y * n + x] ** 2;
        spectrum[((y + n / 2) % n) * n + ((x + n / 2) % n)] = Math.log1p(p);
        if (
          s.autoCarrier &&
          (fy > 0 || (fy === 0 && fx > 0)) &&
          Math.hypot(fx, fy) > Math.max(5, s.bandwidth * 2) &&
          p > peak
        ) {
          peak = p;
          kx = fx;
          ky = fy;
        }
      }
    const radius = s.bandwidth,
      r = Math.hypot(kx, ky);
    if (
      r < 2 * radius + 1 ||
      Math.abs(kx) + radius >= n / 2 ||
      Math.abs(ky) + radius >= n / 2
    )
      throw Error(
        "The selected sideband overlaps DC or the Nyquist boundary. Choose a separated carrier and a smaller filter radius.",
      );
    let energy = 0,
      total = 0;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x,
          fx = x < n / 2 ? x : x - n,
          fy = y < n / 2 ? y : y - n,
          dist = Math.hypot(fx - kx, fy - ky),
          w =
            dist < radius * 0.7
              ? 1
              : dist < radius
                ? 0.5 * (1 + Math.cos((Math.PI * (dist / radius - 0.7)) / 0.3))
                : 0;
        total += re[i] ** 2 + im[i] ** 2;
        re[i] *= w;
        im[i] *= w;
        energy += re[i] ** 2 + im[i] ** 2;
      }
    if (total < 1e-12 || energy / total < 0.01)
      throw Error(
        "No isolated carrier with enough signal was found. Use phase-stepped frames or adjust the sideband.",
      );
    fft2(re, im, n, true);
    let peakAmp = 0;
    for (let i = 0; i < len; i++) {
      modulation[i] = 2 * Math.hypot(re[i], im[i]);
      peakAmp = Math.max(peakAmp, modulation[i]);
      wrapped[i] = Math.atan2(im[i], re[i]);
    }
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const i = y * n + x,
          w =
            Math.sin((Math.PI * x) / (n - 1)) ** 2 *
            Math.sin((Math.PI * y) / (n - 1)) ** 2;
        visibility[i] = mean > 0 && w > 0.1 ? modulation[i] / (mean * w) : 0;
        if (
          x < n * 0.1 ||
          y < n * 0.1 ||
          x >= n * 0.9 ||
          y >= n * 0.9 ||
          modulation[i] < peakAmp * 0.05
        )
          valid[i] = 0;
      }
    carrier = {
      x: kx,
      y: ky,
      periodPixels: n / r,
      normalAngle: (Math.atan2(ky, kx) * 180) / Math.PI,
      bandwidth: radius,
    };
    warnings.push(
      "Single-image phase has a conjugate-sign ambiguity. A separated carrier and slowly varying object phase are required; the outer 10% is excluded.",
    );
  }
  for (let i = 0; i < len; i++)
    if (visibility[i] < s.minVisibility || visibility[i] > 1.2) valid[i] = 0;
  const unwrapped = unwrapQuality(wrapped, modulation, valid, n),
    detrended = removePlane(unwrapped.values, n, s.removeTilt);
  const totalValid = valid.reduce((a, b) => a + b, 0),
    islands = totalValid - unwrapped.count;
  if (islands)
    warnings.push(
      `${islands} disconnected pixels excluded; their relative phase order is unknown.`,
    );
  if (unwrapped.conflicts)
    warnings.push(
      `${unwrapped.conflicts} inconsistent unwrap edges. Smoothness assumptions may fail; inspect the map before using heights.`,
    );
  if (clipped)
    warnings.push(
      `${clipped} pixels excluded for signal clipping at 0 or full scale.`,
    );
  if (badFlat)
    warnings.push(
      `${badFlat} pixels excluded for invalid calibration response.`,
    );
  if (unwrapped.count < len * 0.25)
    warnings.push("Less than 25% of the ROI has a connected valid phase.");
  const factor =
    s.wavelength /
    TAU /
    (s.geometry === "reflection"
      ? 2 * Math.cos((s.incidence * Math.PI) / 180)
      : 1);
  const height = Float64Array.from(detrended.values, (v) => v * factor);
  let min = Infinity,
    max = -Infinity,
    sum2 = 0,
    vis = 0;
  for (let i = 0; i < len; i++)
    if (Number.isFinite(height[i])) {
      min = Math.min(min, height[i]);
      max = Math.max(max, height[i]);
      sum2 += height[i] ** 2;
      vis += visibility[i];
    }
  return {
    version: METROLOGY_VERSION,
    n,
    settings: s,
    corrected: corrected[0],
    wrapped,
    phase: detrended.values,
    height,
    visibility,
    mask: Uint8Array.from(height, (v) => (Number.isFinite(v) ? 1 : 0)),
    spectrum,
    carrier,
    plane: detrended.coeff,
    warnings,
    stats: {
      pvNm: max - min,
      rmsNm: Math.sqrt(sum2 / unwrapped.count),
      validFraction: unwrapped.count / len,
      meanVisibility: vis / unwrapped.count,
      stepResidual,
      unwrapConflicts: unwrapped.conflicts,
      clippedPixels: clipped,
    },
    unit:
      s.geometry === "reflection"
        ? "Relative surface height (nm)"
        : "Relative OPD (nm)",
  };
}
export function demoFrames(n = 256) {
  return Array.from({ length: 4 }, (_, j) => ({
    name: `Demo ${j * 90}°`,
    width: n,
    height: n,
    origin: "synthetic demonstration",
    values: Float64Array.from({ length: n * n }, (_, i) => {
      const x = i % n,
        y = Math.floor(i / n),
        phase =
          (TAU * (12 * x + 5 * y)) / n +
          1.8 *
            Math.exp(
              -((x - n * 0.5) ** 2 + (y - n * 0.5) ** 2) / (n * 0.2) ** 2,
            );
      return 0.5 + 0.4 * Math.cos(phase + (j * Math.PI) / 2);
    }),
  }));
}
export function measurementCSV(result) {
  const rows = [
    "x_pixel,y_pixel,x_um,y_um,valid,corrected_signal,wrapped_rad,relative_phase_rad,relative_nm,visibility",
  ];
  const { n, settings: s } = result;
  for (let i = 0; i < n * n; i++) {
    const x = i % n,
      y = Math.floor(i / n),
      valid = result.mask[i];
    rows.push(
      [
        s.x + x,
        s.y + y,
        (s.x + x + 0.5) * s.pixelUm,
        (s.y + y + 0.5) * s.pixelUm,
        valid,
        result.corrected[i],
        valid ? result.wrapped[i] : "",
        valid ? result.phase[i] : "",
        valid ? result.height[i] : "",
        result.visibility[i],
      ].join(","),
    );
  }
  return rows.join("\n");
}
