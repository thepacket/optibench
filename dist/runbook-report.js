import { runbookMetrics, sweepFields, summarizeRunbook } from "./runbook.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "—");
const table = (headers, rows) =>
  `<table><thead><tr>${headers.map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
function metric(t) {
  return (
    t.decision.metric ||
    t.decision.criterion?.metric ||
    (t.kind === "camera" ? "diameterXmm" : "valueMw")
  );
}
export function runbookCSV(run) {
  const cell = (v) => {
    let s = String(v ?? "");
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  const rows = [
    [
      "step",
      "point",
      "repeat",
      "sweep_parameter",
      "sweep_value",
      "quantity",
      "value",
      "unit",
      "decision",
      "minimum",
      "maximum",
      "seed",
      "started_at",
      "finished_at",
      "reason",
    ],
    ...run.trials.map((t) => {
      const s = run.recipe.steps.find((s) => s.id === t.stepId),
        m = metric(t);
      return [
        t.label,
        t.index + 1,
        t.repeat + 1,
        s.sweep?.field || "",
        t.value,
        m,
        t.decision.value,
        runbookMetrics[t.kind][m]?.[1] || "",
        t.decision.status,
        s.criterion?.min,
        s.criterion?.max,
        t.seed,
        t.startedAt,
        t.finishedAt,
        t.decision.reason,
      ];
    }),
  ];
  return rows.map((r) => r.map(cell).join(",")).join("\n");
}
export function runbookSweepPlot(run, step) {
  const points = run.trials.filter(
    (t) => t.stepId === step.id && Number.isFinite(t.decision.value),
  );
  if (!step.sweep || !points.length) return "";
  const values = points.map((t) => t.decision.value),
    bounds = [step.criterion?.min, step.criterion?.max].filter(Number.isFinite),
    loY = Math.min(...values, ...bounds),
    hiY = Math.max(...values, ...bounds),
    loX = Math.min(step.sweep.start, step.sweep.end),
    hiX = Math.max(step.sweep.start, step.sweep.end),
    x = (v) => 60 + ((v - loX) / (hiX - loX)) * 570,
    y = (v) => 180 - ((v - loY) / (hiY - loY || 1)) * 150,
    m = metric(points[0]);
  return `<figure><figcaption>${esc(step.label)} · measured sweep. Invalid acquisitions omitted.</figcaption><svg viewBox="0 0 680 235" role="img" aria-label="${esc(step.label)} measured sweep"><path d="M60 25V180H635" fill="none" stroke="currentColor"/>${bounds.map((v) => `<path d="M60 ${y(v)}H635" stroke="#66894e" stroke-dasharray="5 4"/>`).join("")}${points.map((t) => `<circle cx="${x(t.value)}" cy="${y(t.decision.value)}" r="4" fill="${t.decision.status === "fail" ? "#bd554b" : "#2885ad"}"/>`).join("")}<g fill="currentColor" font-size="11"><text x="60" y="16">${esc(runbookMetrics[step.kind][m]?.[0] || m)} · ${esc(runbookMetrics[step.kind][m]?.[1] || "")} · ${fmt(loY)} to ${fmt(hiY)}</text><text x="60" y="200">${fmt(loX)}</text><text x="590" y="200">${fmt(hiX)}</text><text x="240" y="224">${esc(step.sweep.field)} · ${esc(sweepFields[step.sweep.field].unit)} · dashed: limits</text></g></svg></figure>`;
}
export function runbookReport(run, comparison = null) {
  if (run?.format !== "optibench-runbook-run")
    throw Error("Choose a recorded run.");
  const summary = summarizeRunbook(run);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(run.name)} · OptiBench</title><style>body{font:15px system-ui,sans-serif;color:#17232b;max-width:1100px;margin:35px auto;padding:0 24px;line-height:1.5}table{border-collapse:collapse;width:100%;font-size:11px;margin:16px 0}th,td{border:1px solid #a9b9c3;padding:7px;text-align:left;overflow-wrap:anywhere}th{background:#edf3f5}h2{margin-top:28px}p{overflow-wrap:anywhere}.notes{white-space:pre-wrap}figure{margin:20px 0;break-inside:avoid}svg{width:100%;max-height:260px}pre{white-space:pre-wrap;font-size:12px}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}h2{break-after:avoid}}</style></head><body><h1>${esc(run.name)}</h1><p>OptiBench · simulated experiment run</p><p>Record ${esc(run.id)} · ${esc(run.createdAt)} to ${esc(run.finishedAt)} · engine ${esc(run.engine)}</p><h2>Outcome: ${esc(summary.outcome)}</h2><p>Execution ${esc(run.status)} · ${summary.recorded}/${summary.expected} acquisitions retained · ${summary.pass} passed · ${summary.fail} failed · ${summary.inconclusive} inconclusive · ${summary.error} acquisition errors · ${summary.measured} without limits</p><p class="notes">${esc(run.recipe.notes)}</p><h2>Recorded procedure</h2><p>Bench ${esc(run.recipe.project.title)} · noise seed ${run.recipe.seed} · stop on failure/inconclusive: ${run.recipe.stopOnFailure ? "yes" : "no"}</p>${table(
    [
      "Step",
      "Instrument",
      "Detector",
      "Repeats / point",
      "Sweep",
      "Acceptance",
    ],
    run.recipe.steps.map((s) => [
      s.label,
      s.kind,
      s.detectorId,
      s.repeats,
      s.sweep
        ? `${s.sweep.field}: ${s.sweep.start} to ${s.sweep.end} ${sweepFields[s.sweep.field].unit} (${s.sweep.count} points)`
        : "none",
      s.criterion
        ? `${runbookMetrics[s.kind][s.criterion.metric][0]}: ${s.criterion.min ?? "unbounded"} to ${s.criterion.max ?? "unbounded"} ${runbookMetrics[s.kind][s.criterion.metric][1]}`
        : "not evaluated",
    ]),
  )}${run.recipe.steps.map((s) => `<details open><summary>${esc(s.label)} · settings</summary><pre>${esc(JSON.stringify(s.settings, null, 2))}</pre><p>${s.autoExposure ? "Automatic exposure enabled. Final exposure is recorded per acquisition." : ""}${s.kind === "power" ? (s.captureZero ? " A new shutter-closed zero precedes each reading." : " No zero calibration requested.") : ""}</p></details>`).join("")}<h2>Measured results</h2>${table(
    [
      "Step / point / repeat",
      "Sweep value",
      "Measured quantity",
      "Value",
      "Decision",
      "Reason",
    ],
    run.trials.map((t) => {
      const m = metric(t),
        s = run.recipe.steps.find((s) => s.id === t.stepId);
      return [
        `${t.label} / ${t.index + 1} / ${t.repeat + 1}`,
        t.value === null
          ? "—"
          : `${fmt(t.value)} ${sweepFields[s.sweep.field].unit}`,
        runbookMetrics[t.kind][m]?.[0] || m,
        `${fmt(t.decision.value)} ${runbookMetrics[t.kind][m]?.[1] || ""}`,
        t.decision.status,
        t.decision.reason,
      ];
    }),
  )}${run.recipe.steps.map((s) => runbookSweepPlot(run, s)).join("")}<h2>Acquisition provenance</h2>${table(
    [
      "Step / point / repeat",
      "Seed",
      "Acquired",
      "Exposure / range",
      "Quality",
    ],
    run.trials.map((t) => [
      `${t.label} / ${t.index + 1} / ${t.repeat + 1}`,
      t.seed,
      t.measurement?.acquiredAt || t.finishedAt,
      t.kind === "camera"
        ? `${t.measurement?.settings.exposure ?? "—"} ms`
        : `${t.measurement?.settings.rangeMw ?? "—"} mW`,
      t.error ||
        (
          t.measurement?.analysis?.warnings ||
          t.measurement?.warnings ||
          []
        ).join("; "),
    ]),
  )}${
    comparison
      ? `<h2>Matched-run comparison</h2><p>${esc(comparison.baselineId)} → ${esc(comparison.currentId)}</p>${table(
          [
            "Acquisition",
            "Baseline",
            "Current",
            "Difference",
            "Decision change",
          ],
          comparison.rows.map((r) => [
            `${r.label} / ${r.index + 1} / ${r.repeat + 1}`,
            `${fmt(r.baseline)} ${r.unit}`,
            `${fmt(r.current)} ${r.unit}`,
            `${fmt(r.delta)} ${r.unit}`,
            `${r.before} → ${r.after}`,
          ]),
        )}<p>${esc(comparison.warnings.join(" "))}</p><p>${esc(comparison.note)}</p>`
      : ""
  }<h2>Execution log</h2>${table(
    ["Time", "Event"],
    run.events.map((e) => [e.at, e.message]),
  )}<h2>Method and limitations</h2><p>Acceptance decisions use recorded camera analyses or indicated meter readings. Bounds are inclusive. Invalid or overloaded measurements are inconclusive; a missing criterion never counts as a pass.</p><p>Simulation uses fixed bench snapshots and seeded instrument noise. It does not establish hardware accuracy or reproduce unmodeled drift, mechanical hysteresis or calibration errors. Keep the complete run JSON for raw camera pixels, backgrounds, power samples, zero acquisitions and bench snapshots.</p>${run.reviewNote ? `<p>${esc(run.reviewNote)}</p>` : ""}</body></html>`;
}
