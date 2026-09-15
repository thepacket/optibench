import { coherentField } from "./interferometry.js";
import { validateProject } from "./project.js";
import { analyzeMeasurement, defaultMeasurementSettings } from "./metrology.js";
import { seededRandom, normalRandom } from "./optics.js";
import { serializable } from "./run-store.js";
export const SIMULATION_VERSION = "1.0.0";
export function simulateRuns(project, config) {
  const base = validateProject(project),
    { parameter, detectorId, mirrorId, start, end, count, seed } = config;
  if (
    !["piston", "angle", "exposure", "noise"].includes(parameter) ||
    !Number.isInteger(count) ||
    count < 2 ||
    count > 12 ||
    ![start, end].every(Number.isFinite) ||
    !Number.isInteger(seed) ||
    seed < 0 ||
    seed > 2147483647
  )
    throw Error("Choose a valid parameter, 2–12 points and integer seed.");
  const limits = {
    piston: [-10000, 10000],
    angle: [-0.1, 0.1],
    exposure: [0.05, 4],
    noise: [0, 0.05],
  }[parameter];
  if (
    start < limits[0] ||
    start > limits[1] ||
    end < limits[0] ||
    end > limits[1] ||
    start === end
  )
    throw Error(`Distinct sweep endpoints must lie in ${limits.join(" to ")}.`);
  if (
    ["piston", "angle"].includes(parameter) &&
    !base.items.some((c) => c.id === mirrorId && c.type === "mirror")
  )
    throw Error("Choose an arm mirror.");
  const n = 128,
    reference = coherentField(base, detectorId, { n });
  if (reference.paths.length !== 2)
    throw Error("Select a detector with two coherent paths.");
  let scale = 0;
  for (let i = 0; i < n * n; i++)
    for (let j = 0; j < 4; j++)
      scale = Math.max(
        scale,
        reference.at(
          (((i % n) + 0.5 - n / 2) * reference.width) / n,
          ((Math.floor(i / n) + 0.5 - n / 2) * reference.width) / n,
          (j * Math.PI) / 2,
        ).intensity,
      );
  if (scale <= 0) throw Error("No incident intensity.");
  const id = crypto.randomUUID(),
    createdAt = new Date().toISOString(),
    rows = [];
  for (let k = 0; k < count; k++) {
    const value = start + ((end - start) * k) / (count - 1),
      p = structuredClone(base),
      mirror = p.items.find((c) => c.id === mirrorId);
    if (parameter === "piston") mirror.pistonNm = value;
    if (parameter === "angle") mirror.angle += value;
    const provenance = {
      version: SIMULATION_VERSION,
      studyId: id,
      parameter,
      value,
      index: k,
      seed,
      phaseSeeds: [seed, seed + 1, seed + 2, seed + 3],
      normalizationPeak: scale,
      detectorId,
      mirrorId,
      n,
      widthMm: reference.width,
      readout:
        "Fixed normalization: 0.02 + 0.9 × relative exposure × irradiance / base peak, plus Gaussian intensity noise, clipped [0,1]. Not a calibrated camera.",
      exposureMultiplier: parameter === "exposure" ? value : 1,
      noiseSigma: parameter === "noise" ? value : 0,
    };
    let capturedFrames = null;
    try {
      validateProject(p);
      const field = coherentField(p, detectorId, { n, width: reference.width });
      if (field.paths.length !== 2) throw Error("Sweep loses a coherent arm.");
      const ideal = [],
        frames = [];
      for (let j = 0; j < 4; j++) {
        const rng = seededRandom(seed + j),
          truth = new Float64Array(n * n),
          values = new Float64Array(n * n);
        for (let i = 0; i < n * n; i++) {
          const intensity = field.at(
            (((i % n) + 0.5 - n / 2) * reference.width) / n,
            ((Math.floor(i / n) + 0.5 - n / 2) * reference.width) / n,
            (j * Math.PI) / 2,
          ).intensity;
          truth[i] = Math.max(0, Math.min(1, 0.02 + (0.9 * intensity) / scale));
          values[i] = Math.max(
            0,
            Math.min(
              1,
              0.02 +
                (0.9 * provenance.exposureMultiplier * intensity) / scale +
                provenance.noiseSigma * normalRandom(rng),
            ),
          );
        }
        const f = {
          name: `Sweep ${k + 1} · ${j * 90}°`,
          width: n,
          height: n,
          origin: "Simulated controlled acquisition",
        };
        ideal.push({ ...f, values: truth });
        frames.push({ ...f, values });
      }
      capturedFrames = frames;
      const settings = {
          ...defaultMeasurementSettings(),
          n,
          pixelUm: (reference.width / n) * 1000,
          wavelength: field.wavelength,
        },
        r = analyzeMeasurement(frames, settings),
        expected = analyzeMeasurement(ideal, settings);
      let error = 0,
        valid = 0;
      for (let i = 0; i < n * n; i++)
        if (r.mask[i] && expected.mask[i]) {
          error += (r.height[i] - expected.height[i]) ** 2;
          valid++;
        }
      const center = (n / 2) * n + n / 2,
        intensity = frames[0].values[center],
        visibility = r.stats.meanVisibility;
      const run = {
        format: "optibench-measurement",
        version: 1,
        id: crypto.randomUUID(),
        acquisitionId: crypto.randomUUID(),
        createdAt,
        acquiredAt: null,
        name: `${parameter} = ${value.toPrecision(5)}`,
        notes:
          "Controlled synthetic sweep. Different sweep values are different conditions, not repeat acquisitions. Piston/tilt removed from reconstructed height; use first-frame intensity to observe piston fringes.",
        frames,
        dark: null,
        flat: null,
        settings,
        project: p,
        result: r,
        simulation: provenance,
      };
      rows.push({
        value,
        status: "complete",
        intensity,
        visibility,
        pvNm: r.stats.pvNm,
        rmsNm: r.stats.rmsNm,
        errorRMSNm: valid ? Math.sqrt(error / valid) : null,
        errorOverlap: valid / (n * n),
        validFraction: r.stats.validFraction,
        warnings: r.warnings,
        run,
      });
    } catch (e) {
      rows.push({
        value,
        status: "failed",
        error: e.message,
        frames: capturedFrames,
        project: p,
        simulation: provenance,
      });
    }
  }
  return serializable({
    format: "optibench-simulation-study",
    version: 1,
    id,
    createdAt,
    config,
    baseProject: base,
    rows,
    notes: [
      "One parameter changes per case. The active bench is unchanged.",
      "The same per-phase seeds are reused across sweep points to isolate parameter effects; these are not independent repeated acquisitions.",
      "Error RMS compares against ideal readout for the same modified bench over shared valid pixels after each reconstruction removes its own plane. This is a model comparison, not physical accuracy.",
      "The fixed base normalization is shared across cases; exposure/noise are normalized-intensity controls, not hardware specifications.",
    ],
  });
}
