import { clamp, seededRandom, normalRandom } from "./optics.js";
export function fft(re, im, inverse = false) {
  const n = re.length;
  if (n < 2 || n & (n - 1)) throw Error("FFT length must be a power of two");
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inverse ? 2 : -2) * Math.PI) / len,
      wr0 = Math.cos(ang),
      wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1,
        wi = 0;
      for (let j = 0; j < len / 2; j++) {
        let u = i + j,
          v = u + len / 2,
          vr = re[v] * wr - im[v] * wi,
          vi = re[v] * wi + im[v] * wr;
        re[v] = re[u] - vr;
        im[v] = im[u] - vi;
        re[u] += vr;
        im[u] += vi;
        const nw = wr * wr0 - wi * wi0;
        wi = wr * wi0 + wi * wr0;
        wr = nw;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
export function fft2(re, im, n, inverse = false) {
  const rr = new Float64Array(n),
    ii = new Float64Array(n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      rr[x] = re[y * n + x];
      ii[x] = im[y * n + x];
    }
    fft(rr, ii, inverse);
    for (let x = 0; x < n; x++) {
      re[y * n + x] = rr[x];
      im[y * n + x] = ii[x];
    }
  }
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      rr[y] = re[y * n + x];
      ii[y] = im[y * n + x];
    }
    fft(rr, ii, inverse);
    for (let y = 0; y < n; y++) {
      re[y * n + x] = rr[y];
      im[y * n + x] = ii[y];
    }
  }
}
export function propagateField(re, im, n, width, lambda, d) {
  if (Math.abs(d) < 1e-12) return;
  fft2(re, im, n);
  const k = (2 * Math.PI) / lambda;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const fx = (x <= n / 2 ? x : x - n) / width,
        fy = (y <= n / 2 ? y : y - n) / width,
        u = lambda * lambda * (fx * fx + fy * fy),
        i = y * n + x;
      if (u >= 1) {
        re[i] = 0;
        im[i] = 0;
        continue;
      }
      const phase = (-k * d * u) / (1 + Math.sqrt(1 - u)),
        a = Math.cos(phase),
        b = Math.sin(phase),
        r = re[i];
      re[i] = r * a - im[i] * b;
      im[i] = r * b + im[i] * a;
    }
  fft2(re, im, n, true);
}
export function intensity(re, im) {
  return Float64Array.from(re, (v, i) => v * v + im[i] * im[i]);
}
export function sum(a) {
  return a.reduce((s, v) => s + v, 0);
}
export function rmsRadius(values, n, width) {
  let total = 0,
    mx = 0,
    my = 0;
  const dx = width / n;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = values[y * n + x];
      total += v;
      mx += v * (x - n / 2) * dx;
      my += v * (y - n / 2) * dx;
    }
  if (!total) return { x: 0, y: 0, wx: 0, wy: 0 };
  mx /= total;
  my /= total;
  let vx = 0,
    vy = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      let v = values[y * n + x];
      vx += v * ((x - n / 2) * dx - mx) ** 2;
      vy += v * ((y - n / 2) * dx - my) ** 2;
    }
  return {
    x: mx,
    y: my,
    wx: 2 * Math.sqrt(vx / total),
    wy: 2 * Math.sqrt(vy / total),
  };
}
export function solveWave(
  project,
  { n = 256, width = 6, detectorId, imageData = null } = {},
) {
  if (
    ![128, 256, 512, 1024].includes(n) ||
    !Number.isFinite(width) ||
    width < 0.1 ||
    width > 100
  )
    throw Error("Use 128, 256, 512 or 1024 samples and a 0.1–100 mm field.");
  const srcs = project.items.filter(
    (c) => c.enabled !== false && ["source", "image"].includes(c.type),
  );
  if (srcs.length !== 1)
    throw Error("Fourier propagation requires exactly one coherent source.");
  const src = srcs[0];
  if (
    project.items.some(
      (c) =>
        c.enabled !== false &&
        c.type !== "mechanical" &&
        ((c.pitch || 0) !== 0 ||
          Math.abs(
            (c.z ?? project.table.heightAbove ?? 100) -
              (src.z ?? project.table.heightAbove ?? 100),
          ) > 1e-6),
    )
  )
    throw Error(
      "Fourier propagation requires a common beam height and zero elevation tilt. Use Alignment to inspect vertical offsets.",
    );
  if (src.type === "image" && src.pattern === "image" && !imageData)
    throw Error(
      "Upload a source image before selecting the uploaded-image field.",
    );
  if (src.m2 !== 1)
    throw Error(
      "Fourier propagation requires M² = 1. Use Gaussian mode for M² > 1.",
    );
  const detector = project.items.find(
    (c) => c.id === detectorId && c.enabled !== false,
  );
  if (!detector) throw Error("Select an enabled detector.");
  const a = (src.angle * Math.PI) / 180,
    normal = { x: Math.cos(a), y: Math.sin(a) },
    tangent = { x: -normal.y, y: normal.x };
  const projectZ = (c) => (c.x - src.x) * normal.x + (c.y - src.y) * normal.y;
  const zEnd = projectZ(detector);
  if (zEnd <= 0) throw Error("The detector must be forward of the source.");
  const lateral = (c) => (c.x - src.x) * tangent.x + (c.y - src.y) * tangent.y;
  const elements = project.items
    .filter(
      (c) =>
        c.enabled !== false &&
        !["source", "image", "mechanical"].includes(c.type) &&
        projectZ(c) > 0 &&
        projectZ(c) <= zEnd + 0.001 &&
        Math.abs(lateral(c)) < width / 2 + (c.diameter || 25) / 2,
    )
    .sort((a, b) => projectZ(a) - projectZ(b));
  if (elements.some((c) => ["mirror", "splitter"].includes(c.type)))
    throw Error(
      "Fourier propagation supports a straight common axis. Use Gaussian or ray mode for folded and split paths.",
    );
  if (
    elements.some(
      (c) =>
        Math.abs(Math.sin(((c.angle - src.angle) * Math.PI) / 180)) > 0.001,
    )
  )
    throw Error(
      "Align optical planes to the source axis before Fourier propagation.",
    );
  const re = new Float64Array(n * n),
    im = new Float64Array(n * n),
    dx = width / n,
    lambda = src.wavelength * 1e-6,
    k = (2 * Math.PI) / lambda,
    warnings = [];
  let pol = src.polarization || 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const xx = (x - n / 2) * dx,
        yy = (y - n / 2) * dx,
        r2 = xx * xx + yy * yy;
      let value = Math.exp(-r2 / (src.waist * src.waist));
      if (src.type === "image") {
        if (imageData && imageData.length === n * n)
          value = Math.sqrt(imageData[y * n + x]);
        else if (src.pattern === "double-slit")
          value =
            Math.abs(yy) < 0.8 &&
            (Math.abs(xx - 0.15) < 0.025 || Math.abs(xx + 0.15) < 0.025)
              ? 1
              : 0;
        else if (src.pattern === "pinhole") value = r2 < 0.1 ** 2 ? 1 : 0;
        else
          value =
            Math.abs(xx) < 1 &&
            Math.abs(yy) < 1 &&
            Math.floor((xx + 1) * 12) % 2 === 0
              ? 1
              : 0;
      }
      re[y * n + x] = value;
    }
  let initial = sum(intensity(re, im));
  if (initial <= 0)
    throw Error(
      "Source field is empty at this sampling. Increase grid resolution or source size.",
    );
  const factor = Math.sqrt(src.power / initial);
  for (let i = 0; i < re.length; i++) re[i] *= factor;
  let z = 0;
  for (const c of elements) {
    const nextZ = projectZ(c);
    propagateField(re, im, n, width, lambda, nextZ - z);
    z = nextZ;
    if (c.id === detectorId) break;
    if (
      ["camera", "power", "stop"].includes(c.type) ||
      (c.type === "screen" && c.terminate !== false)
    ) {
      re.fill(0);
      im.fill(0);
      warnings.push("An upstream detector or beam dump terminates the field.");
      break;
    }
    const offset = lateral(c);
    let maxOccupiedRadius = 0;
    const pre = intensity(re, im);
    let max = 0;
    for (const value of pre) max = Math.max(max, value); // sampling report computed on occupied support below
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const xx = (x - n / 2) * dx - offset,
          yy = (y - n / 2) * dx,
          r2 = xx * xx + yy * yy,
          i = y * n + x;
        let amp = 1,
          phase = 0;
        if (c.type === "lens") {
          if (pre[i] > max * 0.001)
            maxOccupiedRadius = Math.max(maxOccupiedRadius, Math.sqrt(r2));
          phase = (-k * r2) / (2 * c.f);
          if (r2 > ((c.aperture || c.diameter) / 2) ** 2) amp = 0;
          else amp = Math.sqrt(c.transmission ?? 1);
        }
        if (c.type === "aperture" && r2 > (c.aperture / 2) ** 2) amp = 0;
        if (c.type === "slit" && Math.abs(xx) > c.aperture / 2) amp = 0;
        if (c.type === "filter") amp = Math.sqrt(c.transmission);
        if (c.type === "polarizer")
          amp = Math.cos(((pol - c.axis) * Math.PI) / 180);
        let cr = Math.cos(phase) * amp,
          ci = Math.sin(phase) * amp,
          r = re[i];
        re[i] = r * cr - im[i] * ci;
        im[i] = r * ci + im[i] * cr;
      }
    if (c.type === "polarizer") pol = c.axis;
    if (
      c.type === "lens" &&
      (maxOccupiedRadius * dx) / (lambda * Math.abs(c.f)) > 0.5
    )
      warnings.push(
        `${c.label}: lens phase is undersampled on occupied support. Increase samples or reduce field width.`,
      );
  }
  if (z < zEnd) propagateField(re, im, n, width, lambda, zEnd - z);
  const values = intensity(re, im),
    power = sum(values);
  let edge = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      if (x < n * 0.05 || x > n * 0.95 || y < n * 0.05 || y > n * 0.95)
        edge += values[y * n + x];
  if (power && edge / power > 0.005)
    warnings.push(
      "More than 0.5% of field energy reaches the FFT border. Increase field width; periodic wraparound may affect results.",
    );
  if (src.waist < dx * 4)
    warnings.push(
      "Source waist has fewer than four samples. Increase resolution.",
    );
  return {
    values,
    n,
    width,
    power,
    sourcePower: src.power,
    moments: rmsRadius(values, n, width),
    warnings: [...new Set(warnings)],
    lambda: src.wavelength,
    offset: lateral(detector),
    dx,
    detectorId,
  };
}
export function poisson(mean, rng) {
  if (mean <= 0) return 0;
  if (mean > 30)
    return Math.max(0, Math.round(mean + Math.sqrt(mean) * normalRandom(rng)));
  const limit = Math.exp(-mean);
  let k = 0,
    p = 1;
  do {
    k++;
    p *= rng();
  } while (p > limit);
  return k - 1;
}
export function cameraResponse(
  values,
  n,
  width,
  camera,
  wavelength,
  { seed = 42, noise = true, offset = 0 } = {},
) {
  const rng = seededRandom(seed),
    output = new Float64Array(n * n),
    pixelMm = camera.pixelPitch / 1000,
    dx = width / n,
    t = camera.exposure / 1000,
    photon = (6.62607015e-34 * 299792458) / (wavelength * 1e-9);
  let saturated = 0,
    peakElectrons = 0;
  const sensorWidth = camera.pixelsX * pixelMm,
    sensorHeight = camera.pixelsY * pixelMm;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const sx = ((x + 0.5) / n - 0.5) * sensorWidth + offset,
        sy = ((y + 0.5) / n - 0.5) * sensorHeight,
        ix = Math.floor(sx / dx + n / 2),
        iy = Math.floor(sy / dx + n / 2),
        intensityMw =
          ix >= 0 && ix < n && iy >= 0 && iy < n
            ? values[iy * n + ix] / (dx * dx)
            : 0;
      let signal =
        ((intensityMw * 0.001 * pixelMm * pixelMm * t) / photon) * camera.qe;
      peakElectrons = Math.max(peakElectrons, signal);
      let electrons = noise
        ? poisson(signal + camera.darkCurrent * t, rng) +
          normalRandom(rng) * camera.readNoise
        : signal + camera.darkCurrent * t;
      if (electrons >= camera.fullWell) saturated++;
      const aduMax = 2 ** camera.bits - 1;
      output[y * n + x] =
        Math.round(
          clamp(clamp(electrons / camera.fullWell, 0, 1) * camera.gain, 0, 1) *
            aduMax,
        ) / aduMax;
    }
  return {
    values: output,
    saturated: saturated / (n * n),
    peakElectrons,
    sensorWidth,
    sensorHeight,
    noise,
    seed,
  };
}
