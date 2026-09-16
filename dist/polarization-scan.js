import { readMeter, meterConfig } from "./power-meter.js";
import { validateProject } from "./project.js";
import { trace } from "./optics.js";

export function fitPolarization(points, harmonic) {
  const rows = points.filter(
    (p) => !p.reading.overload && Number.isFinite(p.reading.valueMw),
  );
  if (rows.length < 7)
    throw Error("At least seven valid readings are required for a fit.");
  const matrix = Array.from({ length: 3 }, () => [0, 0, 0, 0]);
  for (const p of rows) {
    const t = ((p.angle * Math.PI) / 180) * harmonic,
      x = [1, Math.cos(t), Math.sin(t)];
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) matrix[i][j] += x[i] * x[j];
      matrix[i][3] += x[i] * p.reading.valueMw;
    }
  }
  for (let i = 0; i < 3; i++) {
    let k = i;
    for (let j = i + 1; j < 3; j++)
      if (Math.abs(matrix[j][i]) > Math.abs(matrix[k][i])) k = j;
    [matrix[i], matrix[k]] = [matrix[k], matrix[i]];
    const d = matrix[i][i];
    if (Math.abs(d) < 1e-8)
      throw Error("Angular sampling cannot resolve the fit.");
    for (let j = i; j < 4; j++) matrix[i][j] /= d;
    for (let k = 0; k < 3; k++)
      if (k !== i) {
        const v = matrix[k][i];
        for (let j = i; j < 4; j++) matrix[k][j] -= v * matrix[i][j];
      }
  }
  const [a, b, c] = matrix.map((r) => r[3]),
    amplitude = Math.hypot(b, c),
    mean = rows.reduce((s, p) => s + p.reading.valueMw, 0) / rows.length;
  let sse = 0,
    sst = 0;
  for (const p of rows) {
    const t = ((p.angle * Math.PI) / 180) * harmonic;
    sse += (p.reading.valueMw - a - b * Math.cos(t) - c * Math.sin(t)) ** 2;
    sst += (p.reading.valueMw - mean) ** 2;
  }
  const rms = Math.sqrt(sse / rows.length),
    floor = Math.max(
      ...rows.map((p) =>
        Math.max(
          p.reading.resolutionMw,
          3 *
            Math.hypot(
              (p.reading.sampleSdMw || 0) /
                Math.sqrt(p.reading.settings?.averages || 1),
              (p.reading.zero?.sampleSdMw || 0) /
                Math.sqrt(p.reading.zero?.averages || 1),
            ),
        ),
      ),
      3 * rms,
    ),
    minimum = a - amplitude,
    maximum = a + amplitude;
  const resolved = amplitude > floor && a > 0,
    warnings = [];
  if (!resolved)
    warnings.push(
      "Modulation is unresolved; axis and contrast are unavailable.",
    );
  if (!rows.every((p) => p.reading.zero))
    warnings.push(
      "No zero calibration: dark offset contributes to the fitted contrast and extrema.",
    );
  const ratioValid =
    resolved &&
    minimum > floor &&
    rows.every((p) => p.reading.zero) &&
    rms < amplitude * 0.1;
  if (!ratioValid)
    warnings.push(
      "Extinction ratio is unavailable: a zeroed, resolved minimum and a good fit are required.",
    );
  return {
    harmonic,
    coefficients: [a, b, c],
    valid: rows.length,
    excluded: points.length - rows.length,
    rmsMw: rms,
    rSquared: sst > 0 ? 1 - sse / sst : null,
    minimumMw: minimum,
    maximumMw: maximum,
    contrast: resolved ? amplitude / a : null,
    axisDeg: resolved
      ? ((((Math.atan2(c, b) * 180) / Math.PI / harmonic) % (360 / harmonic)) +
          360 / harmonic) %
        (360 / harmonic)
      : null,
    extinctionRatio: ratioValid ? maximum / minimum : null,
    warnings,
  };
}
export function runPolarizationScan(
  project,
  detectorId,
  settings,
  options,
  progress = () => {},
) {
  const base = validateProject(project),
    config = meterConfig(settings);
  const {
    componentId,
    start = 0,
    end = 180,
    count = 37,
    seed = 1,
    zero = null,
  } = options;
  if (config.shutter) throw Error("Open the meter shutter before scanning.");
  const component = base.items.find((x) => x.id === componentId && x.enabled);
  if (!component || !["waveplate", "polarizer"].includes(component.type))
    throw Error("Choose an enabled half-wave plate or analyzer.");
  const harmonic = component.type === "waveplate" ? 4 : 2;
  if (
    harmonic === 4 &&
    Math.abs((((component.retardance % 360) + 360) % 360) - 180) > 1e-6
  )
    throw Error(
      "Waveplate fitting requires 180° retardance (a half-wave plate).",
    );
  if (
    !Number.isFinite(start) ||
    !Number.isFinite(end) ||
    start < -360 ||
    end > 360 ||
    end - start < 360 / harmonic ||
    !Number.isInteger(count) ||
    count < 9 ||
    count > 181 ||
    (end - start) / (count - 1) > 360 / harmonic / 8
  )
    throw Error(
      "Scan at least one full period with 9–181 points and at least eight intervals per period; angles must be within −360° to 360°.",
    );
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483647)
    throw Error("Invalid scan seed.");
  const active = base.items.filter((x) => x.enabled);
  if (
    active.filter((x) => x.type === "source").length !== 1 ||
    active.some((x) => ["mirror", "splitter"].includes(x.type))
  )
    throw Error("Angle scans support a single-source straight optical path.");
  const head = active.find((x) => x.id === detectorId && x.type === "power");
  if (!head) throw Error("Choose an enabled power head.");
  // Restrict the fit to one analyzed polarization train; additional analyzers can introduce extra harmonics.
  const polarizers = active.filter((x) => x.type === "polarizer"),
    plates = active.filter((x) => x.type === "waveplate");
  if (polarizers.length !== 1 || (harmonic === 4 && plates.length !== 1))
    throw Error(
      "Use exactly one analyzer; half-wave scans also require exactly one waveplate.",
    );
  const probe = structuredClone(base);
  for (const item of probe.items) {
    if (item.type === "source") item.power = 1;
    if (item.type === "polarizer") {
      item.leakage = 1;
      item.transmission = 1;
    }
    if (item.type === "waveplate") item.transmission = 1;
  }
  const hit = trace(probe).detectors.find((x) => x.id === detectorId),
    path = hit?.path.map((x) => x.id) || [];
  if (
    !path.includes(componentId) ||
    !path.includes(polarizers[0].id) ||
    (harmonic === 4 &&
      path.indexOf(componentId) > path.indexOf(polarizers[0].id)) ||
    (harmonic === 2 &&
      plates.some((x) => path.indexOf(x.id) > path.indexOf(componentId)))
  )
    throw Error(
      "The scanned optic must illuminate the power head, with the analyzer after all waveplates.",
    );
  const points = [];
  for (let i = 0; i < count; i++) {
    const angle = start + ((end - start) * i) / (count - 1),
      p = structuredClone(base);
    p.items.find((x) => x.id === componentId).axis = angle;
    const reading = readMeter(p, detectorId, config, {
      seed: (seed + i) % 2147483648,
      zero,
    });
    points.push({ angle, reading });
    progress(`${i + 1}/${count} angles`);
  }
  let fit = null,
    fitError = null;
  try {
    fit = fitPolarization(points, harmonic);
  } catch (e) {
    fitError = e.message;
  }
  return {
    format: "optibench-polarization-scan",
    version: 1,
    id: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
    project: base,
    detectorId,
    settings: config,
    options: { componentId, start, end, count, seed, zero },
    component,
    points,
    fit,
    fitError,
    model:
      "Least-squares harmonic fit to quantized meter readings only. Axis is the angle of maximum transmission modulo the fitted period. Contrast and extinction describe the whole optical train. Simulated independent current noise; no hardware calibration. Scan uses a frozen bench copy.",
  };
}
export const scanStore = {
  async access(value) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open("optibench-polarization-scans", 1);
      request.onupgradeneeded = () =>
        request.result.createObjectStore("scans", { keyPath: "id" });
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result,
          tx = db.transaction("scans", value ? "readwrite" : "readonly"),
          r = value
            ? tx.objectStore("scans").put(value)
            : tx.objectStore("scans").getAll();
        tx.oncomplete = () => {
          db.close();
          resolve(r.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error);
        };
      };
    });
  },
  save(value) {
    return this.access(value);
  },
  list() {
    return this.access();
  },
};
