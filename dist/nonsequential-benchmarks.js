import { coatingResponse, coatingPreset } from "./ray3-coatings.js";
import { fresnel } from "./ray3-fresnel.js";
import { indexAt } from "./ray3-materials.js";
import {
  rayExample,
  expandedRayExample,
  traceNonsequential,
  groupDetectorPaths,
} from "./nonsequential.js";
export function runRayBenchmarks() {
  const rows = [];
  function check(name, actual, expected, tolerance) {
    rows.push({
      name,
      actual,
      expected,
      tolerance,
      pass: Number.isFinite(actual) && Math.abs(actual - expected) <= tolerance,
    });
  }
  check(
    "Normal-incidence reflectance, n = 1 → 1.5",
    fresnel(1, 1.5, 1).Rs,
    0.04,
    1e-12,
  );
  check(
    "Brewster p reflectance, tan θ = 1.5",
    fresnel(1, 1.5, Math.cos(Math.atan(1.5))).Rp,
    0,
    1e-12,
  );
  check(
    "Total internal reflection at 60°, n = 1.5 → 1",
    fresnel(1.5, 1, 0.5).Rs,
    1,
    1e-12,
  );
  check(
    "SCHOTT N-BK7 index at 587.6 nm",
    indexAt("N-BK7", 587.6),
    1.5168,
    5e-6,
  );
  const scene = rayExample("plate");
  scene.sources[0].waist = 0;
  scene.options = {
    ...scene.options,
    rays: 1,
    maxDepth: 64,
    minPowerFraction: 1e-14,
  };
  scene.objects[0].normal = [1, 0, 0];
  scene.objects[0].material = "ideal15";
  const run = traceNonsequential(scene);
  check(
    "Plate transmission including all retained reflections",
    run.detectors.find((d) => d.id === "detector").power,
    12 / 13,
    1e-12,
  );
  check(
    "First forward ghost power / launched power",
    groupDetectorPaths(run, { detectorId: "detector", reflections: 2 })[0]
      ?.power,
    0.00147456,
    1e-12,
  );
  check(
    "Closed power balance including numerical cutoffs",
    run.ledger.residual,
    0,
    1e-12,
  );
  const lens = rayExample("lens");
  lens.sources[0].waist = 0;
  lens.sources[0].position[1] += 0.001;
  lens.options.rays = 1;
  lens.objects[0].material = "ideal15";
  const result = traceNonsequential(lens),
    h = result.detectorHits.find(
      (h) =>
        h.detectorId === "detector" && !h.path.some((p) => p.event === "R"),
    );
  const focalX =
      h.point[0] - ((h.point[1] - 450) * h.direction[0]) / h.direction[1],
    f = 1 / (0.5 * (2 / 50 - (0.5 * 8) / (1.5 * 50 ** 2))),
    expected = 504 + f * (1 - (0.5 * 8) / (1.5 * 50));
  check("Symmetric thick-lens paraxial focal X · mm", focalX, expected, 1e-4);
  check(
    "Quarter-wave AR reflectance at 550 nm",
    coatingResponse(1, 1.5, 1, 550, coatingPreset("ar")).Rs,
    0,
    1e-12,
  );
  const y = 1.5 * (2.1 / 1.45) ** 8;
  check(
    "Four-pair reflector normal reflectance",
    coatingResponse(1, 1.5, 1, 550, coatingPreset("reflector")).Rs,
    ((1 - y) / (1 + y)) ** 2,
    1e-12,
  );
  scene.objects[0].bulkAlpha = 0.1;
  const attenuated = traceNonsequential(scene),
    a = Math.exp(-0.1 * scene.objects[0].thickness);
  check(
    "Absorbing plate transmission with internal reflections",
    attenuated.detectors.find((d) => d.id === "detector").power,
    (0.96 ** 2 * a) / (1 - 0.04 ** 2 * a * a),
    1e-12,
  );
  const diffuse = expandedRayExample("diffuse");
  diffuse.options.rays = 2048;
  check(
    "Seeded Lambertian collection into 45° cone",
    traceNonsequential(diffuse).detectors[0].power,
    0.4,
    0.025,
  );
  return rows;
}
