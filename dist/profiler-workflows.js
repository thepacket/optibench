import { acquireBeamProfile } from "./beam-profiler.js";

export function autoExposeProfile(project, settings, progress = () => {}) {
  let exposure =
    settings.exposure ??
    project.items.find((c) => c.id === settings.detectorId)?.exposure ??
    1;
  const attempts = [];
  let record;
  for (let i = 0; i < 8; i++) {
    exposure = Math.max(0.001, Math.min(10000, exposure));
    record = acquireBeamProfile(project, {
      ...settings,
      exposure,
      seed: ((settings.seed ?? 1) + i * 32) % 2147482000,
    });
    const peak = record.frame.values.reduce((m, v) => Math.max(m, v), 0),
      ceiling = Math.min(1, record.camera.gain),
      target = 0.6 * ceiling;
    const clipped = record.frame.saturated > 0 || peak >= 1;
    attempts.push({ exposure, peak, clipped, seed: record.settings.seed });
    progress(`Exposure trial ${i + 1}/8 · ${exposure.toPrecision(4)} ms`);
    if (!clipped && peak >= target * 0.85 && peak <= target * 1.15) {
      record.autoExposure = { converged: true, target, attempts };
      return record;
    }
    const next = Math.max(
      0.001,
      Math.min(
        10000,
        exposure *
          (clipped
            ? 0.2
            : Math.max(0.1, Math.min(10, target / Math.max(peak, 1e-6)))),
      ),
    );
    if (next === exposure) break;
    exposure = next;
  }
  record.autoExposure = {
    converged: false,
    attempts,
    reason:
      "Target not reached within exposure limits or eight trials. Inspect the frame and acquisition warnings.",
  };
  return record;
}

export function centerProfileROI(record) {
  if (!record?.analysis)
    throw Error("Acquire a measurable beam before centering the ROI.");
  const { camera, frame, roi, analysis } = record,
    pitch = camera.pixelPitch / 1000;
  const originX = Math.max(
    0,
    Math.min(
      camera.pixelsX - frame.n,
      roi.originX + Math.round(analysis.centroidXmm / pitch),
    ),
  );
  const originY = Math.max(
    0,
    Math.min(
      camera.pixelsY - frame.n,
      roi.originY + Math.round(analysis.centroidYmm / pitch),
    ),
  );
  return {
    roiX: originX - Math.floor((camera.pixelsX - frame.n) / 2),
    roiY: originY - Math.floor((camera.pixelsY - frame.n) / 2),
    n: frame.n,
  };
}

export function summarizeProfileRepeats(records) {
  const valid = records.filter((r) => r.analysis?.valid),
    metrics = {};
  if (valid.length >= 3)
    for (const key of [
      "diameterXmm",
      "diameterYmm",
      "sensorCentroidXmm",
      "sensorCentroidYmm",
    ]) {
      const values = valid.map(
        (r) =>
          r.analysis[key] ??
          (key === "sensorCentroidXmm"
            ? r.analysis.centroidXmm + r.roi.offsetXmm
            : r.analysis.centroidYmm + r.roi.offsetYmm),
      );
      const mean = values.reduce((a, b) => a + b, 0) / values.length,
        sd = Math.sqrt(
          values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1),
        );
      metrics[key] = {
        mean,
        sd,
        sem: sd / Math.sqrt(values.length),
        min: Math.min(...values),
        max: Math.max(...values),
      };
    }
  return {
    valid: valid.length,
    excluded: records.length - valid.length,
    metrics,
    error:
      valid.length < 3
        ? "At least three valid profiles are needed for repeatability statistics."
        : null,
    model:
      "Sample standard deviation and standard error from independent camera/background acquisitions of a fixed scene. Random repeatability only; no alignment drift, pixel calibration uncertainty or systematic accuracy estimate.",
  };
}
export function repeatBeamProfile(
  project,
  settings,
  count = 5,
  progress = () => {},
) {
  if (![3, 5, 10].includes(count) || settings.n > 256)
    throw Error("Choose 3, 5 or 10 repeats with an ROI up to 256 pixels.");
  const records = [];
  for (let i = 0; i < count; i++) {
    records.push(
      acquireBeamProfile(project, {
        ...settings,
        seed: ((settings.seed ?? 1) + i * 32) % 2147482000,
      }),
    );
    progress(`${i + 1}/${count} repeated frames`);
  }
  return {
    format: "optibench-beam-repeat",
    version: 1,
    id: crypto.randomUUID(),
    acquiredAt: new Date().toISOString(),
    project: records[0].project,
    settings: { ...records[0].settings, detectorId: settings.detectorId },
    count,
    records,
    summary: summarizeProfileRepeats(records),
  };
}
export function profileFrames(record) {
  return record?.format === "optibench-beam-scan"
    ? record.points.map((p) => p.record)
    : record?.format === "optibench-beam-repeat"
      ? record.records
      : record
        ? [record]
        : [];
}
