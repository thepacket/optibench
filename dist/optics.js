// SI optical equations, millimetres for geometry, milliwatts for power.
export const DEG = Math.PI / 180;
export const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const rad = (c) => (c.angle || 0) * DEG;
export const direction = (a) => ({ x: Math.cos(a), y: Math.sin(a) });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export function gaussianQ(waist, wavelength, m2 = 1) {
  return { re: 0, im: (Math.PI * waist * waist) / (wavelength * 1e-6 * m2) };
}
export function propagateQ(q, d) {
  return { re: q.re + d, im: q.im };
}
export function lensQ(q, f) {
  const a = 1 - q.re / f,
    b = -q.im / f,
    D = a * a + b * b;
  return { re: (q.re * a + q.im * b) / D, im: (q.im * a - q.re * b) / D };
}
export function beamRadius(q, lambda, m2 = 1) {
  return Math.sqrt(
    (((lambda * 1e-6 * m2) / Math.PI) * (q.re * q.re + q.im * q.im)) / q.im,
  );
}
export function waistInfo(q, lambda, m2 = 1) {
  return {
    waist: Math.sqrt((lambda * 1e-6 * m2 * q.im) / Math.PI),
    distance: -q.re,
    rayleigh: q.im,
    curvature:
      Math.abs(q.re) < 1e-12 ? Infinity : (q.re * q.re + q.im * q.im) / q.re,
  };
}
export function reflection(d, normal) {
  let k = 2 * dot(d, normal);
  return { x: d.x - k * normal.x, y: d.y - k * normal.y };
}
export function intersect(p, d, c) {
  const n = direction(rad(c)),
    t = { x: -n.y, y: n.x },
    den = dot(d, n);
  if (Math.abs(den) < 1e-8) return null;
  const len = ((c.x - p.x) * n.x + (c.y - p.y) * n.y) / den;
  if (len < 0.0001) return null;
  const hit = { x: p.x + len * d.x, y: p.y + len * d.y };
  const offset = (hit.x - c.x) * t.x + (hit.y - c.y) * t.y;
  const physical = c.diameter || c.aperture || 25.4;
  if (Math.abs(offset) > Math.max(physical / 2, 4)) return null;
  return {
    len,
    hit,
    offset,
    n,
    t,
    incidence: Math.acos(clamp(Math.abs(den), 0, 1)) / DEG,
  };
}
function edgeDistance(p, d, table) {
  const candidates = [];
  if (d.x > 1e-9) candidates.push((table.width - p.x) / d.x);
  if (d.x < -1e-9) candidates.push(-p.x / d.x);
  if (d.y > 1e-9) candidates.push((table.height - p.y) / d.y);
  if (d.y < -1e-9) candidates.push(-p.y / d.y);
  return Math.max(0, Math.min(...candidates.filter((n) => n >= 0), 5000));
}
export function trace(project, { rays = false } = {}) {
  const items = project.items.filter((c) => c.enabled !== false),
    sources = items.filter((c) => ["source", "image"].includes(c.type)),
    optics = items.filter(
      (c) => !["source", "image", "mechanical"].includes(c.type),
    );
  const segments = [],
    hits = [],
    warnings = [],
    detectors = [],
    queue = [];
  let serial = 0;
  for (const src of sources) {
    const count = rays ? 13 : 1;
    for (let j = 0; j < count; j++) {
      const offset = rays ? ((j - 6) * src.waist) / 3 : 0;
      const d = direction(rad(src));
      queue.push({
        p: { x: src.x - d.y * offset, y: src.y + d.x * offset },
        d,
        q: gaussianQ(src.waist, src.wavelength, src.m2),
        power: src.power / count,
        source: src,
        depth: 0,
        path: [],
        s: 0,
        phase: 0,
        piston: 0,
        last: src.id,
        branch: serial++,
        pol: src.polarization || 0,
        ray: rays,
      });
    }
  }
  while (queue.length && segments.length < 4000) {
    let beam = queue.shift();
    for (let iter = 0; iter < 64; iter++) {
      if (beam.power < 1e-9) break;
      let next = null,
        c = null;
      for (const o of optics) {
        if (o.id === beam.last) continue;
        const hit = intersect(beam.p, beam.d, o);
        if (hit && (!next || hit.len < next.len)) {
          next = hit;
          c = o;
        }
      }
      let len = next ? next.len : edgeDistance(beam.p, beam.d, project.table);
      if (len < 0 || !Number.isFinite(len)) break;
      const edge = edgeDistance(beam.p, beam.d, project.table);
      if (len > edge) {
        len = edge;
        next = null;
        c = null;
      }
      const end = {
        x: beam.p.x + beam.d.x * len,
        y: beam.p.y + beam.d.y * len,
      };
      const q2 = propagateQ(beam.q, len);
      segments.push({
        from: { ...beam.p },
        to: end,
        q: { ...beam.q },
        qEnd: q2,
        w0: beamRadius(beam.q, beam.source.wavelength, beam.source.m2),
        w1: beamRadius(q2, beam.source.wavelength, beam.source.m2),
        length: len,
        s: beam.s,
        power: beam.power,
        source: beam.source.id,
        wavelength: beam.source.wavelength,
        m2: beam.source.m2,
        branch: beam.branch,
        ray: rays,
      });
      beam.phase -= Math.atan2(q2.re, q2.im) - Math.atan2(beam.q.re, beam.q.im);
      beam.s += len;
      beam.q = q2;
      if (!next) break;
      const w = beamRadius(q2, beam.source.wavelength, beam.source.m2);
      let encounter = {
        id: c.id,
        source: beam.source.id,
        position: end,
        distance: beam.s,
        opticalPath: beam.s + beam.piston,
        phase: beam.phase,
        direction: { ...beam.d },
        q: { ...q2 },
        radius: w,
        power: beam.power,
        offset: next.offset,
        incidence: next.incidence,
        branch: beam.branch,
        path: [
          ...beam.path,
          {
            id: c.id,
            distance: len,
            offset: next.offset,
            incidence: next.incidence,
            radius: w,
          },
        ],
        polarization: beam.pol,
        wavelength: beam.source.wavelength,
        m2: beam.source.m2,
      };
      hits.push(encounter);
      beam.path = encounter.path;
      if (
        c.range &&
        (beam.source.wavelength < c.range[0] ||
          beam.source.wavelength > c.range[1])
      )
        warnings.push({
          id: c.id,
          level: "warning",
          text: `${c.label}: wavelength outside the catalog coating range.`,
        });
      if (["camera", "screen", "power"].includes(c.type)) {
        detectors.push(encounter);
        if (c.type !== "screen" || c.terminate !== false) break;
      }
      if (c.type === "stop") break;
      if (c.type === "lens") {
        if (next.incidence > 10) {
          warnings.push({
            id: c.id,
            level: "error",
            text: `${c.label}: lens incidence ${next.incidence.toFixed(1)}° exceeds the 10° paraxial limit; path stopped.`,
          });
          break;
        }
        const aperture = c.aperture || c.diameter;
        if (rays && Math.abs(next.offset) > aperture / 2) break;
        if (!rays && Math.abs(next.offset) > w * 0.1)
          warnings.push({
            id: c.id,
            level: "warning",
            text: `${c.label}: decentered beam; Gaussian clipping estimate assumes centering.`,
          });
        if (!rays) {
          const fraction = 1 - Math.exp((-2 * (aperture / 2) ** 2) / w ** 2);
          beam.power *= fraction;
          if (fraction < 0.99)
            warnings.push({
              id: c.id,
              level: "warning",
              text: `${c.label}: finite aperture clips the beam; downstream Gaussian shape is approximate.`,
            });
        }
        beam.q = lensQ(beam.q, c.f);
        const axis =
          dot(beam.d, next.n) > 0 ? next.n : { x: -next.n.x, y: -next.n.y };
        const tangent = { x: -axis.y, y: axis.x };
        const slope =
          dot(beam.d, tangent) / dot(beam.d, axis) -
          ((end.x - c.x) * tangent.x + (end.y - c.y) * tangent.y) / c.f;
        const norm = Math.hypot(1, slope);
        beam.d = {
          x: (axis.x + slope * tangent.x) / norm,
          y: (axis.y + slope * tangent.y) / norm,
        };
        beam.power *= c.transmission ?? 1;
      }
      if (["aperture", "slit"].includes(c.type)) {
        if (rays) {
          if (Math.abs(next.offset) > c.aperture / 2) break;
        } else {
          let fraction =
            c.type === "slit"
              ? erf(c.aperture / Math.sqrt(2) / w)
              : 1 - Math.exp((-2 * (c.aperture / 2) ** 2) / w ** 2);
          beam.power *= fraction;
          if (fraction < 0.99)
            warnings.push({
              id: c.id,
              level: "warning",
              text: `${c.label}: aperture diffraction requires the Fourier solver.`,
            });
        }
      }
      if (c.type === "filter") beam.power *= c.transmission;
      if (c.type === "polarizer") {
        if (Math.cos((beam.pol - c.axis) * DEG) < 0) beam.phase += Math.PI;
        beam.power *= Math.cos((beam.pol - c.axis) * DEG) ** 2;
        beam.pol = c.axis;
      }
      if (c.type === "mirror") {
        beam.phase += Math.PI;
        beam.piston +=
          2 * (c.pistonNm || 0) * 1e-6 * Math.abs(dot(beam.d, next.n));
        beam.d = reflection(beam.d, next.n);
        beam.power *= c.reflectivity;
      }
      if (c.type === "splitter") {
        if (beam.depth < 8)
          queue.push({
            ...beam,
            p: { ...end },
            d: reflection(beam.d, next.n),
            power: beam.power * c.reflectivity,
            phase: beam.phase + Math.PI / 2,
            last: c.id,
            depth: beam.depth + 1,
            branch: serial++,
            path: [...beam.path],
          });
        beam.power *= c.transmission;
        beam.depth++;
      }
      beam.p = end;
      beam.last = c.id;
      if (iter === 63)
        warnings.push({
          id: c.id,
          level: "error",
          text: "Path stopped after 64 interactions (possible optical loop).",
        });
    }
  }
  if (segments.length >= 4000)
    warnings.push({
      level: "error",
      text: "Trace reached the 4,000 segment limit.",
    });
  for (const c of items) {
    if (c.type === "mechanical") continue;
    if (
      !["source", "image"].includes(c.type) &&
      !hits.some((h) => h.id === c.id)
    )
      warnings.push({
        id: c.id,
        level: "info",
        text: `${c.label}: no traced beam reaches this component.`,
      });
  }
  return { segments, hits, detectors, warnings: uniqueWarnings(warnings) };
}
export function erf(x) {
  const sign = Math.sign(x);
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  return (
    sign *
    (1 -
      ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
        t +
        0.254829592) *
        t *
        Math.exp(-x * x))
  );
}
export function uniqueWarnings(a) {
  return [...new Map(a.map((x) => [x.text, x])).values()];
}
export function layoutChecks(project) {
  const w = [];
  for (const c of project.items) {
    const r = (c.footprint || 35) / 2;
    if (
      c.x - r < 0 ||
      c.x + r > project.table.width ||
      c.y - r < 0 ||
      c.y + r > project.table.height
    )
      w.push({
        id: c.id,
        level: "error",
        text: `${c.label}: mount footprint extends beyond the table.`,
      });
    for (const other of project.items) {
      if (other.id <= c.id || other.enabled === false || c.enabled === false)
        continue;
      if (
        distance(c, other) <
        ((c.footprint || 35) + (other.footprint || 35)) / 2
      )
        w.push({
          id: c.id,
          level: "warning",
          text: `${c.label} and ${other.label}: approximate mount footprints overlap.`,
        });
    }
  }
  return w;
}
export function seededRandom(seed = 1) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function normalRandom(rng) {
  return (
    Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) *
    Math.cos(2 * Math.PI * rng())
  );
}
export function monteCarlo(
  project,
  detectorId,
  { trials = 200, position = 0.1, angle = 0.05, focal = 0.5, seed = 42 } = {},
) {
  const rng = seededRandom(seed),
    samples = [];
  let missed = 0;
  for (let i = 0; i < trials; i++) {
    const p = {
      ...project,
      items: project.items.map((c) => ({
        ...c,
        x: c.x + (rng() * 2 - 1) * position,
        y: c.y + (rng() * 2 - 1) * position,
        angle: c.angle + (rng() * 2 - 1) * angle,
        f: c.f ? c.f * (1 + ((rng() * 2 - 1) * focal) / 100) : undefined,
      })),
    };
    const h = trace(p).detectors.find((d) => d.id === detectorId);
    if (h && Number.isFinite(h.radius) && h.power > 1e-9)
      samples.push({
        diameter: h.radius * 2,
        power: h.power,
        offset: h.offset,
      });
    else missed++;
  }
  const values = samples.map((s) => s.diameter).sort((a, b) => a - b);
  return {
    trials,
    missed,
    samples,
    mean: values.length
      ? values.reduce((a, b) => a + b, 0) / values.length
      : null,
    p05: values[Math.floor(values.length * 0.05)],
    p95: values[Math.min(values.length - 1, Math.floor(values.length * 0.95))],
    seed,
  };
}
export function designExpander(
  catalog,
  inputDiameter,
  targetDiameter,
  maxLength = 1000,
  lambda = 532,
) {
  const lenses = catalog.filter(
    (c) =>
      c.type === "lens" &&
      c.f &&
      (!c.range || (lambda >= c.range[0] && lambda <= c.range[1])),
  );
  const matches = [];
  for (const a of lenses)
    for (const b of lenses) {
      if (b.f <= 0 || a.id === b.id) continue;
      const separation = a.f + b.f;
      if (separation <= 0 || separation > maxLength) continue;
      const mag = Math.abs(b.f / a.f),
        output = inputDiameter * mag;
      if (a.diameter < inputDiameter * 1.5 || b.diameter < output * 1.5)
        continue;
      matches.push({
        a,
        b,
        separation,
        mag,
        output,
        error: Math.abs(output - targetDiameter) / targetDiameter,
      });
    }
  return matches
    .sort((a, b) => a.error - b.error || a.separation - b.separation)
    .slice(0, 12);
}
