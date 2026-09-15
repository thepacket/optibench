import { trace, seededRandom, normalRandom } from "./optics.js";
import { coherentField } from "./interferometry.js";
import { validateProject } from "./project.js";
export const meterDefaults = () => ({
  wavelength: 633,
  rangeMw: 0.001,
  averages: 16,
  darkNa: 0.2,
  noiseNa: 0.05,
  shutter: false,
});
// Illustrative silicon responsivity in A/W, not a vendor calibration curve.
const response = [
  [400, 0.18],
  [500, 0.3],
  [633, 0.42],
  [800, 0.55],
  [900, 0.6],
  [1000, 0.4],
  [1100, 0.05],
];
export function responsivity(nm) {
  if (!Number.isFinite(nm) || nm < 400 || nm > 1100)
    throw Error("This generic silicon response supports 400–1100 nm.");
  for (let i = 1; i < response.length; i++)
    if (nm <= response[i][0]) {
      const [x, a] = response[i - 1],
        [y, b] = response[i];
      return a + ((b - a) * (nm - x)) / (y - x);
    }
}
export function meterConfig(c) {
  const v = { ...meterDefaults(), ...c };
  responsivity(v.wavelength);
  if (
    ![0.0001, 0.001, 0.01, 0.1, 1, 10, 100].includes(v.rangeMw) ||
    ![1, 4, 16, 64, 256].includes(v.averages) ||
    !Number.isFinite(v.darkNa) ||
    Math.abs(v.darkNa) > 1000 ||
    !Number.isFinite(v.noiseNa) ||
    v.noiseNa < 0 ||
    v.noiseNa > 1000 ||
    typeof v.shutter !== "boolean"
  )
    throw Error("Invalid meter settings.");
  return v;
}
export function zeroKey(detectorId, c) {
  return JSON.stringify([
    detectorId,
    c.wavelength,
    c.rangeMw,
    c.darkNa,
    c.noiseNa,
  ]);
}
export function incidentPower(project, detectorId, blocked = false) {
  const p = validateProject(project),
    head = p.items.find(
      (c) => c.id === detectorId && c.type === "power" && c.enabled,
    );
  if (!head) throw Error("Select an enabled power-meter head on the bench.");
  if (blocked)
    return {
      project: p,
      head,
      powerMw: null,
      currentA: 0,
      paths: 0,
      warnings: [],
    };
  const t = trace(p),
    hits = t.detectors.filter((h) => h.id === detectorId),
    n = 256;
  if(t.warnings.some(w=>w.level==='error')) throw Error(t.warnings.filter(w=>w.level==='error').map(w=>w.text).join(' '));
  const radius = (head.aperture || head.diameter) / 2;
  let groups = new Map();
  for (const h of hits) {
    if (!groups.has(h.source)) groups.set(h.source, []);
    groups.get(h.source).push(h);
  }
  if (
    [...groups.values()].some((g) => g.length > 1) &&
    !(groups.size === 1 && hits.length === 2)
  )
    throw Error(
      "Multiple coherent paths require exactly two paths from one source for this meter model.",
    );
  let power = 0,
    current = 0;
  if (hits.length === 2 && groups.size === 1) {
    const width = Math.min(
      2 * radius,
      2 * Math.max(...hits.map((h) => Math.abs(h.offset) + 4 * h.radius)),
    );
    const f = coherentField(p, detectorId, { n, width }),
      dx = width / n;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        if (
          ((x + 0.5 - n / 2) * dx) ** 2 + ((y + 0.5 - n / 2) * dx) ** 2 <=
          radius ** 2
        )
          power += f.values[y * n + x];
    current = power * 0.001 * responsivity(f.wavelength);
  } else
    for (const h of hits) {
      const src = p.items.find((c) => c.id === h.source),
        cos = Math.cos((h.incidence * Math.PI) / 180);
      if (cos < 0.996)
        throw Error("Align the power head within 5 degrees of the beam.");
      const width = Math.min(
          2 * radius,
          2 *
            (Math.max(Math.abs(h.offset), Math.abs(h.verticalOffset || 0)) +
              4 * h.radius),
        ),
        dx = width / n;
      let captured = 0;
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) {
          const u = (x + 0.5 - n / 2) * dx,
            v = (y + 0.5 - n / 2) * dx;
          if (u * u + v * v > radius * radius) continue;
          captured +=
            ((2 * h.power) / (Math.PI * h.radius ** 2)) *
            Math.exp(
              (-2 *
                ((u - h.offset) ** 2 * cos * cos +
                  (v - (h.verticalOffset || 0)) ** 2)) /
                h.radius ** 2,
            ) *
            cos *
            dx *
            dx;
        }
      power += captured;
      current += captured * 0.001 * responsivity(src.wavelength);
    }
  return {
    project: p,
    head,
    powerMw: power,
    currentA: current,
    paths: hits.length,
    warnings: t.warnings.map((w) => w.text),
  };
}
export function readMeter(
  project,
  detectorId,
  settings,
  { seed, zero = null } = {},
) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw Error("Invalid meter noise seed.");
  const c = meterConfig(settings),
    optical = incidentPower(project, detectorId, c.shutter),
    rng = seededRandom(seed),
    sensitivity = responsivity(c.wavelength);
  if (zero && zero.key !== zeroKey(detectorId, c))
    throw Error(
      "Zero calibration belongs to different meter settings. Zero again.",
    );
  const samples = Array.from(
    { length: c.averages },
    () =>
      (((c.shutter ? 0 : optical.currentA) +
        c.darkNa * 1e-9 +
        c.noiseNa * 1e-9 * normalRandom(rng)) /
        sensitivity) *
      1000,
  );
  const overload = samples.some((v) => Math.abs(v) > c.rangeMw),
    mean = samples.reduce((s, v) => s + v, 0) / samples.length;
  const resolutionMw = c.rangeMw / 100000,
    corrected = mean - (zero?.offsetMw || 0);
  const now = new Date().toISOString();
  return {
    format: "optibench-power-reading",
    version: 1,
    id: crypto.randomUUID(),
    acquiredAt: now,
    project: optical.project,
    detectorId,
    head: optical.head,
    settings: c,
    seed,
    zero,
    valueMw: overload
      ? null
      : Math.round(corrected / resolutionMw) * resolutionMw,
    overload,
    resolutionMw,
    samplesMw: samples,
    sampleSdMw:
      samples.length > 1
        ? Math.sqrt(
            samples.reduce((s, v) => s + (v - mean) ** 2, 0) /
              (samples.length - 1),
          )
        : null,
    truth: {
      incidentPowerMw: optical.powerMw,
      admittedPowerMw: c.shutter ? 0 : optical.powerMw,
      paths: optical.paths,
    },
    warnings: optical.warnings,
    model:
      "Generic silicon response, Gaussian current noise and dark offset; independent samples, fixed scene. Circular aperture integrated on a 256² grid. Coherent two-path field or independent Gaussian beams. No calibrated vendor response, temporal drift, thermal detector response or hardware accuracy claim.",
  };
}
export function makeZero(reading) {
  if (!reading.settings.shutter)
    throw Error("Close the internal shutter before zeroing.");
  if (reading.overload)
    throw Error("Zero acquisition overloaded. Increase the range.");
  return {
    key: zeroKey(reading.detectorId, reading.settings),
    offsetMw:
      reading.samplesMw.reduce((s, v) => s + v, 0) / reading.samplesMw.length,
    acquiredAt: reading.acquiredAt,
    seed: reading.seed,
    averages: reading.settings.averages,
    sampleSdMw: reading.sampleSdMw,
  };
}
export const powerStore = {
  async access(mode, value) {
    const db = await new Promise((resolve, reject) => {
      const r = indexedDB.open("optibench-power-meter", 1);
      r.onupgradeneeded = () =>
        r.result.createObjectStore("readings", { keyPath: "id" });
      r.onsuccess = () => resolve(r.result);
      r.onerror = () =>
        reject(Error("Power-meter storage unavailable. Export your reading."));
    });
    return new Promise((resolve, reject) => {
      const tx = db.transaction("readings", mode),
        s = tx.objectStore("readings"),
        r = value ? s.put(value) : s.getAll();
      let result;
      r.onsuccess = () => (result = r.result);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(Error("Could not save meter readings. Export a backup."));
      };
    });
  },
  list() {
    return this.access("readonly");
  },
  save(r) {
    return this.access("readwrite", r);
  },
};
