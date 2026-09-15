import { simulateRuns } from "./simulation-runs.js";
export function checkSampling(project, detectorId, onProgress = () => {}) {
  const rows = [64, 128, 256].map((n) => {
    onProgress(`Sampling ${n} × ${n}`);
    try {
      const s = simulateRuns(
          project,
          {
            parameter: "exposure",
            start: 1,
            end: 1.000001,
            count: 2,
            seed: 42,
            detectorId,
          },
          { n },
        ),
        r = s.rows[0];
      if (r.status !== "complete") throw Error(r.error);
      return {
        n,
        status: "complete",
        visibility: r.visibility,
        validFraction: r.validFraction,
        pvNm: r.pvNm,
        rmsNm: r.rmsNm,
      };
    } catch (e) {
      return { n, status: "failed", error: e.message };
    }
  });
  return {
    format: "optibench-sampling-check",
    version: 1,
    createdAt: new Date().toISOString(),
    detectorId,
    rows: rows.map((r, i) => ({
      ...r,
      change:
        i && r.status === "complete" && rows[i - 1].status === "complete"
          ? Object.fromEntries(
              ["visibility", "validFraction", "pvNm", "rmsNm"].map((k) => [
                k,
                r[k] - rows[i - 1][k],
              ]),
            )
          : null,
    })),
    note: "Fixed detector extent; 64², 128² and 256² independently sampled ideal phase frames. Each grid uses its own sampled intensity normalization and validity mask. Changes include those effects and plane removal. Small successive differences do not prove convergence or physical accuracy.",
  };
}
export function samplingHTML(r) {
  const esc = (v) =>
    String(v ?? "").replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
    );
  const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
  return `<section><h2>Sampling stability</h2><p>${r.note}</p><table><tr><th>Grid</th><th>Visibility / Δ</th><th>Valid fraction / Δ</th><th>PV nm / Δ</th><th>RMS nm / Δ</th></tr>${r.rows.map((x) => `<tr><td>${x.n}² · ${esc(x.error || x.status)}</td>${["visibility", "validFraction", "pvNm", "rmsNm"].map((k) => `<td>${fmt(x[k])} / ${fmt(x.change?.[k])}</td>`).join("")}</tr>`).join("")}</table><p>Δ is the current grid minus the preceding grid. Failed grids are excluded from differences.</p></section>`;
}
