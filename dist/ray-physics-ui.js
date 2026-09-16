import { escapeRay as esc, rayNumber as fmt } from "./nonsequential-view.js";
export function materialsEditor(scene) {
  return `<details><summary>Custom material tables (${scene.materials?.length || 0})</summary><p>Rows: wavelength in nm, real index, attenuation per mm. Linear interpolation only; no extrapolation. Data are user-supplied.</p>${(scene.materials || []).map((m, i) => `<fieldset data-custom-material="${i}"><legend>${esc(m.name)}</legend><label>Name<input data-custom-name value="${esc(m.name)}"></label><label>Provenance<input data-custom-provenance value="${esc(m.provenance)}" placeholder="Reference or stated assumption"></label><label>Table<textarea data-custom-table rows="5">${m.samples.map((r) => r.join(", ")).join("\n")}</textarea></label><button data-ray="update-material" data-index="${i}">Apply material data</button><button data-ray="remove-material" data-index="${i}">Remove material</button></fieldset>`).join("")}<button data-ray="add-material">Add custom material</button></details>`;
}
export function coatingEditor(o) {
  if (!["plate", "sphere", "lens"].includes(o.kind)) return "";
  return `<details open><summary>Bulk attenuation and coatings</summary><label>Additional bulk attenuation · mm⁻¹<input type="number" step="any" min="0" max="100" data-number="bulkAlpha" value="${o.bulkAlpha ?? 0}"></label><p>Added to the material table’s attenuation. This is a ray-intensity attenuation model, not complex-index interface absorption.</p><label>Coated surfaces<select data-coating-faces><option value="optical" ${(o.coatingFaces || "optical") === "optical" ? "selected" : ""}>Optical faces only</option><option value="all" ${o.coatingFaces === "all" ? "selected" : ""}>Every boundary, including edges</option></select></label><p>Layer order: ambient → substrate. The order reverses for exiting rays. Film indices are real and nondispersive; film thickness is in nm. The same stack coats every selected face.</p>${(o.coating || []).map((l, i) => `<div class="runbook-fields" data-layer="${i}"><label>Layer ${i + 1} index<input data-layer-field="n" type="number" step="any" value="${l.n}"></label><label>Thickness · nm<input data-layer-field="thicknessNm" type="number" step="any" value="${l.thicknessNm}"></label><button data-ray="remove-layer" data-index="${i}">Remove layer ${i + 1}</button></div>`).join("")}<div class="measurement-buttons"><button data-ray="add-layer">Add layer</button><button data-ray="coating-ar">Ideal AR at 550 nm</button><button data-ray="coating-reflector">Four-pair reflector at 550 nm</button><button data-ray="coating-clear">Clear stack</button></div></details>`;
}
export function studiesEditor(scene, settings, study, busy) {
  const sourceOptions = scene.sources
      .map(
        (o) =>
          `<option value="${esc(o.id)}" ${settings.sourceId === o.id ? "selected" : ""}>${esc(o.label)}</option>`,
      )
      .join(""),
    objectOptions = scene.objects
      .map(
        (o) =>
          `<option value="${esc(o.id)}" ${settings.objectId === o.id ? "selected" : ""}>${esc(o.label)}</option>`,
      )
      .join("");
  return `<details open><summary>Optical studies</summary><fieldset ${busy ? "disabled" : ""}><label>Study<select data-study="kind">${[
    ["wavelength", "Wavelength sweep"],
    ["angle", "Object yaw sweep"],
    ["convergence", "Ray-count convergence"],
  ]
    .map(
      ([k, l]) =>
        `<option value="${k}" ${settings.kind === k ? "selected" : ""}>${l}</option>`,
    )
    .join(
      "",
    )}</select></label><label>Detector<select data-study="detectorId">${scene.objects
    .filter((o) => o.kind === "detector")
    .map(
      (o) =>
        `<option value="${esc(o.id)}" ${settings.detectorId === o.id ? "selected" : ""}>${esc(o.label)}</option>`,
    )
    .join(
      "",
    )}</select></label>${settings.kind === "wavelength" ? `<label>Swept source<select data-study="sourceId">${sourceOptions}</select></label>` : settings.kind === "angle" ? `<label>Rotated object<select data-study="objectId">${objectOptions}</select></label><p>Absolute yaw about the object center; its elevation is preserved.</p>` : ""}${settings.kind === "convergence" ? `<label>Increasing ray counts<input data-study="levels" value="${settings.levels.join(", ")}"></label><label>Relative power and map-change tolerance<input data-study="tolerance" type="number" step="any" min=".00001" max=".5" value="${settings.tolerance}"></label>` : `<div class="runbook-fields">${["start", "end", "count"].map((k) => `<label>${k}<input data-study="${k}" type="number" step="any" value="${settings[k]}"></label>`).join("")}</div>`}<button data-ray="study">Run optical study</button></fieldset>${study ? `<h3>${esc(study.name)}</h3><p>${esc(study.status)} · ${study.rows.length} completed points. Results refer to the recorded scene, not current edits.</p>${study.convergence ? `<p>${esc(study.convergence.status)} · ${esc(study.convergence.reason)}</p>` : ""}${studyPlot(study)}<div class="runbook-table"><table><thead><tr><th>Value</th><th>Detected · mW</th><th>Scattered · mW</th><th>Unresolved fraction</th></tr></thead><tbody>${study.rows.map((r) => `<tr><td>${fmt(r.value)}</td><td>${r.error ? esc(r.error) : fmt(r.result.power)}</td><td>${fmt(r.result?.groups.scattered)}</td><td>${fmt(r.result?.unresolvedFraction)}</td></tr>`).join("")}</tbody></table></div>${study.convergence?.pairs ? `<p>${study.convergence.pairs.map((p) => `${p.from} → ${p.to}: power Δ ${fmt(p.relativePower)}, map L1 ${fmt(p.normalizedMapL1)}`).join("<br>")}</p>` : ""}<div class="measurement-buttons"><button data-ray="study-save" ${busy ? "disabled" : ""}>Save study</button><button data-ray="study-json" ${busy ? "disabled" : ""}>Export study JSON</button><button data-ray="study-csv" ${busy ? "disabled" : ""}>Export study CSV</button><button data-ray="study-replay" ${busy ? "disabled" : ""}>Restore study inputs</button></div>` : ""}</details>`;
}

export function studyPlot(study) {
  const rows = study.rows.filter(
    (r) => !r.error && Number.isFinite(r.result?.power),
  );
  if (rows.length < 2) return "";
  const lo = Math.min(...rows.map((r) => r.value)),
    hi = Math.max(...rows.map((r) => r.value)),
    top = Math.max(...rows.map((r) => r.result.power), 1e-12);
  const x = (v) => 55 + (445 * (v - lo)) / (hi - lo || 1),
    y = (v) => 165 - (140 * v) / top;
  const lines = study.rows
    .slice(1)
    .map((r, i) => {
      const a = study.rows[i];
      return r.error || a.error || !r.result || !a.result
        ? ""
        : `<line x1="${x(a.value)}" y1="${y(a.result.power)}" x2="${x(r.value)}" y2="${y(r.result.power)}" stroke="#b2e67c" stroke-width="2"/>`;
    })
    .join("");
  const unit =
    study.settings.kind === "wavelength"
      ? "Wavelength · nm"
      : study.settings.kind === "angle"
        ? "Object yaw · degrees"
        : "Rays per source";
  return `<svg viewBox="0 0 540 220" role="img" aria-label="Detector power versus ${esc(unit)}" style="width:100%;max-height:240px;background:#14222d"><path d="M55 20 V165 H505" fill="none" stroke="#718798"/>${lines}${rows.map((r) => `<circle cx="${x(r.value)}" cy="${y(r.result.power)}" r="3" fill="#b2e67c"><title>${fmt(r.value)}: ${fmt(r.result.power)} mW</title></circle>`).join("")}<g fill="#c3d0db" font-size="12"><text x="55" y="15">Detector power · mW</text><text x="4" y="30">${fmt(top)}</text><text x="35" y="170">0</text><text x="55" y="185">${fmt(lo)}</text><text x="500" y="185" text-anchor="end">${fmt(hi)}</text><text x="280" y="208" text-anchor="middle">${unit}</text></g></svg>`;
}
