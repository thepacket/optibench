import { makeProject, ENGINE_VERSION } from "./project.js";
import { instantiate } from "./catalog.js";
import { trace } from "./optics.js";
import { checkSampling, samplingHTML } from "./sampling-check.js";
export const solverCoverage = [
  [
    "Gaussian / ABCD",
    "Gaussian sources, ideal thin lenses, plane mirrors, splitters, apertures, filters, polarizers and detectors",
    "Paraxial beam envelopes; no thick-lens prescriptions, aberration or coherent arm recombination.",
  ],
  [
    "Rays",
    "Paraxial ray bundles through thin lenses, mirrors, splitters and stops",
    "Geometric trajectories; not a diffraction point-spread function.",
  ],
  [
    "Fourier",
    "One coherent M² = 1 source; straight parallel lens, aperture, slit, filter and polarizer planes",
    "Scalar sampled field; folded and split paths unsupported. Finite grid is periodic.",
  ],
  [
    "Interferometry",
    "Up to two TEM00 paths from one source; coplanar mirrors, ideal splitters, ND filters and linear polarizers",
    "No lenses, clipped-field diffraction or elevation tilt in folded coherent paths.",
  ],
  [
    "Alignment",
    "Plan-view geometry, mounts, stages and first-order elevation traces",
    "Elevation geometry is separate from coherent propagation; not a full 3D wave solver.",
  ],
  [
    "Measurement reconstruction",
    "Four-phase intensity frames with supplied settings, masks and optional calibration",
    "Accuracy depends on phase steps, sampling, calibration and acquisition conditions. Imported frames are not automatically validated.",
  ],
];
export function runScientificValidation(progress = () => {}) {
  const rows = [];
  const check = (
    id,
    name,
    unit,
    expected,
    tolerance,
    project,
    compute,
    reference,
  ) => {
    progress(name);
    try {
      const computed = compute(project);
      const error = Math.abs(computed - expected);
      rows.push({
        id,
        name,
        unit,
        expected,
        computed,
        error,
        tolerance,
        passed: Number.isFinite(error) && error <= tolerance,
        project,
        reference,
      });
    } catch (e) {
      rows.push({
        id,
        name,
        unit,
        expected,
        tolerance,
        passed: false,
        errorMessage: e.message,
        project,
        reference,
      });
    }
  };
  let p = makeProject("empty");
  p.title = "Validation · free-space Gaussian";
  p.items = [
    instantiate("DESIGN-LASER-532", 1, 100, 450, { waist: 0.6 }),
    instantiate("DESIGN-SCREEN-50", 2, 1100, 450, { terminate: true }),
  ];
  const zR = (Math.PI * 0.6 ** 2) / 532e-6;
  check(
    "gaussian-space",
    "Free-space Gaussian radius",
    "mm",
    0.6 * Math.sqrt(1 + (1000 / zR) ** 2),
    1e-10,
    p,
    (q) => trace(q).detectors[0].radius,
    "w(z)=w₀√(1+(z/zR)²), zR=πw₀²/λ; w₀=0.6 mm, λ=532 nm, z=1000 mm.",
  );
  p = makeProject("empty");
  p.title = "Validation · thin-lens ray focus";
  p.items = [
    instantiate("DESIGN-LASER-532", 1, 100, 450, { waist: 0.5 }),
    instantiate("DESIGN-LENS-25.4-100", 2, 300, 450),
    instantiate("DESIGN-SCREEN-50", 3, 400, 450, { terminate: true }),
  ];
  check(
    "ray-focus",
    "Maximum focal-plane ray offset",
    "mm",
    0,
    1e-7,
    p,
    (q) => {
      const r = trace(q, { rays: true });
      if (r.detectors.length !== 13) throw Error("Expected 13 detected rays.");
      return Math.max(...r.detectors.map((d) => Math.abs(d.offset)));
    },
    "Parallel paraxial rays converge 100 mm after an ideal f=100 mm thin lens.",
  );
  p = makeProject("polarization");
  p.title = "Validation · Malus law";
  check(
    "malus",
    "Transmitted power at 45°",
    "input-power fraction",
    0.5,
    1e-10,
    p,
    (q) =>
      trace(q).detectors[0].power /
      q.items.find((x) => x.type === "source").power,
    "I/I₀=cos²(45°)=0.5 for an ideal linear analyzer.",
  );
  const samplingProject = makeProject("michelson"),
    detectorId = samplingProject.items.find((x) => x.type === "camera").id;
  const sampling = checkSampling(samplingProject, detectorId, progress);
  return {
    format: "optibench-scientific-checks",
    version: 1,
    engine: ENGINE_VERSION,
    createdAt: new Date().toISOString(),
    rows,
    sampling,
    samplingProject,
    solverCoverage,
    evidence:
      "Analytical and synthetic fixtures only. These checks cover named cases, not complete solver correctness. No qualified laboratory dataset is included.",
    samplingInterpretation:
      "Successive grid differences are numerical sensitivity observations. No universal convergence threshold or physical-accuracy claim is applied.",
  };
}
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toExponential(4) : "—");
export function coverageHTML() {
  return `<section class="validation-card"><h2>Solver support and limits</h2><div class="data-scroll"><table><thead><tr><th>Solver</th><th>Supported model</th><th>Limits</th></tr></thead><tbody>${solverCoverage.map((row) => `<tr>${row.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table></div><h3>What counts as evidence?</h3><p><strong>Analytical benchmarks:</strong> known formulas compared with computed output. <strong>Synthetic measurements:</strong> generated intensity frames processed through reconstruction. Both are model checks.</p><p><strong>Imported laboratory frames:</strong> operator-supplied data whose wavelength, phase order, calibration and reference uncertainty require qualification. Importing frames or a historical baseline does not certify physical accuracy. This benchmark suite contains no qualified laboratory dataset.</p></section>`;
}
export function scientificHTML(report) {
  return `<section class="validation-card"><h2>Optical solver checks</h2>${!report ? "<p>Not run. Run all benchmarks to evaluate the prepared optical setups and sampling study.</p>" : `<p>${esc(report.evidence)} Run ${esc(report.createdAt)} · optical engine ${esc(report.engine)}</p><div class="data-scroll"><table><thead><tr><th>Known setup</th><th>Expected</th><th>Computed</th><th>Absolute error</th><th>Allowed error</th><th>Verdict</th></tr></thead><tbody>${report.rows.map((r) => `<tr><td>${esc(r.name)}<br>${esc(r.unit)}</td><td>${fmt(r.expected)}</td><td>${fmt(r.computed)}</td><td>${fmt(r.error)}</td><td>${fmt(r.tolerance)}</td><td>${r.errorMessage ? "ERROR" : r.passed ? "PASS" : "FAIL"}</td></tr><tr><td colspan="6">${esc(r.errorMessage || r.reference)}</td></tr>`).join("")}</tbody></table></div>${samplingHTML(report.sampling)}<p>${esc(report.samplingInterpretation)} Fixed Michelson preset; independent of the current bench.</p><details><summary>Exact optical fixtures and sampling layout</summary><pre>${esc(JSON.stringify({ fixtures: report.rows.map((r) => ({ id: r.id, project: r.project })), samplingProject: report.samplingProject }, null, 2))}</pre></details>`}</section>`;
}
export function validationSummary(results, expectedCount, scientific) {
  const passed = results.filter((x) => x.passed).length,
    failed = results.length - passed,
    missing = Math.max(0, expectedCount - results.length),
    opticalFailed = scientific?.rows.filter((x) => !x.passed).length || 0;
  const samplingComplete =
    scientific?.sampling.rows.length === 3 &&
    scientific.sampling.rows.every((x) => x.status === "complete");
  return {
    status:
      failed || opticalFailed
        ? "Checks failed"
        : missing || !scientific || !samplingComplete
          ? "Incomplete evidence"
          : "All named checks passed",
    reconstructionPassed: passed,
    reconstructionFailed: failed,
    reconstructionNotRun: missing,
    opticalPassed: scientific?.rows.filter((x) => x.passed).length || 0,
    opticalFailed,
    samplingComplete: !!samplingComplete,
    qualifiedLaboratoryDatasets: 0,
  };
}
