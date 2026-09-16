import {
  EPS,
  add,
  sub,
  scale,
  dot,
  length,
  unit,
  axes,
  normalAngles,
  local,
  inside,
  volume,
  nearestSurface,
} from "./ray3-geometry.js";
import {
  fieldPower,
  initialFields,
  interfaceBranches,
  idealBranches,
} from "./ray3-fresnel.js";
import { indexAt, rayMaterials } from "./ray3-materials.js";
import { validateProject } from "./project.js";
export const RAY_ENGINE = "nonsequential-1.0";
export const rayKinds = {
  plate: "Dielectric rectangular plate",
  sphere: "Dielectric sphere",
  lens: "Symmetric biconvex lens",
  mirror: "Ideal planar mirror",
  splitter: "Ideal planar splitter",
  absorber: "Opaque stop",
  detector: "Absorbing detector",
  unsupported: "Needs explicit surface model",
};
const clone = structuredClone;
export function newRayObject(kind = "plate", id = crypto.randomUUID()) {
  return {
    id: String(id),
    label: rayKinds[kind],
    kind,
    center: [500, 450, 100],
    normal: [1, 0, 0],
    width: 25.4,
    height: 25.4,
    shape: "rectangle",
    radius: 50,
    thickness: 5,
    aperture: 20,
    material: "N-BK7",
    reflectivity: kind === "splitter" ? 0.5 : 1,
    transmission: kind === "splitter" ? 0.5 : 0,
  };
}
export function newRayScene() {
  return {
    format: "optibench-nonsequential",
    version: 1,
    id: crypto.randomUUID(),
    name: "Non-sequential experiment",
    sources: [
      {
        id: "source",
        label: "Collimated Gaussian source",
        position: [200, 450, 100],
        direction: [1, 0, 0],
        wavelength: 633,
        power: 1,
        waist: 0.3,
        polarization: 0,
        ellipticity: 0,
        unpolarized: false,
      },
    ],
    objects: [],
    options: {
      rays: 128,
      maxDepth: 16,
      maxSegments: 30000,
      minPowerFraction: 1e-7,
      bins: 32,
    },
    notes: [],
  };
}
export function rayExample(name = "plate") {
  const s = newRayScene();
  s.name =
    name === "sphere"
      ? "Ball lens · refracted ray fan"
      : name === "lens"
        ? "Biconvex lens · surface reflections"
        : "Plane-parallel plate · internal reflection ghosts";
  const glass = newRayObject(name, "glass");
  glass.center = [500, 450, 100];
  glass.width = 40;
  glass.height = 40;
  glass.radius = name === "sphere" ? 12.7 : 50;
  glass.aperture = 20;
  glass.thickness = 8;
  const d = newRayObject("detector", "detector");
  d.label = "Transmitted detector";
  d.center = [name === "sphere" ? 525 : name === "lens" ? 551 : 650, 450, 100];
  d.width = 20;
  d.height = 20;
  const reflected = newRayObject("detector", "return");
  reflected.label = "Return detector";
  reflected.center = [150, 450, 100];
  reflected.width = 20;
  reflected.height = 20;
  if (name === "plate") glass.normal = normalAngles(15, 5);
  else s.sources[0].waist = 3;
  s.objects = [glass, d, reflected];
  return s;
}
export function sceneFromBench(input) {
  const p = validateProject(input),
    s = newRayScene();
  s.name = p.title + " · surface model";
  s.bench = clone(p);
  s.sources = [];
  for (const c of p.items.filter((c) => c.enabled)) {
    if (c.type === "source") {
      s.sources.push({
        id: String(c.id),
        label: c.label,
        position: [c.x, c.y, c.z],
        direction: normalAngles(c.angle, c.pitch),
        wavelength: c.wavelength,
        power: c.power,
        waist: c.waist,
        polarization: c.polarization,
        ellipticity: c.ellipticity,
        unpolarized: false,
      });
      continue;
    }
    if (c.type === "mechanical") {
      s.notes.push(
        `${c.label}: mechanical body excluded; no CAD envelope is available.`,
      );
      continue;
    }
    const kind =
        {
          mirror: "mirror",
          splitter: "splitter",
          camera: "detector",
          screen: "detector",
          power: "detector",
          stop: "absorber",
        }[c.type] || "unsupported",
      o = newRayObject(kind, String(c.id));
    o.label = c.label;
    o.center = [c.x, c.y, c.z];
    o.normal = normalAngles(c.angle, c.pitch);
    o.shape = "disc";
    o.width = c.aperture;
    o.height = c.aperture;
    o.reflectivity = c.reflectivity;
    o.transmission = kind === "splitter" ? c.transmission : 0;
    o.originType = c.type;
    if (c.type === "camera") {
      o.shape = "rectangle";
      o.width = (c.pixelsX * c.pixelPitch) / 1000;
      o.height = (c.pixelsY * c.pixelPitch) / 1000;
    }
    if (kind === "unsupported")
      s.notes.push(
        `${c.label}: ${c.type} requires an explicit supported surface model or removal from this study.`,
      );
    s.objects.push(o);
  }
  s.notes.unshift(
    "Collimated spatial Gaussian ray samples; no Gaussian divergence or diffraction. Ideal mirrors/splitters use scalar power fractions, not catalog coating prescriptions. Detectors absorb all incident ray power without camera electronics.",
  );
  return s;
}
function vector(v, label) {
  if (
    !Array.isArray(v) ||
    v.length !== 3 ||
    !v.every((x) => Number.isFinite(x) && Math.abs(x) <= 1e6)
  )
    throw Error(`${label} requires three finite coordinates.`);
}
function bounded(v, min, max, label, integer = false) {
  if (
    !Number.isFinite(v) ||
    v < min ||
    v > max ||
    (integer && !Number.isInteger(v))
  )
    throw Error(
      `${label} must be ${min}–${max}${integer ? " (integer)" : ""}.`,
    );
}
function extent(o) {
  const b = axes(o.normal),
    half =
      o.kind === "sphere"
        ? [o.radius, o.radius, o.radius]
        : o.kind === "plate"
          ? [o.thickness / 2, o.width / 2, o.height / 2]
          : [o.thickness / 2, o.aperture / 2, o.aperture / 2];
  return o.kind === "sphere"
    ? half
    : [0, 1, 2].map(
        (i) =>
          Math.abs(b.n[i]) * half[0] +
          Math.abs(b.u[i]) * half[1] +
          Math.abs(b.v[i]) * half[2],
      );
}
export function validateRayScene(input) {
  if (
    input?.format !== "optibench-nonsequential" ||
    input.version !== 1 ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 200
  )
    throw Error("Use a named non-sequential scene.");
  const s = clone(input);
  s.notes ??= [];
  if (
    !Array.isArray(s.notes) ||
    s.notes.length > 300 ||
    s.notes.some((n) => typeof n !== "string" || n.length > 2000)
  )
    throw Error("Scene notes must be a bounded list of text entries.");
  if (
    !Array.isArray(s.sources) ||
    !s.sources.length ||
    s.sources.length > 8 ||
    !Array.isArray(s.objects) ||
    s.objects.length > 64
  )
    throw Error("Use 1–8 sources and at most 64 optical objects.");
  const ids = new Set();
  for (const o of [...s.sources, ...s.objects]) {
    if (
      typeof o.id !== "string" ||
      !/^[\w-]{1,100}$/.test(o.id) ||
      ids.has(o.id) ||
      typeof o.label !== "string" ||
      o.label.length > 200
    )
      throw Error("Objects need unique safe IDs and labels.");
    ids.add(o.id);
  }
  for (const a of s.sources) {
    vector(a.position, "Source position");
    vector(a.direction, "Source direction");
    a.direction = unit(a.direction);
    indexAt("ambient", a.wavelength);
    bounded(a.power, 1e-12, 1e6, "Source power");
    bounded(a.waist, 0, 100, "Spatial waist");
    bounded(a.polarization, -360, 360, "Polarization angle");
    bounded(a.ellipticity, -45, 45, "Ellipticity angle");
    if (typeof a.unpolarized !== "boolean")
      throw Error("Choose a valid polarization mode.");
  }
  for (const o of s.objects) {
    if (!rayKinds[o.kind] || o.kind === "unsupported")
      throw Error(
        `${o.label}: choose an explicit surface model before tracing.`,
      );
    vector(o.center, "Object center");
    vector(o.normal, "Object normal");
    o.normal = unit(o.normal);
    bounded(o.width, 0.001, 6000, "Width");
    bounded(o.height, 0.001, 6000, "Height");
    if (!["disc", "rectangle"].includes(o.shape))
      throw Error("Choose a disc or rectangle.");
    if (volume(o)) indexAt(o.material, 633);
    if (["sphere", "lens"].includes(o.kind))
      bounded(o.radius, 0.01, 10000, "Surface radius");
    if (["plate", "lens"].includes(o.kind))
      bounded(o.thickness, 0.001, 1000, "Thickness");
    if (o.kind === "lens") {
      bounded(o.aperture, 0.001, 500, "Clear aperture");
      if (
        o.thickness >= 2 * o.radius ||
        o.aperture / 2 >=
          Math.sqrt(o.radius * o.thickness - o.thickness ** 2 / 4) - EPS
      )
        throw Error(
          `${o.label}: aperture must leave positive edge thickness in a symmetric biconvex lens.`,
        );
    }
    if (["mirror", "splitter"].includes(o.kind)) {
      bounded(o.reflectivity, 0, 1, "Reflectivity");
      bounded(o.transmission, 0, 1, "Transmission");
      if (o.kind === "splitter" && o.reflectivity + o.transmission > 1)
        throw Error("Splitter R + T cannot exceed 1.");
    }
  }
  const volumes = s.objects.filter(volume);
  for (let i = 0; i < volumes.length; i++)
    for (let j = i + 1; j < volumes.length; j++) {
      const a = volumes[i],
        b = volumes[j],
        ea = extent(a),
        eb = extent(b);
      if (
        a.center.every(
          (v, k) => Math.abs(v - b.center[k]) <= ea[k] + eb[k] + EPS,
        )
      )
        throw Error(
          `${a.label} / ${b.label}: separate dielectric bounding boxes. Nested or overlapping volumes are not supported.`,
        );
    }
  for (const a of s.sources)
    for (const o of volumes)
      if (inside(a.position, o, -EPS))
        throw Error("Launch sources outside dielectric volumes.");
  const q = s.options;
  if (!q) throw Error("Missing trace options.");
  bounded(q.rays, 1, 2048, "Rays per source", true);
  bounded(q.maxDepth, 1, 64, "Encounter limit", true);
  bounded(q.maxSegments, 100, 100000, "Segment budget", true);
  bounded(q.minPowerFraction, 0, 0.1, "Minimum branch power fraction");
  bounded(q.bins, 8, 128, "Detector bins", true);
  return s;
}
export function launchRays(s) {
  const result = [];
  for (const src of s.sources) {
    const b = axes(src.direction);
    for (let i = 0; i < s.options.rays; i++) {
      const u = (i + 0.5) / s.options.rays,
        r = src.waist * Math.sqrt(-0.5 * Math.log(1 - u * (1 - Math.exp(-18)))),
        a = i * Math.PI * (3 - Math.sqrt(5));
      const position = add(
        src.position,
        add(scale(b.u, r * Math.cos(a)), scale(b.v, r * Math.sin(a))),
      );
      if (s.objects.some((o) => volume(o) && inside(position, o, -EPS)))
        throw Error(
          "Source samples intersect a dielectric volume. Move the source or reduce the beam radius.",
        );
      result.push({
        origin: position,
        direction: src.direction,
        fields: initialFields(
          src.direction,
          src.power / s.options.rays,
          src.polarization,
          src.ellipticity,
          src.unpolarized,
        ),
        wavelength: src.wavelength,
        sourceId: src.id,
        rootPower: src.power / s.options.rays,
        medium: null,
        depth: 0,
        path: [],
        opl: 0,
      });
    }
  }
  return result;
}
export function traceNonsequential(
  input,
  { cancelled = () => false, onProgress = () => {} } = {},
) {
  const scene = validateRayScene(input),
    queue = launchRays(scene),
    initialPower = scene.sources.reduce((s, a) => s + a.power, 0),
    ledger = {
      launched: initialPower,
      detected: 0,
      absorbed: 0,
      escaped: 0,
      threshold: 0,
      depthLimit: 0,
      budgetLimit: 0,
      cancelled: 0,
    },
    segments = [],
    detectorHits = [],
    terminals = [],
    surfaceStats = {};
  const detectors = scene.objects
    .filter((o) => o.kind === "detector")
    .map((o) => ({
      id: o.id,
      label: o.label,
      width: o.width,
      height: o.height,
      bins: scene.options.bins,
      power: 0,
      pixels: Array(scene.options.bins ** 2).fill(0),
    }));
  function end(ray, category, power = fieldPower(ray.fields)) {
    ledger[category] += power;
    terminals.push({
      category,
      power,
      sourceId: ray.sourceId,
      wavelength: ray.wavelength,
      path: ray.path,
      opl: ray.opl,
    });
  }
  while (queue.length) {
    if (cancelled() || segments.length >= scene.options.maxSegments) {
      const category = cancelled() ? "cancelled" : "budgetLimit";
      for (const r of queue) end(r, category);
      queue.length = 0;
      break;
    }
    const ray = queue.pop(),
      power = fieldPower(ray.fields);
    if (power <= 0) continue;
    if (power < ray.rootPower * scene.options.minPowerFraction) {
      end(ray, "threshold");
      continue;
    }
    if (ray.depth >= scene.options.maxDepth) {
      end(ray, "depthLimit");
      continue;
    }
    const hit = nearestSurface(ray.origin, ray.direction, scene.objects);
    if (!hit) {
      if (ray.medium)
        throw Error(
          "A ray escaped a closed dielectric volume: invalid geometry.",
        );
      end(ray, "escaped");
      continue;
    }
    const o = hit.object,
      current = ray.medium
        ? scene.objects.find((o) => o.id === ray.medium).material
        : "ambient",
      n1 = indexAt(current, ray.wavelength),
      opl = ray.opl + hit.distance * n1;
    segments.push({
      a: ray.origin,
      b: hit.point,
      power,
      wavelength: ray.wavelength,
      sourceId: ray.sourceId,
      path: ray.path,
      surface: `${o.id}:${hit.face}`,
    });
    const stats = (surfaceStats[o.id] ??= {
      incident: 0,
      reflected: 0,
      transmitted: 0,
      absorbed: 0,
      detected: 0,
      encounters: 0,
    });
    stats.incident += power;
    stats.encounters++;
    if (o.kind === "detector") {
      const path = [
          ...ray.path,
          { objectId: o.id, surface: hit.face, event: "D" },
        ],
        d = detectors.find((d) => d.id === o.id),
        n = d.bins,
        x = Math.min(
          n - 1,
          Math.max(0, Math.floor((hit.uv[0] / o.width + 0.5) * n)),
        ),
        y = Math.min(
          n - 1,
          Math.max(0, Math.floor((hit.uv[1] / o.height + 0.5) * n)),
        );
      d.pixels[y * n + x] += power;
      d.power += power;
      stats.detected += power;
      detectorHits.push({
        detectorId: o.id,
        power,
        uv: hit.uv,
        point: hit.point,
        path,
        opl,
        wavelength: ray.wavelength,
        sourceId: ray.sourceId,
        fields: ray.fields,
        direction: ray.direction,
      });
      end({ ...ray, path, opl }, "detected");
      continue;
    }
    if (o.kind === "absorber") {
      stats.absorbed += power;
      end(
        {
          ...ray,
          path: [
            ...ray.path,
            { objectId: o.id, surface: hit.face, event: "A" },
          ],
          opl,
        },
        "absorbed",
      );
      continue;
    }
    let branches;
    if (volume(o)) {
      if (ray.medium && ray.medium !== o.id)
        throw Error("Ambiguous dielectric transition. Separate volumes.");
      const exiting = ray.medium === o.id;
      if (
        dot(ray.direction, hit.normal) > 1e-10 !== exiting &&
        Math.abs(dot(ray.direction, hit.normal)) > 1e-10
      )
        throw Error(
          "Dielectric side disagrees with ray medium. Avoid tangencies and coincident surfaces.",
        );
      const n2 = indexAt(exiting ? "ambient" : o.material, ray.wavelength);
      branches = interfaceBranches(
        ray.direction,
        hit.normal,
        ray.fields,
        n1,
        n2,
      ).map((b) => ({
        ...b,
        medium: b.event === "T" ? (exiting ? null : o.id) : ray.medium,
      }));
    } else
      branches = idealBranches(
        ray.direction,
        hit.normal,
        ray.fields,
        o.reflectivity,
        o.kind === "splitter" ? o.transmission : 0,
      ).map((b) => ({ ...b, medium: ray.medium }));
    const total = branches.reduce((s, b) => s + fieldPower(b.fields), 0),
      absorbed = volume(o) ? 0 : Math.max(0, power - total);
    if (absorbed > 0) {
      stats.absorbed += absorbed;
      end(
        {
          ...ray,
          path: [
            ...ray.path,
            { objectId: o.id, surface: hit.face, event: "A" },
          ],
          opl,
        },
        "absorbed",
        absorbed,
      );
    }
    for (const branch of branches) {
      const p = fieldPower(branch.fields);
      stats[branch.event === "T" ? "transmitted" : "reflected"] += p;
      queue.push({
        ...ray,
        ...branch,
        origin: add(hit.point, scale(branch.direction, EPS * 4)),
        depth: ray.depth + 1,
        path: [
          ...ray.path,
          { objectId: o.id, surface: hit.face, event: branch.event },
        ],
        opl:
          opl +
          EPS *
            4 *
            indexAt(
              branch.medium
                ? scene.objects.find((x) => x.id === branch.medium).material
                : "ambient",
              ray.wavelength,
            ),
      });
    }
    if (segments.length % 256 === 0)
      onProgress({ segments: segments.length, queued: queue.length });
  }
  const accounted = Object.entries(ledger)
    .filter(([k]) => k !== "launched")
    .reduce((s, [, v]) => s + v, 0);
  ledger.residual = initialPower - accounted;
  for (const d of detectors) {
    d.pixelArea = (d.width * d.height) / d.bins ** 2;
    d.irradiance = d.pixels.map((p) => p / d.pixelArea);
  }
  return {
    format: "optibench-nonsequential-run",
    version: 1,
    id: crypto.randomUUID(),
    engine: RAY_ENGINE,
    createdAt: new Date().toISOString(),
    scene,
    ledger,
    segments,
    detectorHits,
    terminals,
    surfaceStats,
    detectors,
    status: ledger.cancelled > 0 ? "cancelled" : "completed",
  };
}
export function pathKey(path) {
  return path.map((p) => `${p.objectId}:${p.surface}:${p.event}`).join(" → ");
}
export function groupDetectorPaths(
  run,
  { detectorId = "", contains = "", reflections = null } = {},
) {
  const groups = new Map();
  for (const h of run.detectorHits) {
    const count = h.path.filter(
        (p) => p.event === "R" || p.event === "TIR",
      ).length,
      key = pathKey(h.path);
    if (
      (detectorId && h.detectorId !== detectorId) ||
      (contains && !h.path.some((p) => p.objectId === contains)) ||
      (reflections !== null && count !== reflections)
    )
      continue;
    const k = `${h.sourceId}|${h.wavelength}|${key}`,
      g = groups.get(k) || {
        key,
        path: h.path,
        sourceId: h.sourceId,
        wavelength: h.wavelength,
        detectorId: h.detectorId,
        reflections: count,
        power: 0,
        hits: 0,
      };
    g.power += h.power;
    g.hits++;
    groups.set(k, g);
  }
  return [...groups.values()].sort((a, b) => b.power - a.power);
}
export function parseRayScene(text) {
  if (text.length > 2 * 1024 * 1024)
    throw Error("Scene imports are limited to 2 MB.");
  const s = validateRayScene(JSON.parse(text));
  s.id = crypto.randomUUID();
  return s;
}
