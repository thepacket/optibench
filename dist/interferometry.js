import { advancedPolarization } from "./polarization.js";
import { trace, DEG, dot } from "./optics.js";
import { cameraResponse } from "./wave.js";

// Scalar paraxial TEM00 fields in air. Reciprocal ideal splitter: t=√T, r=i√R.
export function coherentField(project, detectorId, { n = 256, width } = {}) {
  if (project.items.some(c=>c.enabled!==false && advancedPolarization(c))) throw Error("Advanced Jones polarization is supported on straight paths only. Interferometry with waveplates, elliptical sources or nonideal polarizers is not yet supported.");
  const detector = project.items.find((c) => c.id === detectorId);
  if (!detector) throw Error("Choose a detector.");
  const traced = trace(project),
    paths = traced.detectors.filter((h) => h.id === detectorId);
  if (!paths.length) throw Error("No optical path reaches this detector.");
  if (paths.length > 2)
    throw Error(
      "This metrology mode supports up to two incident paths. Remove extra reflections.",
    );
  const source = project.items.find((c) => c.id === paths[0].source);
  if (paths.some((h) => h.source !== source.id))
    throw Error(
      "Use two paths from the same source; independent lasers are not phase locked.",
    );
  if (source.type !== "source" || source.m2 !== 1)
    throw Error("Interferometry requires a TEM00 laser source with M² = 1.");
  const allowed = [
    "mirror",
    "splitter",
    "filter",
    "polarizer",
    "camera",
    "screen",
    "power",
  ];
  for (const h of paths)
    for (const p of h.path) {
      const c = project.items.find((c) => c.id === p.id);
      if (
        (source.pitch || 0) !== 0 ||
        (c.pitch || 0) !== 0 ||
        Math.abs(
          (c.z ?? project.table.heightAbove ?? 100) -
            (source.z ?? project.table.heightAbove ?? 100),
        ) > 1e-6
      )
        throw Error(
          "Folded coherent fields require a common beam height and zero elevation tilt. Use Alignment for the paraxial elevation trace.",
        );
      if (!allowed.includes(c.type))
        throw Error(
          "Coherent folded paths currently support plane mirrors, ideal splitters, ND filters and linear polarizers. Remove lenses or apertures from this path.",
        );
      if (
        ["mirror", "splitter"].includes(c.type) &&
        c.diameter * Math.cos(p.incidence * DEG) < p.radius * 4
      )
        throw Error(
          "A beam approaches a mirror or splitter aperture. Clipped-field diffraction is outside this model.",
        );
    }
  if (paths.some((h) => h.incidence > 5))
    throw Error(
      "Align the detector within 5° of the incident beams for paraxial fringe measurement.",
    );
  width ??=
    detector.type === "camera"
      ? (Math.max(detector.pixelsX, detector.pixelsY) * detector.pixelPitch) /
        1000
      : 8;
  const dx = width / n,
    normal = {
      x: Math.cos(detector.angle * DEG),
      y: Math.sin(detector.angle * DEG),
    },
    tangent = { x: -normal.y, y: normal.x };
  const k = (2 * Math.PI) / (source.wavelength * 1e-6);
  const opd =
    paths.length === 2 ? paths[1].opticalPath - paths[0].opticalPath : null;
  const coherence =
    opd === null
      ? 0
      : Math.exp(-((opd / (source.coherenceLength ?? 1000)) ** 2));
  const polarization =
    paths.length === 2
      ? Math.cos((paths[1].polarization - paths[0].polarization) * DEG)
      : 0;
  // Relative phase avoids multiplying a long common path by optical frequency.
  const relativePhase = paths.map(
    (h) =>
      k * (h.opticalPath - paths[0].opticalPath) + h.phase - paths[0].phase,
  );
  const at = (x, y, extra = 0) => {
    const fields = paths.map((h, j) => {
      const u = x - h.offset,
        transverse = u * dot(h.direction, normal),
        r2 = transverse * transverse + y * y;
      const intensity =
        ((2 * h.power) / (Math.PI * h.radius ** 2)) *
        Math.exp((-2 * r2) / h.radius ** 2) *
        Math.abs(dot(h.direction, normal));
      const curvature = h.q.re / (h.q.re * h.q.re + h.q.im * h.q.im);
      return {
        intensity,
        phase:
          relativePhase[j] +
          k * (u * dot(h.direction, tangent) + (r2 * curvature) / 2) +
          (j === 1 ? extra : 0),
      };
    });
    const baseline = fields.reduce((s, f) => s + f.intensity, 0);
    return {
      baseline,
      intensity: Math.max(
        0,
        baseline +
          (fields.length === 2
            ? 2 *
              Math.sqrt(fields[0].intensity * fields[1].intensity) *
              coherence *
              polarization *
              Math.cos(fields[1].phase - fields[0].phase)
            : 0),
      ),
    };
  };
  const values = new Float64Array(n * n),
    baseline = new Float64Array(n * n);
  let power = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = at((x + 0.5 - n / 2) * dx, (y + 0.5 - n / 2) * dx),
        i = y * n + x;
      values[i] = v.intensity * dx * dx;
      baseline[i] = v.baseline * dx * dx;
      power += values[i];
    }
  const slopes = paths.map(
    (h) =>
      dot(h.direction, tangent) -
      (h.offset * dot(h.direction, normal) ** 2 * h.q.re) /
        (h.q.re * h.q.re + h.q.im * h.q.im),
  );
  const carrier =
    paths.length === 2
      ? Math.abs(slopes[1] - slopes[0]) / (source.wavelength * 1e-6)
      : 0;
  return {
    values,
    baseline,
    n,
    width,
    dx,
    power,
    paths,
    opd,
    coherence,
    polarization,
    carrier,
    wavelength: source.wavelength,
    at,
    detector,
  };
}

// Least squares on an envelope-normalized central row. Frequency is searched from
// sampled data, never supplied from the optical prediction. Phase is at sensor x=0.
function regression(samples, f) {
  const a = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const { x, y } of samples) {
    const v = [1, Math.cos(2 * Math.PI * f * x), Math.sin(2 * Math.PI * f * x)];
    for (let j = 0; j < 3; j++) {
      for (let k = 0; k < 3; k++) a[j][k] += v[j] * v[k];
      a[j][3] += v[j] * y;
    }
  }
  for (let j = 0; j < 3; j++) {
    let p = j;
    for (let i = j + 1; i < 3; i++)
      if (Math.abs(a[i][j]) > Math.abs(a[p][j])) p = i;
    [a[p], a[j]] = [a[j], a[p]];
    if (Math.abs(a[j][j]) < 1e-10) return null;
    const d = a[j][j];
    for (let k = j; k < 4; k++) a[j][k] /= d;
    for (let i = 0; i < 3; i++)
      if (i !== j) {
        const m = a[i][j];
        for (let k = j; k < 4; k++) a[i][k] -= m * a[j][k];
      }
  }
  const b = a.map((r) => r[3]);
  const mse =
    samples.reduce(
      (s, p) =>
        s +
        (p.y -
          b[0] -
          b[1] * Math.cos(2 * Math.PI * f * p.x) -
          b[2] * Math.sin(2 * Math.PI * f * p.x)) **
          2,
      0,
    ) / samples.length;
  return {
    frequency: f,
    period: 1 / f,
    visibility: Math.hypot(b[1], b[2]) / b[0],
    phase: Math.atan2(-b[2], b[1]),
    mse,
    coefficients: b,
  };
}
export function measureFringes(field, { noise = false } = {}) {
  const { detector: det, n, width, wavelength } = field;
  let values = field.values,
    reference = field.baseline,
    sensorWidth = width,
    saturated = 0;
  if (det.type === "camera") {
    const response = cameraResponse(values, n, width, det, wavelength, {
      noise,
    });
    values = response.values;
    sensorWidth = response.sensorWidth;
    saturated = Math.max(
      response.saturated,
      Array.from(values).filter((v) => v >= 1).length / values.length,
    );
    reference = cameraResponse(
      reference,
      n,
      width,
      { ...det, fullWell: det.fullWell * 100, gain: 1, bits: 30 },
      wavelength,
      { noise: false },
    ).values;
    // Restore the linear reference to the ADC response's scale; subtract known dark offset.
    reference = Float64Array.from(reference, (v) => v * 100 * det.gain);
  }
  const start = Math.floor(n / 2) * n,
    peak = Math.max(...reference.slice(start, start + n));
  const dark =
    det.type === "camera"
      ? ((det.darkCurrent * det.exposure) / 1000 / det.fullWell) * det.gain
      : 0;
  const samples = [];
  for (let i = 0; i < n; i++)
    if (reference[start + i] > peak * 0.12 && reference[start + i] > dark * 5) {
      samples.push({
        x: ((i + 0.5) / n - 0.5) * sensorWidth,
        y: (values[start + i] - dark) / (reference[start + i] - dark),
      });
    }
  let fit = null,
    reason = "";
  if (samples.length < 16 || peak <= 0)
    reason = "Insufficient illuminated samples.";
  else {
    const span = samples.at(-1).x - samples[0].x,
      min = 1.5 / span,
      max = n / sensorWidth / 4,
      step = 1 / (span * 10);
    for (let f = min; f <= max; f += step) {
      const candidate = regression(samples, f);
      if (candidate && (!fit || candidate.mse < fit.mse)) fit = candidate;
    }
    if (fit)
      for (let step2 = step / 10; step2 > step / 10000; step2 /= 10) {
        const center = fit.frequency;
        for (let j = -10; j <= 10; j++) {
          const f = center + j * step2;
          if (f < min || f > max) continue;
          const candidate = regression(samples, f);
          if (candidate && candidate.mse < fit.mse) fit = candidate;
        }
      }
    if (!fit) reason = "No resolvable spatial carrier.";
    else if (fit.visibility < 0.05) reason = "Fringe contrast below 5%.";
    else if (Math.sqrt(fit.mse) > 0.15)
      reason = "Poor sinusoidal fit; check curvature, sampling or noise.";
    else if (fit.frequency * span < 1.6)
      reason = "Fewer than 1.6 resolved fringes. Tilt an arm mirror slightly.";
    if (saturated > 0)
      reason =
        "Sensor clipping invalidates fringe metrology. Reduce power or exposure.";
    if (field.carrier > max)
      reason =
        "Carrier exceeds the four-samples-per-fringe preview limit. Reduce mirror tilt.";
    if (field.paths.length < 2) reason = "Only one path reaches this detector.";
  }
  return {
    values,
    n,
    width: sensorWidth,
    samples,
    fit: reason ? null : fit,
    reason,
    saturated,
    noise,
  };
}

export function phaseScan(
  project,
  detectorId,
  mirrorId,
  { noise = false } = {},
) {
  const mirror = project.items.find(
    (c) => c.id === mirrorId && c.type === "mirror",
  );
  if (!mirror) throw Error("Choose an arm mirror to scan.");
  const field = coherentField(project, detectorId, { n: 16 });
  if (field.paths.length !== 2) throw Error("A phase scan requires two paths.");
  const visits = field.paths.map(
    (h) => h.path.filter((p) => p.id === mirrorId).length,
  );
  if (visits[0] === visits[1]) throw Error("Choose a mirror in only one arm.");
  const rows = [];
  for (let i = 0; i <= 64; i++) {
    const piston = (mirror.pistonNm || 0) + (field.wavelength * i) / 32;
    const p = {
      ...project,
      items: project.items.map((c) =>
        c.id === mirrorId ? { ...c, pistonNm: piston } : c,
      ),
    };
    const f = coherentField(p, detectorId, { n: 1, width: field.width });
    const irradiance = f.at(0, 0).intensity;
    const signal =
      field.detector.type === "camera"
        ? cameraResponse(
            new Float64Array([irradiance * field.width ** 2]),
            1,
            field.width,
            field.detector,
            field.wavelength,
            { noise, seed: 42 + i },
          ).values[0]
        : irradiance;
    rows.push({ piston, irradiance, signal });
  }
  return rows;
}
