import { makeProject, validateProject } from "./project.js";
import { coherentField } from "./interferometry.js";
import { cameraResponse } from "./wave.js";
import { analyzeMeasurement, defaultMeasurementSettings } from "./metrology.js";
import { serializable } from "./run-store.js";

export const INSTRUMENT_VERSION = "1.0.0";
export function instrumentSetup() {
  const p = makeProject("michelson");
  p.title = "Michelson instrument experiment";
  return p;
}
// A square, unbinned central ROI: one computed sample per physical camera pixel.
export function acquireInstrument(project, { seed, n = 256 } = {}) {
  if (!Number.isInteger(seed) || seed < 0 || seed > 2147483643)
    throw Error("Invalid acquisition noise seed.");
  if (![64, 128, 256, 512].includes(n)) throw Error("Unsupported camera ROI.");
  const p = validateProject(project);
  const camera = p.items.find((c) => c.type === "camera" && c.enabled);
  if (!camera || camera.pixelsX < n || camera.pixelsY < n)
    throw Error(
      "Choose an enabled camera that can contain the native-pixel ROI.",
    );
  const width = (n * camera.pixelPitch) / 1000;
  const field = coherentField(p, camera.id, { n, width });
  if (field.paths.length !== 2)
    throw Error("Both coherent arms must reach the camera.");
  const originX = Math.floor((camera.pixelsX - n) / 2),
    originY = Math.floor((camera.pixelsY - n) / 2);
  const offsetX =
    ((originX + (n - camera.pixelsX) / 2) * camera.pixelPitch) / 1000;
  const offsetY =
    ((originY + (n - camera.pixelsY) / 2) * camera.pixelPitch) / 1000;
  const roiCamera = { ...camera, pixelsX: n, pixelsY: n };
  const dx = width / n,
    frames = [],
    saturated = [];
  for (let phase = 0; phase < 4; phase++) {
    const power = new Float64Array(n * n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++)
        power[y * n + x] =
          field.at(
            (x + 0.5 - n / 2) * dx + offsetX,
            (y + 0.5 - n / 2) * dx + offsetY,
            (phase * Math.PI) / 2,
          ).intensity *
          dx *
          dx;
    const response = cameraResponse(
      power,
      n,
      width,
      roiCamera,
      field.wavelength,
      { seed: seed + phase, noise: true },
    );
    saturated.push(
      response.values.reduce((count, v) => count + (v >= 1), 0) / (n * n),
    );
    frames.push({
      name: `Camera phase ${phase * 90}°`,
      width: n,
      height: n,
      values: response.values,
      origin: "Simulated camera · native central ROI",
      precision: `${camera.bits}-bit ADC`,
      fullScale: 2 ** camera.bits - 1,
    });
  }
  const settings = {
    ...defaultMeasurementSettings(),
    n,
    pixelUm: camera.pixelPitch,
    wavelength: field.wavelength,
  };
  let result = null,
    analysisError = null;
  try {
    result = analyzeMeasurement(frames, settings);
  } catch (e) {
    analysisError = e.message;
  }
  const now = new Date().toISOString();
  return serializable({
    format: "optibench-measurement",
    version: 1,
    id: crypto.randomUUID(),
    acquisitionId: crypto.randomUUID(),
    createdAt: now,
    acquiredAt: now,
    name: `Michelson · ${now}`,
    notes:
      "Synthetic camera acquisition. Ideal calibrated 0/90/180/270 degree reference-arm phase steps; fixed scene during acquisition. No drift or phase-actuator error. Native central ROI; pixel-centre irradiance approximation, no pixel-area integration. Camera parameters are model assumptions, not vendor calibration. Relative OPD reconstruction removes piston and tilt.",
    project: p,
    frames,
    dark: null,
    flat: null,
    settings,
    result,
    simulation: {
      instrumentLab: true,
      version: INSTRUMENT_VERSION,
      seed,
      phaseSeeds: [seed, seed + 1, seed + 2, seed + 3],
      camera: { ...camera },
      roi: { n, widthMm: width, originX, originY },
      phaseStepsRad: [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2],
      readout:
        "Physical irradiance → pixel photoelectrons → shot/dark/read noise → full well → gain → ADC. No per-frame normalization.",
      conditions: JSON.stringify({ project: p, n }),
      saturated,
      analysisError,
      truth: {
        opdNm: field.opd * 1e6,
        coherence: field.coherence,
        fringePeriodMm: field.carrier > 0 ? 1 / field.carrier : null,
      },
    },
  });
}
