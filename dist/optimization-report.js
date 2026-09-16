export const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "—");
export function optimizationPlot(run) {
  const points = run.evaluations.filter((e) => e.valid),
    values = points.map((e) => e.loss);
  if (!points.length) return "";
  const lo = Math.min(...values),
    hi = Math.max(...values),
    span = hi - lo || Math.max(Math.abs(hi) * 0.1, 1e-6),
    x = (e) => 45 + (e.index / Math.max(1, run.evaluations.length - 1)) * 500,
    y = (e) => 180 - ((e.loss - lo) / span) * 150;
  return `<figure><figcaption>Measured loss · lower is better (${run.recipe.goal === "power" ? "negative mW" : "mm"})</figcaption><svg viewBox="0 0 580 220" role="img" aria-label="Measured loss by evaluation"><path d="M45 20V180H555" stroke="#8197aa" fill="none"/>${points.map((e) => `<circle cx="${x(e)}" cy="${y(e)}" r="4" fill="${e.phase.startsWith("verify") ? "#7dccff" : "#b7e97d"}"><title>${esc(e.phase)} · ${e.index + 1}: ${fmt(e.loss)}</title></circle>`).join("")}<text x="45" y="210" fill="currentColor">1</text><text x="440" y="210" fill="currentColor">Evaluation ${run.evaluations.length}</text><text x="48" y="16" fill="currentColor">${fmt(hi)}</text></svg></figure>`;
}
export function optimizationResults(run) {
  if (!run)
    return "<p>Run a procedure to compare the initial bench with a proposed alignment.</p>";
  const v = run.verification;
  return `<h2>${esc(run.name)}</h2><p>${esc(run.status)} · ${run.evaluations.length} evaluations · ${esc(run.stopReason)}</p>${optimizationPlot(run)}<h3>Proposed parameter changes</h3><div class="runbook-table"><table><thead><tr><th>Component / parameter</th><th>Initial</th><th>Proposed</th><th>Change</th></tr></thead><tbody>${run.recipe.variables
    .map((v, i) => {
      const c = run.recipe.project.items.find((c) => c.id === v.componentId),
        unit = ["angle", "axis"].includes(v.field) ? "°" : "mm";
      return `<tr><td>${esc(c.label)} · ${esc(v.field)} (${unit})</td><td>${fmt(c[v.field])}</td><td>${fmt(run.bestValues[i])}</td><td>${fmt(run.bestValues[i] - c[v.field])}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table></div><h3>Fresh measurement verification</h3><p>${esc(v?.outcome || "Not completed")} · ${esc(v?.reason || "Apply remains unavailable until independent verification completes.")}</p>${
    v?.metrics
      ? `<div class="runbook-table"><table><thead><tr><th>Measured quantity</th><th>Baseline mean ± SD</th><th>Candidate mean ± SD</th><th>Candidate SEM</th></tr></thead><tbody>${Object.entries(
          v.metrics,
        )
          .map(
            ([k, m]) =>
              `<tr><td>${esc(k)}</td><td>${fmt(m.baseline.mean)} ± ${fmt(m.baseline.sd)}</td><td>${fmt(m.candidate.mean)} ± ${fmt(m.candidate.sd)}</td><td>${fmt(m.candidate.sem)}</td></tr>`,
          )
          .join(
            "",
          )}</tbody></table></div><p>${v.baseline.n} fresh readings per condition. Loss improvement ${fmt(v.improvement)}; combined SEM ${fmt(v.combinedSem)}.${v.targetMet === null ? "" : ` Target tolerance ${v.targetMet ? "met" : "not met"}.`}</p>`
      : ""
  }<details><summary>Evaluation audit</summary><div class="runbook-table"><table><thead><tr><th># / stage</th><th>Loss</th><th>Acquisition seeds</th><th>Quality</th></tr></thead><tbody>${run.evaluations.map((e) => `<tr><td>${e.index + 1} · ${esc(e.phase)}</td><td>${fmt(e.loss)}</td><td>${e.readings.map((r) => r.seed).join(", ")}</td><td>${esc(e.valid ? "valid" : e.error)}</td></tr>`).join("")}</tbody></table></div></details>`;
}
export function optimizationReport(run) {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>OptiBench alignment report</title><style>body{font:16px system-ui;margin:32px;color:#162333}table{border-collapse:collapse;width:100%}th,td{padding:8px;text-align:left;border-bottom:1px solid #bbb}svg{max-width:680px;width:100%}details{display:block} @media print{details{break-inside:avoid}}</style><h1>Measured alignment report</h1><p>${esc(run.createdAt)} · engine ${esc(run.engine)} · run ${esc(run.id)}</p>${optimizationResults(run).replace("<details>", "<details open>")}<h2>Procedure</h2><pre style="white-space:pre-wrap">${esc(JSON.stringify({ ...run.recipe, project: undefined }, null, 2))}</pre><h2>Method and limits</h2><p>Bounded coordinate search uses measured camera or power-meter data only. Raw frames, meter samples, zero readings, settings and the frozen bench are in the companion run JSON. Search scores select a candidate; fresh interleaved baseline and candidate measurements evaluate it. SD is repeat variability; SEM is the standard error of the mean. This local search does not guarantee a global optimum. Simulated fixed-scene noise excludes drift, unmodeled optics and hardware calibration uncertainty.</p></html>`;
}
