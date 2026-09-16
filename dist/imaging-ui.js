import {
  defaultPupil,
  validatePupil,
  parsePupil,
  pupilMap,
  zernikeModes,
  selectSpot,
  imagingCSV,
} from "./imaging.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import { runbookStore } from "./runbook.js";
import { escapeRay as esc, rayNumber as fmt } from "./nonsequential-view.js";
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function chart(points, xLabel, yLabel) {
  if (points.length < 2) return "<p>No curve available.</p>";
  const xs = points.map((p) => p[0]),
    ys = points.map((p) => p[1]),
    xmin = Math.min(...xs),
    xmax = Math.max(...xs),
    ymax = Math.max(...ys, 1e-12),
    ymin = Math.min(0, ...ys);
  const x = (v) => 60 + (440 * (v - xmin)) / (xmax - xmin || 1),
    y = (v) => 175 - (140 * (v - ymin)) / (ymax - ymin || 1);
  return `<svg viewBox="0 0 540 225" role="img" aria-label="${esc(yLabel)} versus ${esc(xLabel)}"><path d="M60 30V175H505" stroke="#718798" fill="none"/><polyline points="${points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}" stroke="#b7e97d" stroke-width="2" fill="none"/><g fill="#c3d0db" font-size="13"><text x="60" y="20">${esc(yLabel)}</text><text x="2" y="40">${fmt(ymax)}</text><text x="60" y="195">${fmt(xmin)}</text><text x="500" y="195" text-anchor="end">${fmt(xmax)}</text><text x="270" y="218" text-anchor="middle">${esc(xLabel)}</text></g></svg>`;
}
function spotPlot(s) {
  if (!s.count) return "<p>No selected detector power.</p>";
  const extent = s.points.reduce(
    (v, p) =>
      Math.max(v, Math.abs(p.u - s.centroid[0]), Math.abs(p.v - s.centroid[1])),
    1e-6,
  );
  return `<svg viewBox="0 0 420 420" role="img" aria-label="Spot diagram centered on power centroid"><path d="M210 25V390M25 210H390" stroke="#526878"/>${s.points
    .filter((_, i) => i % Math.max(1, Math.ceil(s.points.length / 2000)) === 0)
    .map(
      (p) =>
        `<circle cx="${210 + (180 * (p.u - s.centroid[0])) / extent}" cy="${210 - (180 * (p.v - s.centroid[1])) / extent}" r="2" fill="#b7e97d" opacity=".6"/>`,
    )
    .join(
      "",
    )}<text x="20" y="410" fill="#c3d0db" font-size="13">U/V extent ±${fmt(extent)} mm · max 2000 displayed hits</text></svg>`;
}
export function createImagingWorkspace({ store = runbookStore, execute } = {}) {
  let root,
    pupil = defaultPupil(),
    result = null,
    ray = null,
    selection = { detectorId: "", sourceId: "", path: "all" },
    spot = null,
    focus = null,
    range = { start: -20, end: 20, count: 21 },
    history = [],
    message =
      "Define a pupil or open a completed ray trace for imaging analysis.",
    job = null,
    dirty = true;
  function render() {
    if (!root) return;
    const busy = !!job;
    root.innerHTML = `<header class="measurement-header"><button data-imaging="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Imaging analysis</h1><span>Geometrical spots · scalar diffraction</span></header><main class="instrument-main"><p role="status">${esc(message)}</p><div class="ray-layout"><section class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Explicit pupil model</legend><label>Name<input data-pupil="name" value="${esc(pupil.name)}"></label><label>Provenance<input data-pupil="provenance" value="${esc(pupil.provenance)}"></label><div class="runbook-fields">${[
      ["wavelength", "Wavelength · nm"],
      ["diameter", "Diameter · mm"],
      ["focalLength", "Focal length · mm"],
      ["obscuration", "Obscuration radius ratio"],
    ]
      .map(
        ([k, l]) =>
          `<label>${l}<input data-pupil="${k}" type="number" step="any" value="${pupil[k]}"></label>`,
      )
      .join(
        "",
      )}</div><label>Pupil grid<select data-pupil="grid" ${pupil.opd ? "disabled" : ""}>${[64, 128].map((n) => `<option ${pupil.grid === n ? "selected" : ""}>${n}</option>`).join("")}</select></label><label>Phase removal<select data-pupil="remove"><option value="piston" ${pupil.remove === "piston" ? "selected" : ""}>Piston only</option><option value="piston-tilt" ${pupil.remove === "piston-tilt" ? "selected" : ""}>Piston and tilt</option></select></label><p>Uniform pupil amplitude. OPD is relative to an ideal reference sphere at the specified focal length. This model is independent of the ray bench.</p>${pupil.opd ? "<p>Imported unwrapped OPD map is active; coefficient controls are inactive. Exported map JSON documents the grid and units.</p>" : `<details open><summary>Zernike coefficients · nm</summary><p>Unit-RMS full-disk normalization. Each mode is identified by (n,m); no implicit Noll numbering. Positive m uses cosine, negative m sine. Coefficients cease to be independent RMS contributions for an obscured pupil.</p>${zernikeModes.map(([name, n, m], i) => `<label>${name} (${n},${m})<input data-coefficient="${i}" type="number" step="any" value="${pupil.coefficients[i]}"></label>`).join("")}</details>`}<div class="measurement-buttons"><button data-imaging="ideal">Ideal pupil</button><button data-imaging="aberrated">Aberration example</button><button data-imaging="calculate">Calculate diffraction</button><button data-imaging="export-input">Export pupil map JSON</button></div><label>Import pupil map JSON<input data-imaging-import type="file" accept=".json"></label></fieldset>${busy ? '<button data-imaging="cancel">Cancel calculation</button>' : ""}<h3>Saved imaging studies</h3><select data-imaging-history ${busy ? "disabled" : ""}><option value="">Choose study</option>${history
      .filter((h) => h.format === "optibench-imaging-study")
      .map((h) => `<option value="${esc(h.id)}">${esc(h.name)}</option>`)
      .join(
        "",
      )}</select><div class="measurement-buttons"><button data-imaging="save" ${busy || (!result && !ray) ? "disabled" : ""}>Save study</button><button data-imaging="open" ${busy ? "disabled" : ""}>Open study</button><button data-imaging="audit" ${busy || (!result && !ray) ? "disabled" : ""}>Export study JSON</button></div><details><summary>Model limits and references</summary><p>Scalar, monochromatic, paraxial Fraunhofer diffraction; diameter/(2f) ≤ 0.15. No vector/high-NA diffraction, coatings, polarization or automatic pupil extraction from rays. Imported maps must be unwrapped OPD in nm on a uniform square grid, with null values outside the circular/annular pupil. Local saved records are device-local.</p><a href="https://qiweb.tudelft.nl/aoi/wavefieldaberrations/wavefieldaberrations/" target="_blank" rel="noreferrer">TU Delft: wavefield aberrations</a></details></section><section class="instrument-results">${raySection(busy)}${result ? diffractionSection() : `<h2>Diffraction analysis</h2><p>Choose an example or define the pupil, then calculate its wavefront, PSF and MTF.</p>`}</section></div></main>`;
    if (result) {
      paint("opd", result.opd, result.settings.grid, true);
      paint("psf", result.psf, result.n, false);
    }
  }
  function raySection(busy) {
    if (!ray)
      return "<section><h2>Ray spot analysis</h2><p>In Ray optics, trace a scene and choose Imaging analysis to inspect detector spots and focus.</p></section>";
    const ds = ray.scene.objects.filter((o) => o.kind === "detector");
    if (!ds.some((d) => d.id === selection.detectorId))
      selection.detectorId = ds[0]?.id || "";
    try {
      spot = selectSpot(ray, selection).statistics;
    } catch (e) {
      return `<p>${esc(e.message)}</p>`;
    }
    return `<section><h2>Recorded ray spots</h2><p>${esc(ray.scene.name)} · power-weighted geometrical results, without diffraction. Statistics use every selected hit; diagram markers have equal size.</p><p>Launched power: ${fmt(ray.ledger?.launched)} mW. Unresolved power: ${fmt((ray.ledger?.threshold || 0) + (ray.ledger?.depthLimit || 0) + (ray.ledger?.budgetLimit || 0) + (ray.ledger?.cancelled || 0))} mW. Clipped, escaped and unresolved rays are absent from this spot estimate.</p><fieldset ${busy ? "disabled" : ""}><div class="runbook-fields"><label>Detector<select data-selection="detectorId">${ds.map((d) => `<option value="${esc(d.id)}" ${d.id === selection.detectorId ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></label><label>Source<select data-selection="sourceId"><option value="">All sources · incoherent sum</option>${ray.scene.sources.map((s) => `<option value="${esc(s.id)}" ${s.id === selection.sourceId ? "selected" : ""}>${esc(s.label)}</option>`).join("")}</select></label><label>Paths<select data-selection="path">${["all", "direct", "specular", "scattered"].map((p) => `<option ${selection.path === p ? "selected" : ""}>${p}</option>`).join("")}</select></label></div></fieldset>${
      spot.count
        ? `<div class="ray-ledger"><div><span>Centroid U / V · mm</span><strong>${spot.centroid.map(fmt).join(" / ")}</strong></div><div><span>RMS spot radius · mm</span><strong>${fmt(spot.rmsRadius)}</strong></div><div><span>80% energy radius · mm</span><strong>${fmt(spot.r80)}</strong></div><div><span>Selected power · mW</span><strong>${fmt(spot.power)}</strong></div></div><p>Principal σ: ${fmt(spot.sigmaMajor)} / ${fmt(spot.sigmaMinor)} mm; angle ${fmt(spot.angleDeg)}°. Encircled energy is centered on the power centroid and normalized to selected collected power, not launched power.</p><div class="imaging-plots"><figure>${spotPlot(spot)}</figure><figure>${chart(
            spot.curve.map((p) => [p.radius, p.fraction]),
            "Radius · mm",
            "Collected fraction",
          )}</figure></div><button data-imaging="spot-csv" ${busy ? "disabled" : ""}>Export selected hits CSV</button>`
        : "<p>No signal for this selection.</p>"
    }<details open><summary>Virtual focus scan</summary><fieldset ${busy ? "disabled" : ""}><div class="runbook-fields">${[
      ["start", "Start offset · mm"],
      ["end", "End offset · mm"],
      ["count", "Planes"],
    ]
      .map(
        ([k, l]) =>
          `<label>${l}<input data-focus="${k}" type="number" value="${range[k]}"></label>`,
      )
      .join(
        "",
      )}</div><button data-imaging="focus">Scan collected rays</button></fieldset>${
      focus
        ? `<p>${esc(focus.warning)}</p><p>Unconstrained least-RMS offset: ${focus.optimum === null ? "undefined for parallel rays" : fmt(focus.optimum) + " mm"}. Best within scanned range: ${focus.bestInRange === null ? "undefined" : fmt(focus.bestInRange) + " mm"}. ${focus.optimum !== null && (focus.optimum < range.start || focus.optimum > range.end) ? "The unconstrained optimum lies outside the scan." : ""}</p>${chart(
            focus.rows.map((r) => [r.offset, r.rmsRadius]),
            "Offset along detector normal · mm",
            "RMS radius · mm",
          )}<button data-imaging="focus-csv" ${busy ? "disabled" : ""}>Export focus CSV</button>`
        : "<p>Projects only already collected rays through free space; does not move or retrace a detector.</p>"
    }</details></section>`;
  }
  function diffractionSection() {
    const r = result;
    return `<section><h2>Diffraction · ${esc(r.settings.name)}</h2><p>${dirty ? "Inputs changed; displayed results belong to the last calculation." : "Results match the current pupil inputs."}</p><p>${esc(r.settings.provenance)}</p><div class="ray-ledger"><div><span>Wavefront RMS / PV · nm</span><strong>${fmt(r.rms)} / ${fmt(r.pv)}</strong></div><div><span>Sampled peak Strehl</span><strong>${fmt(r.strehl)}</strong></div><div><span>PSF pixel pitch · µm</span><strong>${fmt(r.pixelMm * 1000)}</strong></div><div><span>Incoherent cutoff · cycles/mm</span><strong>${fmt(r.cutoff)}</strong></div></div><p>Strehl compares sampled peak intensity with the same aperture at zero aberration. ${esc(r.settings.remove)} removed. MTF is the magnitude of the normalized Fourier transform of intensity PSF.</p><div class="imaging-plots"><figure><figcaption>OPD · blue negative / red positive · ±${fmt(Math.max(...r.opd.filter((v) => v !== null).map(Math.abs)))} nm</figcaption><canvas data-map="opd" width="${r.settings.grid}" height="${r.settings.grid}" aria-label="Pupil OPD map"></canvas></figure><figure><figcaption>PSF · logarithmic display, normalized linear export · field ${fmt(r.n * r.pixelMm)} mm</figcaption><canvas data-map="psf" width="${r.n}" height="${r.n}" aria-label="Diffraction point spread function"></canvas></figure></div><div class="imaging-plots"><figure>${chart(
      r.mtf
        .filter((p) => p.frequency <= r.cutoff * 1.1)
        .map((p) => [p.frequency, p.x]),
      "Spatial frequency · cycles/mm",
      "MTF X",
    )}</figure><figure>${chart(
      r.mtf
        .filter((p) => p.frequency <= r.cutoff * 1.1)
        .map((p) => [p.frequency, p.y]),
      "Spatial frequency · cycles/mm",
      "MTF Y",
    )}</figure><figure>${chart(
      r.encircled.curve
        .filter((p) => p.radius <= (r.pixelMm * r.n) / 4)
        .map((p) => [p.radius * 1000, p.fraction]),
      "Radius from ideal axis · µm",
      "PSF enclosed fraction",
    )}</figure></div><p>PSF energy radius 50% / 80%: ${fmt(r.encircled.r50 * 1000)} / ${fmt(r.encircled.r80 * 1000)} µm. Finite-window normalization; origin is the ideal optical axis, not the intensity centroid.</p><details><summary>Zernike decomposition · residual RMS ${fmt(r.fit.residualRms)} nm</summary><p>Fit uses the input map before phase removal. Least squares on illuminated pixels; values use full-disk basis normalization even for obscured pupils.</p><div class="runbook-table"><table><tr><th>Mode (n,m)</th><th>Coefficient · nm</th></tr>${zernikeModes.map(([name, n, m], i) => `<tr><td>${name} (${n},${m})</td><td>${fmt(r.fit.coefficients[i])}</td></tr>`).join("")}</table></div></details>${r.warnings.map((w) => `<p class="runbook-inconclusive">${esc(w)}</p>`).join("")}<div class="measurement-buttons"><button data-imaging="mtf-csv" ${job ? "disabled" : ""}>Export MTF CSV</button><button data-imaging="psf-csv" ${job ? "disabled" : ""}>Export PSF CSV</button></div></section>`;
  }
  function paint(which, values, n, signed) {
    const c = root.querySelector(`[data-map="${which}"]`),
      ctx = c?.getContext("2d");
    if (!ctx) return;
    const image = ctx.createImageData(n, n),
      max = values.reduce((a, v) => Math.max(a, Math.abs(v || 0)), 0) || 1;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = values[y * n + x],
          j = ((n - 1 - y) * n + x) * 4;
        if (v === null) {
          image.data[j + 3] = 255;
          continue;
        }
        const t = signed
          ? Math.abs(v) / max
          : Math.log1p((9999 * v) / max) / Math.log(10000);
        image.data[j] = signed ? (v >= 0 ? 255 * t : 40 * t) : 180 * t;
        image.data[j + 1] = signed ? 70 * t : 230 * t;
        image.data[j + 2] = signed ? (v < 0 ? 255 * t : 40 * t) : 125 * t;
        image.data[j + 3] = 255;
      }
    ctx.putImageData(image, 0, 0);
  }
  function cancel() {
    if (!job) return;
    const t = job;
    job = null;
    t.worker?.terminate();
    clearTimeout(t.timer);
    t.resolve?.(null);
    message = "Calculation cancelled. Previous completed results retained.";
    render();
  }
  async function calculate(kind) {
    const token = {};
    job = token;
    message = "Calculating imaging results…";
    render();
    token.timer = setTimeout(cancel, 120000);
    try {
      const data =
        kind === "focus"
          ? {
              kind,
              run: ray,
              selection: structuredClone(selection),
              range: structuredClone(range),
            }
          : { kind: "pupil", pupil: validatePupil(pupil) };
      const out = execute
        ? await execute(data)
        : await new Promise((resolve, reject) => {
            token.resolve = resolve;
            const w = new Worker(
              new URL("./imaging-worker.js", import.meta.url),
              { type: "module" },
            );
            token.worker = w;
            w.onmessage = ({ data }) =>
              data.error ? reject(Error(data.error)) : resolve(data.result);
            w.onerror = (e) => reject(Error(e.message));
            w.postMessage(data);
          });
      if (job !== token) return;
      if (kind === "focus") focus = out;
      else {
        result = out;
        dirty = JSON.stringify(out.settings) !== JSON.stringify(pupil);
      }
      message = "Imaging calculation completed.";
    } catch (e) {
      if (job === token) message = e.message;
    } finally {
      clearTimeout(token.timer);
      token.worker?.terminate();
      if (job === token) {
        job = null;
        render();
      }
    }
  }
  function record() {
    return {
      format: "optibench-imaging-study",
      version: 1,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      name: result?.settings.name || ray?.scene.name || pupil.name,
      pupil: validatePupil(pupil),
      result,
      ray: ray
        ? {
            scene: ray.scene,
            detectorHits: ray.detectorHits,
            ledger: ray.ledger,
            engine: ray.engine,
          }
        : null,
      selection: structuredClone(selection),
      range: structuredClone(range),
      focus,
    };
  }
  async function action(a) {
    if (a === "cancel") {
      cancel();
      return;
    }
    if (job) return;
    try {
      if (a === "close") {
        closeWorkspace(root);
        return;
      }
      if (a === "calculate" || a === "focus") {
        await calculate(a === "focus" ? "focus" : "pupil");
        return;
      }
      if (a === "ideal" || a === "aberrated") {
        pupil = defaultPupil();
        if (a === "aberrated") {
          pupil.name = "Astigmatism and coma";
          pupil.coefficients[5] = 40;
          pupil.coefficients[7] = 30;
        }
        dirty = true;
      }
      if (a === "export-input")
        download("optibench-pupil.json", JSON.stringify(pupilMap(pupil)));
      if (a === "save") {
        const r = record();
        if (JSON.stringify(r).length > 64000000)
          throw Error("Study exceeds 64 MB. Reduce ray count before saving.");
        await store.save(r);
        history = await store.list();
        message = "Imaging study saved in this browser.";
      }
      if (a === "audit")
        download("optibench-imaging-study.json", JSON.stringify(record()));
      if (a === "open") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-imaging-history]").value,
        );
        if (!r || r.format !== "optibench-imaging-study")
          throw Error("Choose an imaging study.");
        pupil = validatePupil(r.pupil);
        result = structuredClone(r.result);
        ray = structuredClone(r.ray);
        selection = structuredClone(r.selection);
        range = structuredClone(r.range);
        focus = structuredClone(r.focus);
        dirty =
          !result || JSON.stringify(result.settings) !== JSON.stringify(pupil);
        message = "Saved imaging study opened.";
      }
      if (a === "mtf-csv")
        download("optibench-mtf.csv", imagingCSV(result), "text/csv");
      if (a === "psf-csv")
        download(
          "optibench-psf.csv",
          [
            "x_mm,y_mm,normalized_pixel_power",
            ...result.psf.map(
              (v, j) =>
                `${((j % result.n) - result.n / 2) * result.pixelMm},${(Math.floor(j / result.n) - result.n / 2) * result.pixelMm},${v}`,
            ),
          ].join("\n"),
          "text/csv",
        );
      if (a === "spot-csv") {
        const { hits } = selectSpot(ray, selection);
        download(
          "optibench-spots.csv",
          [
            "u_mm,v_mm,power_mW,wavelength_nm",
            ...hits.map(
              (h) => `${h.uv[0]},${h.uv[1]},${h.power},${h.wavelength}`,
            ),
          ].join("\n"),
          "text/csv",
        );
      }
      if (a === "focus-csv")
        download(
          "optibench-focus.csv",
          [
            "offset_mm,rms_radius_mm,r80_mm,power_mW",
            ...focus.rows.map(
              (r) => `${r.offset},${r.rmsRadius},${r.r80},${r.power}`,
            ),
          ].join("\n"),
          "text/csv",
        );
      render();
    } catch (e) {
      message = e.message;
      render();
    }
  }
  function ensure() {
    if (root) return;
    root = document.createElement("section");
    root.id = "imaging-workspace";
    root.hidden = true;
    document.body.append(root);
    root.addEventListener("click", (e) => {
      const a = e.target.closest("[data-imaging]");
      if (a) void action(a.dataset.imaging);
    });
    root.addEventListener("change", async (e) => {
      if (job) return;
      const t = e.target;
      try {
        if (t.matches("[data-pupil]")) {
          const k = t.dataset.pupil;
          pupil[k] = ["name", "provenance", "remove"].includes(k)
            ? t.value
            : Number(t.value);
          dirty = true;
        }
        if (t.matches("[data-coefficient]")) {
          pupil.coefficients[Number(t.dataset.coefficient)] = Number(t.value);
          dirty = true;
        }
        if (t.matches("[data-selection]")) {
          selection[t.dataset.selection] = t.value;
          focus = null;
        }
        if (t.matches("[data-focus]")) {
          range[t.dataset.focus] = Number(t.value);
          focus = null;
        }
        if (t.matches("[data-imaging-import]") && t.files[0]) {
          if (t.files[0].size > 4000000)
            throw Error("Pupil input exceeds 4 MB.");
          pupil = parsePupil(await t.files[0].text());
          dirty = true;
          message =
            "Pupil map imported. Calculate to regenerate derived results.";
        }
        render();
      } catch (e) {
        message = e.message;
        render();
      }
    });
  }
  return {
    async open(run) {
      ensure();
      if (run) {
        ray = structuredClone(run);
        selection = {
          detectorId: ray.detectors[0]?.id || "",
          sourceId: "",
          path: "all",
        };
        focus = null;
        message =
          "Recorded ray trace loaded. Pupil diffraction remains a separate explicit model.";
      }
      history = await store.list();
      showWorkspace(root);
      render();
    },
    cancel,
  };
}
