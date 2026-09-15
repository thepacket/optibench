import { analyzeMeasurement } from "./metrology.js";
import { measurementQuality } from "./measurement-quality.js";
export function sampleStats(values) {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return {
    mean,
    sd: Math.sqrt(
      values.reduce((a, b) => a + (b - mean) ** 2, 0) / (values.length - 1),
    ),
  };
}
function trend(rows, key) {
  if (
    rows.some(
      (r) =>
        typeof r.acquiredAt !== "string" ||
        !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(r.acquiredAt),
    )
  )
    return null;
  const times = rows.map((r) => Date.parse(r.acquiredAt));
  if (
    times.some((t) => !Number.isFinite(t)) ||
    new Set(times).size !== times.length
  )
    return null;
  const t0 = Math.min(...times),
    x = times.map((t) => (t - t0) / 60000),
    xm = x.reduce((a, b) => a + b, 0) / x.length,
    ym = rows.reduce((a, r) => a + r[key], 0) / rows.length;
  const denom = x.reduce((a, t) => a + (t - xm) ** 2, 0);
  return denom > 0
    ? rows.reduce((a, r, i) => a + (x[i] - xm) * (r[key] - ym), 0) / denom
    : null;
}
export function analyzeRepeats(runs, { verified = false } = {}) {
  if (!verified)
    throw Error(
      "Confirm independent acquisitions of the same sample, registration and unchanged measurement conditions.",
    );
  if (!Array.isArray(runs) || runs.length < 3 || runs.length > 20)
    throw Error("Choose 3–20 saved acquisitions.");
  if (new Set(runs.map((r) => r.id)).size !== runs.length)
    throw Error("Select distinct saved runs.");
  const sweeps = runs.filter((r) => r.simulation?.studyId);
  if (
    sweeps.length > 1 &&
    new Set(
      sweeps.map((r) =>
        JSON.stringify([r.simulation.parameter, r.simulation.value]),
      ),
    ).size > 1
  )
    throw Error(
      "Controlled sweep points change measurement conditions and cannot be treated as independent repeats.",
    );
  const acquisitionIds = runs.map((r) => r.acquisitionId).filter(Boolean);
  if (new Set(acquisitionIds).size !== acquisitionIds.length)
    throw Error(
      "Multiple saves of the same acquisition are not independent repeats.",
    );
  const base = runs[0].settings;
  for (const r of runs)
    for (const key of new Set([
      ...Object.keys(base),
      ...Object.keys(r.settings),
    ]))
      if (base[key] !== r.settings[key])
        throw Error(
          `Run ${r.name}: ${key} differs. Reconstruct with matching settings.`,
        );
  // Recompute from source intensity; imported cached results are not trusted.
  const results = runs.map((r) =>
      analyzeMeasurement(r.frames, r.settings, { dark: r.dark, flat: r.flat }),
    ),
    n = results[0].n;
  const mask = Uint8Array.from({ length: n * n }, (_, i) =>
      results.every((r) => r.mask[i] && Number.isFinite(r.height[i])) ? 1 : 0,
    ),
    count = mask.reduce((a, b) => a + b, 0);
  if (count < n * n * 0.25)
    throw Error("Less than 25% common valid area. Check alignment and masks.");
  if (
    base.method === "fourier" &&
    results.some(
      (r) =>
        r.carrier.x * results[0].carrier.x +
          r.carrier.y * results[0].carrier.y <=
        0,
    )
  )
    throw Error("Fourier carrier phase signs differ.");
  const mean = new Float64Array(n * n).fill(NaN),
    sd = new Float64Array(n * n).fill(NaN),
    m2 = new Float64Array(n * n),
    rows = [];
  results.forEach((r, k) => {
    let piston = 0;
    for (let i = 0; i < n * n; i++) if (mask[i]) piston += r.height[i] / count;
    let lo = Infinity,
      hi = -Infinity,
      sq = 0;
    for (let i = 0; i < n * n; i++)
      if (mask[i]) {
        const v = r.height[i] - piston;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
        sq += v * v;
        if (k === 0) mean[i] = v;
        else {
          const delta = v - mean[i];
          mean[i] += delta / (k + 1);
          m2[i] += delta * (v - mean[i]);
        }
      }
    rows.push({
      id: runs[k].id,
      name: runs[k].name,
      acquiredAt: runs[k].acquiredAt || null,
      pvNm: hi - lo,
      rmsNm: Math.sqrt(sq / count),
      quality: measurementQuality(r, runs[k].frames),
    });
  });
  let varianceSum = 0;
  for (let i = 0; i < n * n; i++)
    if (mask[i]) {
      sd[i] = Math.sqrt(Math.max(0, m2[i] / (runs.length - 1)));
      varianceSum += sd[i] ** 2;
    }
  const pv = sampleStats(rows.map((r) => r.pvNm)),
    rms = sampleStats(rows.map((r) => r.rmsNm));
  const warnings = [
    "Descriptive sample standard deviations (N−1); not an uncertainty budget or acceptance decision. Independent acquisitions, stable registration and unchanged conditions are operator assertions. Removed piston/tilt cannot be assessed.",
  ];
  if (rows.some((r) => r.quality.simulated))
    warnings.push(
      "Includes simulated data. These statistics do not establish physical instrument repeatability.",
    );
  if (rows.some((r) => r.quality.status === "review"))
    warnings.push(
      "One or more acquisitions has quality flags. Review each run before interpreting the study.",
    );
  const pvDriftNmMin = trend(rows, "pvNm"),
    rmsDriftNmMin = trend(rows, "rmsNm");
  if (pvDriftNmMin === null)
    warnings.push(
      "Drift unavailable: all acquisitions need distinct, valid acquisition timestamps. Save time is never substituted.",
    );
  return {
    format: "optibench-repeatability",
    version: 1,
    n,
    settings: base,
    verified: true,
    rows,
    mask,
    mean,
    sd,
    commonFraction: count / (n * n),
    pv,
    rms,
    pixelRepeatabilityNm: Math.sqrt(varianceSum / count),
    pvDriftNmMin,
    rmsDriftNmMin,
    warnings,
  };
}
const csvCell = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
export function repeatCSV(study) {
  return [
    "run_id,name,acquired_at,pv_nm,rms_nm,quality",
    ...study.rows.map((r) =>
      [r.id, r.name, r.acquiredAt, r.pvNm, r.rmsNm, r.quality.status]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}
export function repeatMapCSV(s) {
  const rows = ["x_roi_pixel,y_roi_pixel,valid,mean_nm,sample_sd_nm"];
  for (let i = 0; i < s.n * s.n; i++)
    rows.push(
      [
        i % s.n,
        Math.floor(i / s.n),
        s.mask[i],
        s.mask[i] ? s.mean[i] : "",
        s.mask[i] ? s.sd[i] : "",
      ].join(","),
    );
  return rows.join("\n");
}
