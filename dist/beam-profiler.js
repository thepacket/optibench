import { propagationUncertainty } from "./profiler-statistics.js";
import { validateProject, makeProject } from "./project.js";
import { trace } from "./optics.js";
import { cameraResponse } from "./wave.js";

export function profilerExample() {
  const p = makeProject("focus");
  p.title = "Camera beam profiling · focused Gaussian beam";
  p.items[0].waist = 0.3;
  p.items[0].power = 0.000002;
  p.items[2].exposure = 2;
  return p;
}
const sum = (a) => a.reduce((s, v) => s + v, 0);
function gaussianFit(values, pitch, mean, sigma) {
  const n = values.length,
    xs = values.map((_, i) => (i + 0.5 - n / 2) * pitch);
  function trial(mu, s) {
    if (s < pitch || s > (n * pitch) / 2 || Math.abs(mu) > (n * pitch) / 2)
      return { error: Infinity };
    const g = xs.map((x) => Math.exp(-0.5 * ((x - mu) / s) ** 2)),
      g1 = sum(g),
      g2 = sum(g.map((v) => v * v)),
      v1 = sum(values),
      gv = sum(g.map((v, i) => v * values[i])),
      den = n * g2 - g1 * g1;
    if (den < 1e-15) return { error: Infinity };
    const amplitude = (n * gv - g1 * v1) / den,
      baseline = (v1 - amplitude * g1) / n;
    if (amplitude <= 0) return { error: Infinity };
    const fitted = g.map((v) => baseline + amplitude * v),
      residuals = values.map((v, i) => v - fitted[i]);
    return {
      meanMm: mu,
      sigmaMm: s,
      diameterMm: 4 * s,
      amplitude,
      baseline,
      fitted,
      residuals,
      error: sum(residuals.map((v) => v * v)),
    };
  }
  let best = trial(mean, Math.max(pitch, sigma)),
    stepM = Math.max(pitch, sigma / 2),
    stepS = stepM;
  for (let k = 0; k < 45; k++) {
    let next = best;
    for (const dm of [-stepM, 0, stepM])
      for (const ds of [-stepS, 0, stepS]) {
        const v = trial(best.meanMm + dm, best.sigmaMm + ds);
        if (v.error < next.error) next = v;
      }
    if (next === best) {
      stepM *= 0.5;
      stepS *= 0.5;
    } else best = next;
  }
  if (!Number.isFinite(best.error)) return null;
  return {
    ...best,
    rms: Math.sqrt(best.error / n),
    relativeRms: Math.sqrt(best.error / n) / best.amplitude,
  };
}
// Signed background-subtracted moments avoid the positive bias of clipping negative noise.
export function analyzeBeamFrame(frame, dark, pixelUm) {
  const { n, values } = frame;
  if (
    !Number.isInteger(n) ||
    n < 16 ||
    values.length !== n * n ||
    dark.length !== n * n ||
    !Number.isFinite(pixelUm) ||
    pixelUm <= 0 ||
    [...values, ...dark].some((v) => !Number.isFinite(v))
  )
    throw Error("Invalid beam frame or background.");
  const pitch = pixelUm / 1000,
    corrected = values.map((v, i) => v - dark[i]),
    border = [],
    band = Math.max(2, Math.floor(n * 0.05));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (x < band || y < band || x >= n - band || y >= n - band)
        border.push(corrected[y * n + x]);
  const pedestal = sum(border) / border.length,
    noise = Math.sqrt(
      sum(border.map((v) => (v - pedestal) ** 2)) / border.length,
    ),
    data = corrected.map((v) => v - pedestal),
    total = sum(data),
    peak = data.reduce((m, v) => Math.max(m, v), -Infinity),
    warnings = [];
  if (!(total > 0) || peak < Math.max(noise * 10, 1e-6))
    throw Error(
      "Beam signal is too weak or occupies the background border. Increase exposure for a weak beam, or enlarge the ROI for a cropped beam.",
    );
  const px = Array(n).fill(0),
    py = Array(n).fill(0);
  let mx = 0,
    my = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = data[y * n + x];
      px[x] += v;
      py[y] += v;
      mx += v * (x + 0.5 - n / 2) * pitch;
      my += v * (y + 0.5 - n / 2) * pitch;
    }
  mx /= total;
  my /= total;
  let xx = 0,
    yy = 0,
    xy = 0,
    edge = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = data[y * n + x],
        dx = (x + 0.5 - n / 2) * pitch - mx,
        dy = (y + 0.5 - n / 2) * pitch - my;
      xx += v * dx * dx;
      yy += v * dy * dy;
      xy += v * dx * dy;
      if (x < band || y < band || x >= n - band || y >= n - band)
        edge += Math.max(0, corrected[y * n + x]);
    }
  xx /= total;
  yy /= total;
  xy /= total;
  const disc = Math.hypot(xx - yy, 2 * xy),
    major = (xx + yy + disc) / 2,
    minor = (xx + yy - disc) / 2;
  if (!(minor > 0) || !Number.isFinite(major))
    throw Error(
      "Background noise prevents a positive beam-width estimate. Increase exposure or use a smaller ROI.",
    );
  const fitX = gaussianFit(px, pitch, mx, Math.sqrt(xx)),
    fitY = gaussianFit(py, pitch, my, Math.sqrt(yy)),
    diameterX = 4 * Math.sqrt(xx),
    diameterY = 4 * Math.sqrt(yy),
    ellipticity = Math.sqrt(minor / major);
  const saturated = values.filter((v) => v >= 1).length / values.length;
  if (saturated > 0 || frame.saturated > 0)
    warnings.push(
      "Saturation detected. Reduce exposure; widths are invalid for propagation fitting.",
    );
  if (
    Math.abs(mx) + 3 * Math.sqrt(xx) > (n * pitch) / 2 ||
    Math.abs(my) + 3 * Math.sqrt(yy) > (n * pitch) / 2 ||
    pedestal > Math.max(peak * 0.005, (noise * 3) / Math.sqrt(border.length))
  )
    warnings.push(
      "Beam approaches the ROI boundary; enlarge the ROI or recenter the camera. Cropping biases widths.",
    );
  if (Math.min(diameterX, diameterY) / pitch < 8)
    warnings.push(
      "Beam diameter spans fewer than eight pixels; spatial sampling is insufficient.",
    );
  if (!fitX || !fitY || Math.max(fitX.relativeRms, fitY.relativeRms) > 0.05)
    warnings.push(
      "Gaussian fit residuals are large; the Gaussian propagation fit is unsuitable.",
    );
  if (
    fitX &&
    fitY &&
    Math.max(
      Math.abs(fitX.diameterMm / diameterX - 1),
      Math.abs(fitY.diameterMm / diameterY - 1),
    ) > 0.1
  )
    warnings.push(
      "Moment and Gaussian widths disagree by more than 10%; background or cropping may dominate.",
    );
  return {
    centroidXmm: mx,
    centroidYmm: my,
    diameterXmm: diameterX,
    diameterYmm: diameterY,
    majorDiameterMm: 4 * Math.sqrt(major),
    minorDiameterMm: 4 * Math.sqrt(minor),
    ellipticity,
    orientationDeg:
      ellipticity > 0.98 ? null : (Math.atan2(2 * xy, xx - yy) * 90) / Math.PI,
    saturatedFraction: Math.max(saturated, frame.saturated || 0),
    borderOffset: pedestal,
    borderNoise: noise,
    total,
    profiles: { x: px, y: py },
    fitX,
    fitY,
    warnings,
    valid: warnings.length === 0,
  };
}
export function acquireBeamProfile(
  project,
  {
    detectorId,
    n = 256,
    exposure,
    seed = 1,
    backgroundFrames = 8,
    roiX = 0,
    roiY = 0,
  } = {},
) {
  if (
    ![64, 128, 256, 512].includes(n) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 2147483000 ||
    ![1, 4, 8, 16].includes(backgroundFrames)
  )
    throw Error("Invalid ROI, background averaging or noise seed.");
  const p = validateProject(project),
    camera = p.items.find(
      (c) => c.id === detectorId && c.type === "camera" && c.enabled,
    );
  if (!camera || camera.pixelsX < n || camera.pixelsY < n)
    throw Error(
      "Choose an enabled camera that contains the requested native-pixel ROI.",
    );
  if (exposure !== undefined) camera.exposure = exposure;
  validateProject(p);
  const sources = p.items.filter((c) => c.enabled && c.type === "source");
  if (
    sources.length !== 1 ||
    p.items.some(
      (c) =>
        c.enabled &&
        ![
          "source",
          "camera",
          "screen",
          "lens",
          "filter",
          "polarizer",
          "waveplate",
          "mechanical",
        ].includes(c.type),
    )
  )
    throw Error(
      "Beam profiling currently supports one Gaussian source with straight-path lenses, filters and polarization optics.",
    );
  const traced = trace(p),
    hits = traced.detectors.filter((h) => h.id === camera.id);
  if (traced.warnings.some((w) => w.level === "error"))
    throw Error(
      traced.warnings
        .filter((w) => w.level === "error")
        .map((w) => w.text)
        .join(" "),
    );
  if (hits.length !== 1)
    throw Error("Exactly one Gaussian beam must reach the selected camera.");
  const hit = hits[0];
  if (Math.abs(hit.incidence) > 5)
    throw Error("Orient the camera within 5° of normal incidence.");
  const originX = Math.floor((camera.pixelsX - n) / 2) + roiX,
    originY = Math.floor((camera.pixelsY - n) / 2) + roiY,
    pitch = camera.pixelPitch / 1000,
    width = n * pitch;
  if (
    !Number.isInteger(roiX) ||
    !Number.isInteger(roiY) ||
    originX < 0 ||
    originY < 0 ||
    originX + n > camera.pixelsX ||
    originY + n > camera.pixelsY
  )
    throw Error("ROI offsets must be integer pixels inside the camera sensor.");
  const offsetX = (originX + (n - camera.pixelsX) / 2) * pitch,
    offsetY = (originY + (n - camera.pixelsY) / 2) * pitch;
  const power = new Float64Array(n * n),
    empty = new Float64Array(n * n),
    roiCamera = { ...camera, pixelsX: n, pixelsY: n };
  // Pixel-centre Gaussian irradiance; analysis below receives camera pixels, never radius or q.
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = (x + 0.5 - n / 2) * pitch + offsetX - hit.offset,
        dy = (y + 0.5 - n / 2) * pitch + offsetY - hit.verticalOffset;
      power[y * n + x] =
        ((2 * hit.power) / (Math.PI * hit.radius ** 2)) *
        Math.exp((-2 * (dx * dx + dy * dy)) / hit.radius ** 2) *
        pitch *
        pitch;
    }
  const response = cameraResponse(power, n, width, roiCamera, hit.wavelength, {
      seed,
      noise: true,
    }),
    dark = Array(n * n).fill(0);
  for (let j = 0; j < backgroundFrames; j++) {
    const r = cameraResponse(empty, n, width, roiCamera, hit.wavelength, {
      seed: seed + j + 1,
      noise: true,
    });
    for (let i = 0; i < dark.length; i++)
      dark[i] += r.values[i] / backgroundFrames;
  }
  const frame = {
      n,
      values: Array.from(response.values),
      saturated: response.saturated,
    },
    warnings = traced.warnings.map((w) => w.text);
  let analysis = null,
    analysisError = null;
  try {
    analysis = analyzeBeamFrame(frame, dark, camera.pixelPitch);
    analysis.sensorCentroidXmm = analysis.centroidXmm + offsetX;
    analysis.sensorCentroidYmm = analysis.centroidYmm + offsetY;
  } catch (e) {
    analysisError = e.message;
  }
  for (const encounter of traced.hits.filter((h) =>
    hit.path.some((c) => c.id === h.id),
  )) {
    const c = p.items.find((c) => c.id === encounter.id);
    if (
      c.type === "lens" &&
      encounter.radius * 3 > (c.aperture || c.diameter) / 2
    ) {
      warnings.push(
        "A lens aperture may truncate the beam; this Gaussian model does not propagate aperture diffraction.",
      );
      if (analysis) analysis.valid = false;
    }
  }
  return {
    format: "optibench-beam-profile",
    version: 1,
    id: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
    project: p,
    detectorId,
    camera: { ...camera },
    settings: {
      n,
      seed,
      backgroundFrames,
      exposure: camera.exposure,
      roiX,
      roiY,
    },
    roi: {
      originX,
      originY,
      widthMm: width,
      offsetXmm: offsetX,
      offsetYmm: offsetY,
    },
    frame,
    backgroundSeeds: Array.from(
      { length: backgroundFrames },
      (_, i) => seed + i + 1,
    ),
    dark,
    analysis,
    analysisError,
    warnings,
    model:
      "Simulated native-pixel selected ROI. Circular Gaussian pixel-centre irradiance, shot/dark/read noise, full-well clipping and ADC. Averaged shutter-closed backgrounds plus measured border-offset correction; signed second moments. D4σ diameters; Gaussian fits are diagnostic. No hardware calibration or ISO compliance claim.",
  };
}
function solve3(rows) {
  const m = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const { x, y } of rows)
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) m[i][j] += x[i] * x[j];
      m[i][3] += x[i] * y;
    }
  for (let i = 0; i < 3; i++) {
    let k = i;
    for (let j = i + 1; j < 3; j++)
      if (Math.abs(m[j][i]) > Math.abs(m[k][i])) k = j;
    [m[i], m[k]] = [m[k], m[i]];
    const d = m[i][i];
    if (Math.abs(d) < 1e-10)
      throw Error("Scan positions cannot resolve a propagation fit.");
    for (let j = i; j < 4; j++) m[i][j] /= d;
    for (let k = 0; k < 3; k++)
      if (k !== i) {
        const v = m[k][i];
        for (let j = i; j < 4; j++) m[k][j] -= v * m[i][j];
      }
  }
  return m.map((r) => r[3]);
}
export function fitBeamPropagation(points, axis) {
  const valid = points.filter((p) => p.record.analysis?.valid);
  if (valid.length < 7)
    throw Error("At least seven valid, unsaturated profiles are required.");
  const positions = valid.map((p) => p.positionMm),
    lo = Math.min(...positions),
    hi = Math.max(...positions),
    mid = (lo + hi) / 2,
    scale = (hi - lo) / 2;
  if (scale <= 0) throw Error("Use distinct detector positions.");
  const rows = valid.map((p) => ({
    x: [1, (p.positionMm - mid) / scale, ((p.positionMm - mid) / scale) ** 2],
    y:
      (p.record.analysis[axis === "x" ? "diameterXmm" : "diameterYmm"] / 2) **
      2,
  }));
  const [a, b, c] = solve3(rows),
    waist2 = a - (b * b) / (4 * c),
    z0 = mid - (scale * b) / (2 * c);
  if (!(c > 0) || !(waist2 > 0))
    throw Error(
      "The measured widths do not resolve a physical waist and divergence.",
    );
  if (z0 <= lo || z0 >= hi)
    throw Error(
      "Scan must bracket the fitted waist; extend the detector travel to both sides.",
    );
  const fitted = rows.map((r) => a + b * r.x[1] + c * r.x[2]),
    rms = Math.sqrt(
      sum(rows.map((r, i) => (r.y - fitted[i]) ** 2)) / rows.length,
    ),
    variation =
      Math.max(...rows.map((r) => r.y)) - Math.min(...rows.map((r) => r.y));
  if (variation < waist2 * 0.2 || rms > variation * 0.1)
    throw Error(
      "Width variation or fit quality is insufficient to estimate divergence reliably.",
    );
  return {
    axis,
    waistRadiusMm: Math.sqrt(waist2),
    waistPositionMm: z0,
    halfAngleMrad: (Math.sqrt(c) / scale) * 1000,
    rmsRadiusSquaredMm2: rms,
    valid: valid.length,
    excluded: points.length - valid.length,
    uncertainty: propagationUncertainty(rows, [a, b, c], scale, mid),
    coefficients: [a, b, c],
    mid,
    scale,
  };
}
export function scanBeamProfile(
  project,
  settings,
  { start = -100, end = 100, count = 11 } = {},
  progress = () => {},
) {
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    end <= start ||
    Math.abs(start) > 1500 ||
    Math.abs(end) > 1500 ||
    !Number.isInteger(count) ||
    count < 7 ||
    count > 21
  )
    throw Error("Use 7–21 positions and increasing travel within ±1500 mm.");
  if (settings.n > 256)
    throw Error(
      "Use an ROI of 256 pixels or smaller for multi-position scans.",
    );
  const p = validateProject(project),
    cam = p.items.find(
      (c) => c.id === settings.detectorId && c.type === "camera",
    );
  if (!cam) throw Error("Select a camera.");
  const a = (cam.angle * Math.PI) / 180,
    dx = Math.cos(a),
    dy = Math.sin(a),
    points = [];
  let referencePath = null;
  for (let i = 0; i < count; i++) {
    const positionMm = start + ((end - start) * i) / (count - 1),
      q = structuredClone(p),
      c = q.items.find((c) => c.id === cam.id);
    c.x += dx * positionMm;
    c.y += dy * positionMm;
    if (c.x < 0 || c.y < 0 || c.x > p.table.width || c.y > p.table.height)
      throw Error("Detector travel leaves the optical table.");
    const path = trace(q)
      .detectors.find((h) => h.id === cam.id)
      ?.path.map((h) => h.id)
      .join(",");
    if (!path) throw Error("The beam misses a scan position.");
    if (referencePath !== null && path !== referencePath)
      throw Error(
        "Scan crosses an optical element. Keep all positions in one free-space segment.",
      );
    referencePath = path;
    const record = acquireBeamProfile(q, {
      ...settings,
      seed: (settings.seed ?? 1) + i * 32,
    });
    points.push({ positionMm, record });
    progress(`${i + 1}/${count} camera positions`);
  }
  const fits = {},
    errors = {};
  for (const axis of ["x", "y"]) {
    try {
      fits[axis] = fitBeamPropagation(points, axis);
    } catch (e) {
      errors[axis] = e.message;
    }
  }
  return {
    format: "optibench-beam-scan",
    version: 1,
    id: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
    project: p,
    settings,
    travel: { start, end, count },
    points,
    fits,
    errors,
    model:
      "Quadratic fit to measured D4σ radius squared versus detector travel in one free-space segment. Waist position is relative to the original camera. Divergence is the asymptotic half-angle. Invalid profiles are excluded. No certified M² measurement.",
  };
}
export const profilerStore = {
  access(value, remove = false) {
    return new Promise((resolve, reject) => {
      const r = indexedDB.open("optibench-beam-profiler", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("records", { keyPath: "id" });
      r.onerror = () => reject(r.error);
      r.onsuccess = () => {
        const db = r.result,
          tx = db.transaction("records", value ? "readwrite" : "readonly"),
          req = remove
            ? tx.objectStore("records").delete(value)
            : value
              ? tx.objectStore("records").put(value)
              : tx.objectStore("records").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  },
  save(r) {
    return this.access(r);
  },
  list() {
    return this.access();
  },
  remove(id) {
    if (typeof id !== "string" || !id)
      throw Error("Choose a saved record to delete.");
    return this.access(id, true);
  },
};
