import { profileFrames } from "./profiler-workflows.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "Unavailable");
function table(headers, rows) {
  return `<table><thead><tr>${headers.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
function profilePlot(r, axis) {
  const a = r.analysis,
    fit = axis === "x" ? a?.fitX : a?.fitY;
  if (!a) return "";
  const data = a.profiles[axis],
    n = data.length,
    all = [...data, ...(fit?.fitted || [])],
    lo = Math.min(0, ...all),
    hi = Math.max(...all),
    x = (i) => 35 + (i / (n - 1)) * 580,
    y = (v) => 190 - ((v - lo) / (hi - lo || 1)) * 155,
    points = (values) => values.map((v, i) => `${x(i)},${y(v)}`).join(" ");
  return `<figure><figcaption>${axis.toUpperCase()} integrated profile: blue measured, green Gaussian fit. Residual RMS ${fmt(fit?.rms)} normalized ADC.</figcaption><svg viewBox="0 0 650 230" role="img" aria-label="${axis} beam profile"><path d="M35 25V190H615" fill="none" stroke="#777"/><polyline points="${points(data)}" stroke="#1675b8" fill="none"/>${fit ? `<polyline points="${points(fit.fitted)}" stroke="#397c17" fill="none"/>` : ""}<text x="35" y="215">${fmt(-r.roi.widthMm / 2)} to ${fmt(r.roi.widthMm / 2)} mm · ROI position</text></svg></figure>`;
}
export function profilerReport(
  record,
  { selectedFrame = 0, imageData = null, comparison = null } = {},
) {
  const frames = profileFrames(record),
    r = frames[selectedFrame];
  if (!r) throw Error("Choose a recorded acquisition for the report.");
  const scan = record.format === "optibench-beam-scan",
    repeat = record.format === "optibench-beam-repeat";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(record.name || "OptiBench camera laboratory report")}</title><style>body{font:15px system-ui,sans-serif;color:#17232b;max-width:1000px;margin:40px auto;padding:0 24px;line-height:1.5}h1{font-size:27px}h2{margin-top:28px}table{width:100%;border-collapse:collapse;font-size:12px;margin:15px 0}th,td{text-align:left;border:1px solid #abb9c1;padding:7px}th{background:#eef3f6}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.warning{border-left:3px solid #aa7216;padding-left:12px}figure{margin:15px 0;break-inside:avoid}svg{width:100%;max-height:220px}img{width:320px;max-width:100%}.notes{white-space:pre-wrap}@media print{body{margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}}</style></head><body><h1>${esc(record.name || "OptiBench camera laboratory report")}</h1><p>Simulated optical experiment · ${esc(record.acquiredAt)}</p><p>Record: ${esc(record.id)}${record.sourceId ? " · imported from " + esc(record.sourceId) : ""}</p>${record.notes ? `<h2>Experiment notes</h2><p class="notes">${esc(record.notes)}</p>` : ""}<h2>Recorded conditions</h2><p>${esc(record.project.title)} · ${esc(r.camera.label)} · displayed frame ${selectedFrame + 1} of ${frames.length}</p>${table(["Exposure · ms", "Pixel pitch · µm", "ROI · pixels", "ROI origin · pixels", "Dark average · frames", "Noise seed"], [[r.settings.exposure, r.camera.pixelPitch, r.frame.n + " × " + r.frame.n, r.roi.originX + ", " + r.roi.originY, r.settings.backgroundFrames, r.settings.seed]])}<p>QE ${esc(r.camera.qe)} · read noise ${esc(r.camera.readNoise)} e⁻ RMS · full well ${esc(r.camera.fullWell)} e⁻ · ADC ${esc(r.camera.bits)} bits · gain ${esc(r.camera.gain)}</p><h2>Frame measurements</h2>${table(
    [
      scan ? "Travel · mm" : "Frame",
      "D4σ X · mm",
      "D4σ Y · mm",
      "Centroid X · mm (sensor)",
      "Centroid Y · mm (sensor)",
      "Quality",
    ],
    frames.map((f, i) => [
      scan ? record.points[i].positionMm : i + 1,
      fmt(f.analysis?.diameterXmm),
      fmt(f.analysis?.diameterYmm),
      fmt(
        f.analysis?.sensorCentroidXmm ??
          (f.analysis ? f.analysis.centroidXmm + f.roi.offsetXmm : NaN),
      ),
      fmt(
        f.analysis?.sensorCentroidYmm ??
          (f.analysis ? f.analysis.centroidYmm + f.roi.offsetYmm : NaN),
      ),
      f.analysis?.valid ? "Passed" : "Flagged",
    ]),
  )}${frames.map((f, i) => [...(f.analysis?.warnings || []), ...f.warnings, ...(f.analysisError ? [f.analysisError] : [])].map((w) => `<p class="warning">Frame ${i + 1}: ${esc(w)}</p>`).join("")).join("")}${imageData && /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(imageData) ? `<figure><img alt="Selected background-subtracted camera frame" src="${imageData}"><figcaption>Selected frame display is autoscaled; analysis uses original ADC values.</figcaption></figure>` : ""}${profilePlot(r, "x")}${profilePlot(r, "y")}${
    repeat
      ? `<h2>Repeatability</h2><p>${record.summary.valid} valid / ${record.summary.excluded} excluded frames</p>${table(
          ["Quantity · mm", "Mean", "Sample SD", "Standard error"],
          Object.entries(record.summary.metrics).map(([k, v]) => [
            k,
            fmt(v.mean),
            fmt(v.sd),
            fmt(v.sem),
          ]),
        )}<p>${esc(record.summary.error || "")}</p><p>${esc(record.summary.model)}</p>`
      : ""
  }${
    scan
      ? `<h2>Propagation fit</h2>${table(
          [
            "Axis",
            "Waist radius · mm",
            "Waist travel · mm",
            "Half-angle · mrad",
            "Fitted / excluded",
          ],
          ["x", "y"].map((axis) => {
            const f = record.fits[axis];
            return [
              axis,
              fmt(f?.waistRadiusMm),
              fmt(f?.waistPositionMm),
              fmt(f?.halfAngleMrad),
              f ? f.valid + " / " + f.excluded : record.errors[axis],
            ];
          }),
        )}${["x", "y"]
          .map((axis) => {
            const f = record.fits[axis];
            return f?.uncertainty
              ? `<p>${axis.toUpperCase()} approximate 95% intervals: radius ${f.uncertainty.waistRadiusMm.ci95.map(fmt).join(" to ")} mm; position ${f.uncertainty.waistPositionMm.ci95.map(fmt).join(" to ")} mm; half-angle ${f.uncertainty.halfAngleMrad.ci95.map(fmt).join(" to ")} mrad.</p><p>${esc(f.uncertainty.method)}</p>`
              : "";
          })
          .join("")}<p>${esc(record.model)}</p>`
      : ""
  }${
    comparison
      ? `<h2>Saved-run comparison</h2><p>Baseline ${esc(comparison.baselineId)} → current ${esc(comparison.currentId)}</p>${table(
          ["Quantity", "Unit", "Baseline", "Current", "Difference"],
          comparison.rows.map((v) => [
            v.label,
            v.unit,
            fmt(v.baseline),
            fmt(v.current),
            fmt(v.delta),
          ]),
        )}<p>${esc(comparison.conditions.join("; "))}</p><p>${esc(comparison.note)}</p>`
      : ""
  }<h2>Recorded optical bench</h2>${table(
    ["Component", "Part", "X / Y · mm", "Angle · °", "Enabled"],
    record.project.items.map((c) => [
      c.label,
      c.part,
      c.x + " / " + c.y,
      c.angle,
      c.enabled ? "yes" : "no",
    ]),
  )}<h2>Method and limitations</h2><p>${esc(r.model)}</p><p>Save the complete JSON alongside this report to retain raw pixels, backgrounds and bench snapshots. This report does not certify hardware performance or standards compliance.</p><p>Definitions: <a href="https://www.rp-photonics.com/beam_radius.html">beam radius</a>. Statistical method: <a href="https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-appendix-law-propagation-uncertainty">NIST first-order uncertainty propagation</a>.</p></body></html>`;
}
