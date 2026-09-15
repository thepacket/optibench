import { comparisonMetrics } from "./study-comparison.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
function plot(c, key, label) {
  if (!c.compatible || (key === "intensity" && !c.intensityComparable))
    return `<h3>${label}</h3><p>Overlay unavailable because these results are not directly comparable.</p>`;
  const all = [...c.seriesA, ...c.seriesB].filter(
    (r) => r.status === "complete" && Number.isFinite(r[key]),
  );
  if (!all.length) return `<h3>${label}</h3><p>No shared display data.</p>`;
  const low = Math.min(...all.map((r) => r[key])),
    high = Math.max(...all.map((r) => r[key])),
    xs = c.seriesA.map((r) => r.value),
    xmin = Math.min(...xs),
    xmax = Math.max(...xs);
  const path = (series) => {
    let d = "",
      connect = false;
    for (const r of series) {
      if (r.status !== "complete" || !Number.isFinite(r[key])) {
        connect = false;
        continue;
      }
      d +=
        (connect ? " L" : " M") +
        (55 + ((r.value - xmin) / (xmax - xmin || 1)) * 580).toFixed(2) +
        "," +
        (160 - ((r[key] - low) / (high - low || 1)) * 125).toFixed(2);
      connect = true;
    }
    return d;
  };
  return `<article><h3>${label}</h3><svg viewBox="0 0 700 215" role="img" aria-label="${label}: A solid, B dashed" style="width:100%;background:#101c28"><path d="M55 20V170H650" fill="none" stroke="#789"/><path d="${path(c.seriesA)}" stroke="#bdf18b" stroke-width="3" fill="none"/><path d="${path(c.seriesB)}" stroke="#70bdff" stroke-width="2" stroke-dasharray="6 4" fill="none"/><g fill="#dce7ee" font-size="12"><text x="55" y="200">${fmt(xmin)} → ${fmt(xmax)} · ${esc(c.a.config.parameter)}</text><text x="55" y="20">${fmt(low)} → ${fmt(high)}</text></g></svg></article>`;
}
export function comparisonHTML(c) {
  if (!c)
    return "<p>Select A and B from saved sweep revisions, then compare. Both are recomputed first.</p>";
  return `<h3>${c.compatible ? "Compatible sweep grid and analysis settings" : "Not directly comparable"}</h3><p><b>A · ${esc(c.a.title)} / ${esc(c.a.revisionName)}</b> (solid green)<br><b>B · ${esc(c.b.title)} / ${esc(c.b.revisionName)}</b> (dashed blue)</p>${[...c.issues, ...c.warnings].map((w) => `<p>${esc(w)}</p>`).join("")}<div class="validation-cards">${comparisonMetrics.map(([k, label]) => plot(c, k, label)).join("")}</div><h3>Point comparison · Δ = B − A</h3><p>Failed cases stay visible and create gaps; no interpolation or automatic ranking is applied.</p><div class="measurement-table-scroll"><table><thead><tr><th>Value A / B</th><th>Status A / B</th>${comparisonMetrics.map(([, l]) => `<th>${l}<small>A / B / Δ</small></th>`).join("")}</tr></thead><tbody>${c.rows.map((r) => `<tr><td>${fmt(r.valueA)} / ${fmt(r.valueB)}</td><td>${esc(r.errorA || r.statusA)} / ${esc(r.errorB || r.statusB)}</td>${comparisonMetrics.map(([k]) => `<td>${fmt(r.a[k])} / ${fmt(r.b[k])} / ${fmt(r.deltas[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div><h3>Bench changes</h3><div class="measurement-table-scroll"><table><thead><tr><th>Component / setting</th><th>A</th><th>B</th></tr></thead><tbody>${c.changes.map((r) => `<tr><td>${esc(r.path)}</td><td>${esc(JSON.stringify(r.a))}</td><td>${esc(JSON.stringify(r.b))}</td></tr>`).join("")}</tbody></table>${c.changes.length ? "" : "<p>No recorded bench differences.</p>"}</div><details><summary>Revision links and reproducibility</summary><pre>${esc(JSON.stringify({ a: c.a, b: c.b, recomputation: c.recomputation }, null, 2))}</pre></details>`;
}
