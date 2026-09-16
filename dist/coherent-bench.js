import { makeProject } from "./project.js";
import { catalog, instantiate } from "./catalog.js";
import { analyzeMeasurement, defaultMeasurementSettings } from "./metrology.js";
import { serializable } from "./run-store.js";
import { validateProject } from "./project.js";
import { intersect, direction, reflection, dot, DEG } from "./optics.js";
import { sourceJones, polarizationElement } from "./polarization.js";
import { propagateField, cameraResponse } from "./wave.js";
const allowed = [
  "mirror",
  "splitter",
  "lens",
  "aperture",
  "slit",
  "filter",
  "polarizer",
  "waveplate",
  "camera",
  "screen",
  "power",
  "stop",
];
const powerOf = (r, i) => r.reduce((s, v, j) => s + v * v + i[j] * i[j], 0);
function bounded(v, a, b, label) {
  if (!Number.isFinite(v) || v < a || v > b)
    throw Error(`${label} must be ${a}–${b}.`);
}
export function discoverCoherentPaths(input, detectorId) {
  const project = validateProject(input),
    items = project.items.filter((c) => c.enabled !== false),
    sources = items.filter((c) => ["source", "image"].includes(c.type));
  if (
    sources.length !== 1 ||
    sources[0].type !== "source" ||
    sources[0].m2 !== 1
  )
    throw Error("Use exactly one TEM00 laser source.");
  const source = sources[0],
    detector = items.find(
      (c) =>
        c.id === detectorId && ["camera", "screen", "power"].includes(c.type),
    );
  if (!detector) throw Error("Select an enabled detector.");
  const optics = items.filter(
    (c) => !["source", "image", "mechanical"].includes(c.type),
  );
  if (
    items.some(
      (c) =>
        c.type !== "mechanical" &&
        ((c.pitch || 0) !== 0 ||
          Math.abs(
            (c.z ?? project.table.heightAbove ?? 100) -
              (source.z ?? project.table.heightAbove ?? 100),
          ) > 1e-6),
    )
  )
    throw Error(
      "Coherent bench propagation requires coplanar optics at one beam height.",
    );
  const queue = [
      {
        p: { x: source.x, y: source.y },
        d: direction(source.angle * DEG),
        last: source.id,
        steps: [],
        length: 0,
        seen: [],
      },
    ],
    paths = [];
  let explored = 0,
    escaped = 0;
  while (queue.length) {
    if (++explored > 128)
      throw Error(
        "Coherent path discovery exceeds 128 branches. Simplify the bench.",
      );
    const b = queue.shift();
    if (b.steps.length >= 24)
      throw Error(
        "Coherent path exceeds 24 encounters; cavities are not supported.",
      );
    let next = null,
      c = null;
    for (const o of optics) {
      if (o.id === b.last) continue;
      const h = intersect(b.p, b.d, o);
      if (h && (!next || h.len < next.len)) {
        next = h;
        c = o;
      }
    }
    if (!next) {
      escaped++;
      continue;
    }
    if (!allowed.includes(c.type))
      throw Error(`${c.label}: unsupported coherent optical element.`);
    const key = `${c.id}:${b.d.x.toFixed(6)}:${b.d.y.toFixed(6)}`;
    if (b.seen.includes(key))
      throw Error(
        "A recurrent optical path was found. Resonant cavities require a round-trip solver and are not supported here.",
      );
    if (
      next.hit.x < 0 ||
      next.hit.x > project.table.width ||
      next.hit.y < 0 ||
      next.hit.y > project.table.height
    ) {
      escaped++;
      continue;
    }
    if (
      c.type === "lens" &&
      (next.incidence > 0.001 || Math.abs(next.offset) > 1e-5)
    )
      throw Error(
        `${c.label}: numerical thin lenses must be centered and normal to the incident chief ray.`,
      );
    if (
      ["aperture", "slit", "filter", "polarizer", "waveplate"].includes(
        c.type,
      ) &&
      next.incidence > 0.1
    )
      throw Error(
        `${c.label}: transmissive field planes require incidence within 0.1°.`,
      );
    if (c.type === "lens")
      bounded(Math.abs(c.f), 1, 100000, "Absolute focal length · mm");
    const step = {
        id: c.id,
        type: c.type,
        distance: next.len,
        offset: next.offset,
        incidence: next.incidence,
        incoming: b.d,
        position: next.hit,
        event: "T",
      },
      length = b.length + next.len;
    if (["camera", "screen", "power"].includes(c.type)) {
      if (c.id === detectorId) {
        if (next.incidence > 1)
          throw Error("Coherent detector incidence must be within 1°.");
        paths.push({
          steps: [...b.steps, { ...step, event: "D" }],
          length,
          direction: b.d,
          offset: next.offset,
          incidence: next.incidence,
        });
        if (paths.length > 16)
          throw Error("At most sixteen coherent paths can reach a detector.");
      }
      if (c.type !== "screen" || c.terminate !== false || c.id === detectorId)
        continue;
    }
    if (c.type === "stop") continue;
    const outgoing = (event, d) => ({
      p: next.hit,
      d,
      last: c.id,
      steps: [...b.steps, { ...step, event }],
      length,
      seen: [...b.seen, key],
    });
    if (c.type === "mirror") {
      if (c.reflectivity > 0)
        queue.push(outgoing("R", reflection(b.d, next.n)));
    } else if (c.type === "splitter") {
      bounded(c.reflectivity, 0, 1, "Splitter reflection");
      bounded(c.transmission, 0, 1, "Splitter transmission");
      if (c.reflectivity + c.transmission > 1 + 1e-12)
        throw Error("Splitter R + T must not exceed one.");
      if (c.reflectivity > 0)
        queue.push(outgoing("R", reflection(b.d, next.n)));
      if (c.transmission > 0) queue.push(outgoing("T", b.d));
    } else queue.push(outgoing("T", b.d));
  }
  if (!paths.length)
    throw Error(
      "No discovered chief-ray path reaches this detector. Diffracted tails do not create new paths.",
    );
  if (paths.reduce((s, p) => s + p.steps.length, 0) > 96)
    throw Error("Coherent run exceeds 96 path-plane propagations.");
  return { project, source, detector, paths, escaped };
}
function sample(re, im, n, width, x, y) {
  const dx = width / n,
    u = x / dx + n / 2 - 0.5,
    v = y / dx + n / 2 - 0.5,
    ix = Math.floor(u),
    iy = Math.floor(v),
    fx = u - ix,
    fy = v - iy;
  let a = 0,
    b = 0;
  for (let dy = 0; dy < 2; dy++)
    for (let dx = 0; dx < 2; dx++) {
      const xx = ix + dx,
        yy = iy + dy;
      if (xx < 0 || xx >= n || yy < 0 || yy >= n) continue;
      const w = (dx ? fx : 1 - fx) * (dy ? fy : 1 - fy),
        j = yy * n + xx;
      a += w * re[j];
      b += w * im[j];
    }
  return [a, b];
}
function edgeFraction(re, im, n) {
  let edge = 0,
    total = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const j = y * n + x,
        p = re[j] ** 2 + im[j] ** 2;
      total += p;
      if (x < 3 || y < 3 || x >= n - 3 || y >= n - 3) edge += p;
    }
  return total ? edge / total : 0;
}
export function propagateCoherentBench(
  input,
  settings = {},
  { onProgress = () => {} } = {},
) {
  const { n = 128, width = 8, detectorId } = settings;
  if (![128, 256].includes(n)) throw Error("Use 128 or 256 field samples.");
  bounded(width, 0.1, 40, "Field width · mm");
  const model = discoverCoherentPaths(input, detectorId),
    { project, source, detector, paths } = model,
    dx = width / n,
    lambda = source.wavelength * 1e-6,
    k = (2 * Math.PI) / lambda,
    warnings = new Set(),
    branches = [];
  if (source.waist / dx < 4)
    throw Error(
      "The laser waist needs at least four field samples. Reduce width or increase grid.",
    );
  let maximumEdge = 0,
    maxLensStep = 0;
  for (let b = 0; b < paths.length; b++) {
    const path = paths[b],
      re = new Float64Array(n * n),
      im = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        re[y * n + x] =
          Math.sqrt((2 * source.power) / (Math.PI * source.waist ** 2)) *
          dx *
          Math.exp(
            -(((x + 0.5 - n / 2) * dx) ** 2 + ((y + 0.5 - n / 2) * dx) ** 2) /
              source.waist ** 2,
          );
    const launched = powerOf(re, im);
    if (Math.abs(launched / source.power - 1) > 0.001)
      warnings.add(
        "The source field is truncated by the computational window; enlarge width and repeat.",
      );
    let jones = sourceJones(source),
      piston = 0,
      phase = 0;
    const planes = [];
    for (const step of path.steps) {
      const c = project.items.find((c) => c.id === step.id);
      propagateField(re, im, n, width, lambda, step.distance);
      maximumEdge = Math.max(maximumEdge, edgeFraction(re, im, n));
      const before = powerOf(re, im);
      if (step.event === "D") {
        planes.push({ id: c.id, before, after: before });
        break;
      }
      let amp = 1;
      if (c.type === "mirror") {
        amp = Math.sqrt(c.reflectivity);
        phase += Math.PI;
        piston += 2 * (c.pistonNm || 0) * 1e-6 * Math.cos(step.incidence * DEG);
      }
      if (c.type === "splitter") {
        amp = Math.sqrt(step.event === "R" ? c.reflectivity : c.transmission);
        if (step.event === "R") phase += Math.PI / 2;
      }
      if (["lens", "filter"].includes(c.type))
        amp = Math.sqrt(c.transmission ?? 1);
      if (["polarizer", "waveplate"].includes(c.type)) {
        const pol = polarizationElement(jones, c);
        amp = Math.sqrt(pol.power);
        jones = pol.jones;
      }
      const cos = Math.cos(step.incidence * DEG),
        normal = direction(c.angle * DEG),
        t = { x: -normal.y, y: normal.x },
        incomingT = { x: -step.incoming.y, y: step.incoming.x },
        sign = dot(t, incomingT) >= 0 ? 1 : -1,
        aperture =
          c.type === "aperture" || c.type === "slit"
            ? c.aperture
            : c.type === "lens"
              ? c.aperture || c.diameter
              : c.diameter;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const xx = (x + 0.5 - n / 2) * dx,
            yy = (y + 0.5 - n / 2) * dx,
            j = y * n + x,
            u = step.offset + (sign * xx) / Math.max(cos, 1e-8);
          const open =
            c.type === "slit"
              ? Math.abs(u) <= aperture / 2
              : !aperture || u * u + yy * yy <= (aperture / 2) ** 2;
          let a = open ? amp : 0,
            ph = 0;
          if (c.type === "lens") {
            ph = (-k * (xx * xx + yy * yy)) / (2 * c.f);
            if (re[j] ** 2 + im[j] ** 2 > (source.power / (n * n)) * 1e-6)
              maxLensStep = Math.max(
                maxLensStep,
                (k * Math.abs(xx) * dx) / Math.abs(c.f),
              );
          }
          const rr = re[j],
            ii = im[j];
          re[j] = a * (rr * Math.cos(ph) - ii * Math.sin(ph));
          im[j] = a * (rr * Math.sin(ph) + ii * Math.cos(ph));
        }
      if (step.event === "R") {
        for (let y = 0; y < n; y++)
          for (let x = 0; x < n / 2; x++) {
            const a = y * n + x,
              b = y * n + n - 1 - x;
            [re[a], re[b]] = [re[b], re[a]];
            [im[a], im[b]] = [im[b], im[a]];
          }
        jones = [-jones[0], -jones[1], jones[2], jones[3]];
      }
      planes.push({
        id: c.id,
        event: step.event,
        before,
        after: powerOf(re, im),
      });
    }
    branches.push({
      re,
      im,
      jones,
      path,
      opl: path.length + piston,
      phase,
      planes,
      power: powerOf(re, im),
    });
    onProgress({ completed: b + 1, total: paths.length });
  }
  if (maximumEdge > 0.001)
    warnings.add(
      "Field power reaches a periodic FFT boundary (>0.1%). Increase width and grid; the result may contain wraparound.",
    );
  if (maxLensStep > Math.PI / 2)
    warnings.add(
      "Lens phase varies by more than π/2 per occupied sample. Increase grid or use weaker focusing.",
    );
  const normal = direction(detector.angle * DEG),
    tangent = { x: -normal.y, y: normal.x };
  const carrier =
    Math.max(...paths.map((p) => dot(p.direction, tangent))) -
    Math.min(...paths.map((p) => dot(p.direction, tangent)));
  if ((carrier * dx) / lambda > 0.25)
    throw Error(
      "Interference carrier has fewer than four samples per fringe. Increase grid or reduce mirror tilt.",
    );
  const coherence = branches.map((a) =>
    branches.map((b) =>
      Math.exp(-(((a.opl - b.opl) / (source.coherenceLength ?? 1000)) ** 2)),
    ),
  );
  const values = new Float64Array(n * n),
    baseline = new Float64Array(n * n);
  let power = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = (x + 0.5 - n / 2) * dx,
        v = (y + 0.5 - n / 2) * dx,
        j = y * n + x,
        fields = branches.map((b) => {
          const c = dot(b.path.direction, normal),
            [rr, ii] = sample(b.re, b.im, n, width, (u - b.path.offset) * c, v),
            ph =
              k * (b.opl - branches[0].opl) +
              b.phase +
              k * (u - b.path.offset) * dot(b.path.direction, tangent),
            a = Math.sqrt(Math.abs(c)),
            r = a * (rr * Math.cos(ph) - ii * Math.sin(ph)),
            q = a * (rr * Math.sin(ph) + ii * Math.cos(ph)),
            pol = [
              Math.sign(c) * b.jones[0],
              Math.sign(c) * b.jones[1],
              b.jones[2],
              b.jones[3],
            ];
          return [
            r * pol[0] - q * pol[1],
            r * pol[1] + q * pol[0],
            r * pol[2] - q * pol[3],
            r * pol[3] + q * pol[2],
          ];
        });
      let I = 0,
        base = 0;
      for (let a = 0; a < fields.length; a++) {
        base += fields[a].reduce((s, v) => s + v * v, 0);
        for (let b = 0; b < a; b++)
          I +=
            2 *
            coherence[a][b] *
            fields[a].reduce((s, v, k) => s + v * fields[b][k], 0);
      }
      const inside =
        detector.type === "camera"
          ? Math.abs(u) <= (detector.pixelsX * detector.pixelPitch) / 2000 &&
            Math.abs(v) <= (detector.pixelsY * detector.pixelPitch) / 2000
          : u * u + v * v <= (detector.diameter / 2) ** 2;
      baseline[j] = inside ? base : 0;
      values[j] = inside ? Math.max(0, base + I) : 0;
      power += values[j];
    }
  if (detector.type === "camera" && dx > detector.pixelPitch / 1000)
    warnings.add(
      `Optical field samples (${(dx * 1000).toFixed(2)} µm) are coarser than camera pixels (${detector.pixelPitch} µm). Camera resampling does not recover unresolved optical features.`,
    );
  warnings.add(
    "Paths are discovered from chief rays; diffracted tails cannot discover additional optics. Compare grid and field width before interpreting results.",
  );
  warnings.add(
    "Ideal reciprocal splitters and mirrors use fixed phases; this solver does not use the 3D material/coating model. Coherence is a Gaussian path-length envelope.",
  );
  return {
    format: "optibench-coherent-run",
    version: 1,
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    project,
    settings: { n, width, detectorId },
    n,
    width,
    dx,
    wavelength: source.wavelength,
    values: Array.from(values),
    baseline: Array.from(baseline),
    power,
    baselinePower: baseline.reduce((s, v) => s + v, 0),
    paths: branches.map((b) => ({
      steps: b.path.steps,
      opl: b.opl,
      phase: b.phase,
      jones: b.jones,
      power: b.power,
      planes: b.planes,
    })),
    coherence,
    maximumEdge,
    maxLensStep,
    warnings: [...warnings],
    camera: null,
  };
}
export function acquireCoherentCamera(run, { seed = 42, noise = true } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw Error("Use a nonnegative integer seed ≤ 2147483647.");
  const c = run.project.items.find((c) => c.id === run.settings.detectorId);
  if (c?.type !== "camera") throw Error("Select a camera to acquire a frame.");
  const n = Math.min(run.n, c.pixelsX, c.pixelsY);
  if (n !== run.n)
    throw Error("Camera is smaller than the requested central ROI.");
  const width = (n * c.pixelPitch) / 1000;
  if (width > run.width)
    throw Error("The native camera ROI exceeds the propagated field width.");
  const pitch = c.pixelPitch / 1000,
    originX = Math.floor((c.pixelsX - n) / 2),
    originY = Math.floor((c.pixelsY - n) / 2);
  const offsetX = (originX + (n - c.pixelsX) / 2) * pitch,
    offsetY = (originY + (n - c.pixelsY) / 2) * pitch;
  const nativePower = new Float64Array(n * n),
    zero = new Float64Array(n * n);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      nativePower[y * n + x] =
        sample(
          run.values,
          zero,
          n,
          run.width,
          (x + 0.5 - n / 2) * pitch + offsetX,
          (y + 0.5 - n / 2) * pitch + offsetY,
        )[0] *
        (pitch / run.dx) ** 2;
  const camera = cameraResponse(
    nativePower,
    run.n,
    width,
    { ...c, pixelsX: n, pixelsY: n },
    run.wavelength,
    { seed, noise },
  );
  return {
    ...camera,
    values: Array.from(camera.values),
    n,
    settings: structuredClone(c),
    roi: { originX, originY, widthMm: width, pixelMm: pitch },
    note: "Central native-pixel ROI; irradiance is sampled from the propagated grid. Sensor pixels do not improve the underlying optical sampling. No phase reconstruction is implied by a single frame.",
  };
}
export function coherentBenchExample() {
  const p = makeProject("michelson");
  p.title = "Coherent Michelson · lens and iris";
  p.items.find((c) => c.type === "camera").exposure = 5;
  const m = p.items.find((c) => c.type === "mirror" && c.label.includes("M1"));
  m.angle = 0;
  p.items.push(
    instantiate(
      catalog.find((c) => c.type === "lens"),
      100001,
      850,
      450,
      {
        label: "Ideal thin lens · f 2000 mm",
        f: 2000,
        aperture: 12,
        diameter: 25.4,
        angle: 0,
        transmission: 1,
      },
    ),
    instantiate("DESIGN-IRIS-5", 100002, 750, 450, {
      label: "Diffracting arm iris",
      aperture: 2,
      angle: 0,
    }),
  );
  return p;
}
export function acquireCoherentPhase(
  input,
  settings,
  { mirrorId, seed = 42 } = {},
  options = {},
) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483644)
    throw Error("Use a noise seed from 0 to 2147483644.");
  const base = discoverCoherentPaths(input, settings.detectorId);
  if (base.detector.type !== "camera" || base.paths.length !== 2)
    throw Error(
      "Four-phase acquisition requires exactly two paths at a camera.",
    );
  const mirror = base.project.items.find(
    (c) => c.id === mirrorId && c.type === "mirror",
  );
  if (!mirror) throw Error("Choose the reference-arm mirror.");
  const occurrences = base.paths.map((p) =>
    p.steps.filter((s) => s.id === mirrorId && s.event === "R"),
  );
  if (
    occurrences.filter((s) => s.length === 1).length !== 1 ||
    occurrences.reduce((s, a) => s + a.length, 0) !== 1
  )
    throw Error(
      "The phase mirror must be encountered once in exactly one arm.",
    );
  const incidence = occurrences.find((s) => s.length)[0].incidence,
    stepNm = base.source.wavelength / (8 * Math.cos(incidence * DEG)),
    frames = [],
    saturated = [],
    warnings = new Set();
  for (let i = 0; i < 4; i++) {
    const p = structuredClone(base.project);
    p.items.find((c) => c.id === mirrorId).pistonNm =
      (mirror.pistonNm || 0) + i * stepNm;
    const r = propagateCoherentBench(p, settings),
      c = acquireCoherentCamera(r, { seed: seed + i, noise: true });
    r.warnings.forEach((w) => warnings.add(w));
    frames.push({
      name: `Coherent bench phase ${i * 90}°`,
      width: r.n,
      height: r.n,
      values: c.values,
    });
    saturated.push(c.saturated);
    options.onProgress?.({ completed: i + 1, total: 4 });
  }
  const measurementSettings = {
    ...defaultMeasurementSettings(),
    n: settings.n || 128,
    pixelUm: base.detector.pixelPitch,
    wavelength: base.source.wavelength,
  };
  let result = null,
    analysisError = null;
  try {
    result = analyzeMeasurement(frames, measurementSettings);
  } catch (e) {
    analysisError = e.message;
  }
  return serializable({
    format: "optibench-measurement",
    version: 1,
    id: crypto.randomUUID(),
    acquisitionId: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    acquiredAt: new Date().toISOString(),
    name: base.project.title + " · numerical field phase acquisition",
    notes:
      "Synthetic numerical-field acquisition. Four ideal optical-piston steps on one mirror; fixed geometry, no mechanical motion or drift. Native central camera ROI sampled from the propagated grid. Relative OPD is detrended; this is not hardware calibration.",
    project: base.project,
    frames,
    dark: null,
    flat: null,
    settings: measurementSettings,
    result,
    simulation: {
      coherentBench: true,
      version: 1,
      detectorId: base.detector.id,
      mirrorId,
      stepNm,
      seed,
      phaseSeeds: [seed, seed + 1, seed + 2, seed + 3],
      phaseStepsRad: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
      camera: base.detector,
      fieldSettings: settings,
      saturated,
      analysisError,
      warnings: [...warnings],
    },
  });
}
