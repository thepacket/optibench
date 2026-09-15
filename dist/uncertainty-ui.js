import { evaluateUncertainty } from "./uncertainty.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toFixed(4) : "—");
const defaults = () => ({
  recordId: "",
  date: "",
  references: "",
  scope: "",
  wavelengthU: "",
  pixelU: "",
  angleU: "",
  stepU: "",
  otherPV: "",
  otherRMS: "",
  k: 2,
  pvLimit: "",
  rmsLimit: "",
});
export function createUncertaintyPanel(getContext, download) {
  let calibration = defaults(),
    budget = null,
    verified = false,
    message = "",
    root;
  function report() {
    if (!budget) return "";
    return `${budget.restored ? "<p>Archived assessment recomputed using historical operator assertions; review before new use.</p>" : ""}<h3>Single-acquisition uncertainty · ${budget.simulation ? "simulation" : budget.nonlinear ? "model review" : "declared scope"}</h3>${[
      "pv",
      "rms",
    ]
      .map((key) => {
        const o = budget.outputs[key];
        return `<h3>${key.toUpperCase()}: ${fmt(o.value)} ± ${fmt(o.expanded)} nm (k = ${budget.calibration.k})</h3><p>${esc(o.decision)}${o.limit === null ? "" : ` · upper limit ${fmt(o.limit)} nm`}</p><table><thead><tr><th>Contribution</th><th>Standard u · nm</th></tr></thead><tbody>${o.contributions.map((r) => `<tr><td>${esc(r.name)}</td><td>${fmt(r.u)}</td></tr>`).join("")}<tr><th>Combined standard uncertainty</th><td>${fmt(o.combined)}</td></tr></tbody></table>`;
      })
      .join(
        "",
      )}<p>ROI width ${fmt(budget.roiWidth.value)} µm; standard uncertainty ${fmt(budget.roiWidth.standardU)} µm.</p><ul>${budget.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul><h3>Sample</h3><pre>${esc(JSON.stringify(budget.sample || {}, null, 2))}</pre><h3>Calibration record</h3><pre>${esc(JSON.stringify(budget.calibration, null, 2))}</pre><h3>Analysis settings</h3><pre>${esc(JSON.stringify(budget.settings, null, 2))}</pre><h3>Repeat acquisitions</h3><pre>${esc(JSON.stringify(budget.repeatAcquisitions, null, 2))}</pre>`;
  }
  function render(target) {
    root = target;
    if (!root) return;
    const field = (label, key, type = "number") =>
      `<label>${label}<input data-cal="${key}" type="${type}" ${type === "number" ? 'min="0" step="any"' : ""} value="${esc(calibration[key])}"></label>`;
    root.innerHTML = `<section class="measurement-records"><h2>Phase-stepped uncertainty budget</h2><p>Evaluate the current sample using a compatible repeatability study. Enter standard uncertainties (one standard deviation), converting certificate expanded values by their stated coverage factor. Blank means unknown.</p><div class="measurement-two">${field("Calibration record ID", "recordId", "text")}${field("Calibration date", "date", "date")}${field("Wavelength standard u · nm", "wavelengthU")}${field("Pixel scale standard u · µm/pixel", "pixelU")}${field("Incidence standard u · degrees", "angleU")}${field("Each independent phase-step standard u · degrees", "stepU")}${field("Other evaluated PV standard u · nm", "otherPV")}${field("Other evaluated RMS standard u · nm", "otherRMS")}${field("Coverage factor k · no automatic confidence claim", "k")}${field("PV upper limit · nm (optional)", "pvLimit")}${field("RMS upper limit · nm (optional)", "rmsLimit")}</div><label>Certificate IDs, instruments and calibration sources<textarea data-cal="references">${esc(calibration.references)}</textarea></label><label>Scope, corrections, independence, zero contributions and choice of k<textarea data-cal="scope">${esc(calibration.scope)}</textarea></label><p>Supports four-step sample maps, small calibration errors and independent contributions. Reference-difference uncertainty and Fourier uncertainty require a separate model. Pixel-scale uncertainty applies to ROI width.</p><label class="measurement-check"><input id="uncertainty-verified" type="checkbox" ${verified ? "checked" : ""}>I reviewed calibration applicability, same-sample repeatability, correlations, missing effects and coverage factor.</label><div class="measurement-buttons"><button data-uncertainty="evaluate">Evaluate budget</button><button data-uncertainty="json" ${budget ? "" : "disabled"}>Export budget JSON</button><button data-uncertainty="report" ${budget ? "" : "disabled"}>Export budget report</button></div><p role="status">${esc(message)}</p><div class="measurement-table-scroll">${report()}</div></section>`;
    root.onchange = (e) => {
      e.stopPropagation();
      if (e.target.dataset.cal) {
        calibration[e.target.dataset.cal] = e.target.value;
        verified = false;
      } else if (e.target.id === "uncertainty-verified")
        verified = e.target.checked;
      budget = null;
      render(root);
    };
    root.onclick = (e) => {
      const b = e.target.closest("[data-uncertainty]");
      if (!b) return;
      e.stopPropagation();
      try {
        if (b.dataset.uncertainty === "evaluate") {
          const c = getContext();
          if (c.busy) throw Error("Wait for reconstruction to complete.");
          if (c.differenceView)
            throw Error(
              "Select the sample height map; difference-map uncertainty is not modeled.",
            );
          budget = evaluateUncertainty(c.result, c.study, calibration, {
            verified,
            simulation:
              c.frames.some((f) => /simulat|synthetic/i.test(f.origin || "")) ||
              c.study?.rows.some((r) => r.quality.simulated),
          });
          budget.sample = c.sample;
          message =
            "Budget evaluated. Review the scope and decision rule below.";
          render(root);
        } else if (b.dataset.uncertainty === "json")
          download("uncertainty-budget.json", JSON.stringify(budget));
        else
          download(
            "uncertainty-report.html",
            `<!doctype html><html lang="en"><meta charset="utf-8"><title>OptiBench uncertainty budget</title><style>body{font:16px system-ui;max-width:960px;margin:40px auto;padding:20px}td,th{padding:8px;border:1px solid #aaa}table{border-collapse:collapse}pre{white-space:pre-wrap}</style><h1>OptiBench uncertainty budget</h1><p>${esc(budget.createdAt)} · model ${esc(budget.version)}</p>${report()}</html>`,
            "text/html",
          );
      } catch (e) {
        message = e.message;
        budget = null;
        render(root);
      }
    };
  }
  return {
    render,
    report,
    state: () => ({ calibration, budget }),
    invalidate() {
      budget = null;
      verified = false;
    },
    restoreRecomputed(value) {
      calibration = { ...defaults(), ...value?.calibration };
      budget = value?.budget || null;
      verified = false;
      message =
        "Recomputed archive budget using historical assertions. Review assumptions before new use.";
    },
    restore(value) {
      calibration = { ...defaults(), ...value?.calibration };
      budget = null;
      verified = false;
      message = value
        ? "Calibration restored. Rebuild the repeat study and review before evaluating."
        : "";
    },
  };
}
