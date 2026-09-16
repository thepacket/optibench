import { runRayBenchmarks } from "./nonsequential-benchmarks.js";
import {
  newRayObject,
  rayKinds,
  rayExample,
  sceneFromBench,
  validateRayScene,
  traceNonsequential,
  groupDetectorPaths,
  parseRayScene,
} from "./nonsequential.js";
import { rayMaterials, materialSource } from "./ray3-materials.js";
import { runbookStore } from "./runbook.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import {
  escapeRay as esc,
  rayNumber as fmt,
  raySceneSVG,
  detectorCSV,
  pathCSV,
} from "./nonsequential-view.js";
function download(name, text, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const input = (label, key, value) =>
  `<label>${label}<input data-number="${key}" type="number" step="any" value="${value}"></label>`;
function vectorEditor(label, key, v) {
  return `<div class="ray-vector"><span>${label}</span>${v.map((n, i) => `<label>${["X", "Y", "Z"][i]}<input aria-label="${label} ${["X", "Y", "Z"][i]}" data-number="${key}.${i}" type="number" step="any" value="${n}"></label>`).join("")}</div>`;
}
export function createNonsequentialWorkspace({
  getProject,
  store = runbookStore,
  execute,
} = {}) {
  let root,
    scene,
    run = null,
    history = [],
    message = "Trace finite surfaces and inspect every reflected path.",
    job = null,
    view = "oblique",
    selected = "",
    editIndex = null,
    benchmarks = null,
    filter = { detectorId: "", contains: "", reflections: null };
  const groups = () => (run ? groupDetectorPaths(run, filter) : []);
  function render() {
    if (!root) return;
    const busy = !!job,
      paths = groups(),
      chosen = paths.find(
        (p) => `${p.sourceId}|${p.wavelength}|${p.key}` === selected,
      ),
      shownScene = run?.scene || scene;
    let preview;
    try {
      preview = raySceneSVG(shownScene, run, view, chosen);
    } catch (e) {
      preview = `<p>${esc(e.message)} Correct the geometry to display the scene.</p>`;
    }
    root.innerHTML = `<header class="measurement-header"><button data-ray="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Non-sequential optics</h1><span>Geometrical rays · 3D surfaces</span></header><main class="instrument-main"><p role="status">${esc(message)}</p><div class="measurement-buttons"><button data-ray="capture" ${busy ? "disabled" : ""}>Capture bench</button>${["plate", "sphere", "lens"].map((k) => `<button data-ray="example-${k}" ${busy ? "disabled" : ""}>${k === "plate" ? "Plate ghosts" : k === "sphere" ? "Ball lens" : "Biconvex lens"}</button>`).join("")}<button data-ray="trace" ${busy ? "disabled" : ""}>Trace rays</button>${busy ? '<button data-ray="cancel">Cancel trace</button>' : ""}<button data-ray="benchmarks" ${busy ? "disabled" : ""}>Run physics checks</button><button data-ray="save-scene" ${busy ? "disabled" : ""}>Save scene</button><button data-ray="export-scene" ${busy ? "disabled" : ""}>Export scene JSON</button></div><div class="ray-layout"><section class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Scene</legend><label>Name<input data-scene-name value="${esc(scene.name)}" maxlength="200"></label><div class="runbook-fields">${Object.entries(
      {
        rays: "Rays per source",
        maxDepth: "Maximum encounters",
        maxSegments: "Segment budget",
        minPowerFraction: "Branch threshold / source ray",
        bins: "Detector bins per axis",
      },
    )
      .map(([k, label]) => input(label, "options." + k, scene.options[k]))
      .join(
        "",
      )}</div><details><summary>Sources (${scene.sources.length})</summary>${scene.sources.map((s, i) => `<fieldset data-source="${i}"><legend>${esc(s.label)}</legend>${vectorEditor("Position · mm", "position", s.position)}${vectorEditor("Direction", "direction", s.direction)}<div class="runbook-fields">${input("Wavelength · nm", "wavelength", s.wavelength)}${input("Power · mW", "power", s.power)}${input("Spatial waist · mm", "waist", s.waist)}${input("Polarization angle · °", "polarization", s.polarization)}${input("Ellipticity · °", "ellipticity", s.ellipticity)}</div><label><input type="checkbox" data-unpolarized ${s.unpolarized ? "checked" : ""}>Unpolarized</label><button data-ray="remove-source" data-index="${i}">Remove source</button></fieldset>`).join("")}<button data-ray="add-source">Add source</button></details><h3>Optical surfaces</h3><select data-object-select><option value="">Choose component</option>${scene.objects.map((o, i) => `<option value="${i}">${esc(o.label)} · ${esc(rayKinds[o.kind])}</option>`).join("")}</select><div data-object-editor></div><label>Add object<select data-add-kind>${Object.entries(
      rayKinds,
    )
      .filter(([k]) => k !== "unsupported")
      .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`)
      .join(
        "",
      )}</select></label><button data-ray="add-object">Add optical object</button></fieldset><details><summary>Model assumptions and references</summary><p>Ray powers add incoherently. No interference fringes, diffraction, scattering or CAD. Glass is homogeneous, isotropic and lossless; Fresnel reflection includes polarization and total internal reflection. Sources are collimated spatial Gaussian samples truncated at 3 waists and normalized to the stated power. Zero waist launches a pencil ray. Detector bins show ideal incident irradiance, without camera noise or exposure.</p><p>Glass volumes must have separate bounding boxes. Mirrors and splitters use constant ideal power fractions. A biconvex lens is a user-defined symmetric prescription, not a catalog part match.</p><p><a href="${materialSource}" target="_blank" rel="noreferrer">SCHOTT material data</a> · <a href="https://www.rp-photonics.com/fresnel_equations.html" target="_blank" rel="noreferrer">Fresnel equations</a></p>${(scene.notes || []).map((n) => `<p>${esc(n)}</p>`).join("")}</details>${benchmarks ? `<details open><summary>Analytical physics checks</summary>${benchmarks.map((b) => `<p class="runbook-${b.pass ? "pass" : "fail"}">${b.pass ? "PASS" : "FAIL"} · ${esc(b.name)}<br>Computed ${fmt(b.actual)} · reference ${fmt(b.expected)} · tolerance ${fmt(b.tolerance)}</p>`).join("")}</details>` : ""}<h3>Saved scenes and runs</h3><label>Saved record<select data-history><option value="">Choose record</option>${history
      .filter((r) =>
        ["optibench-nonsequential", "optibench-nonsequential-run"].includes(
          r.format,
        ),
      )
      .map(
        (r) =>
          `<option value="${esc(r.id)}">${esc(r.name || r.scene?.name)} · ${r.format.endsWith("-run") ? "run" : "scene"}</option>`,
      )
      .join(
        "",
      )}</select></label><button data-ray="open" ${busy ? "disabled" : ""}>Open saved record</button><label>Import scene JSON<input type="file" accept=".json" data-import-scene ${busy ? "disabled" : ""}></label></section><section class="instrument-results"><div class="measurement-buttons">${["oblique", "top", "front"].map((k) => `<button data-ray="view-${k}" aria-pressed="${view === k}">${k}</button>`).join("")}</div><div class="ray-scene">${preview}</div>${
      run
        ? `<p>Recorded scene: ${esc(run.scene.name)} · ${esc(run.createdAt)}. Editor changes require a new trace.</p><h2>Power accounting · mW</h2><div class="ray-ledger">${Object.entries(
            run.ledger,
          )
            .map(
              ([k, v]) =>
                `<div><span>${esc(k === "threshold" ? "Below branch threshold" : k === "depthLimit" ? "Encounter limit" : k === "budgetLimit" ? "Segment limit" : k)}</span><strong>${fmt(v)}</strong></div>`,
            )
            .join(
              "",
            )}</div><p>Threshold and limit categories are unresolved power, not physical absorption. Surface incident totals below include repeated encounters.</p><div class="measurement-buttons"><button data-ray="save-run" ${busy ? "disabled" : ""}>Save trace run</button><button data-ray="export-run">Export full ray audit JSON</button><button data-ray="replay" ${busy ? "disabled" : ""}>Restore recorded scene</button></div><h2>Detector irradiance</h2><label>Detector<select data-detector>${run.detectors.map((d) => `<option value="${esc(d.id)}">${esc(d.label)}</option>`).join("")}</select></label><div class="ray-detector"><canvas width="320" height="320" data-detector-map aria-label="Detector irradiance map"></canvas><p data-detector-stats></p></div><button data-ray="detector-csv">Export detector CSV</button><h2>Path inspection</h2><div class="runbook-fields"><label>Detector filter<select data-filter="detectorId"><option value="">All detectors</option>${run.detectors.map((d) => `<option value="${esc(d.id)}" ${filter.detectorId === d.id ? "selected" : ""}>${esc(d.label)}</option>`).join("")}</select></label><label>Visits object<select data-filter="contains"><option value="">Any object</option>${run.scene.objects.map((o) => `<option value="${esc(o.id)}" ${filter.contains === o.id ? "selected" : ""}>${esc(o.label)}</option>`).join("")}</select></label><label>Reflection count<input type="number" min="0" step="1" data-filter="reflections" value="${filter.reflections ?? ""}" placeholder="Any"></label></div><p>Reflected paths are ghost candidates; intended mirror paths also contain reflections. Select a sequence to highlight its complete trajectory.</p><label>Path sequence<select data-path><option value="">All paths</option>${paths
            .map((p) => {
              const key = `${p.sourceId}|${p.wavelength}|${p.key}`;
              return `<option value="${esc(key)}" ${selected === key ? "selected" : ""}>${fmt(p.power)} mW · ${p.reflections} reflections · ${esc(p.key)}</option>`;
            })
            .join(
              "",
            )}</select></label><button data-ray="path-csv">Export filtered paths CSV</button><div class="runbook-table"><table><thead><tr><th>Sequence</th><th>Reflections</th><th>Power · mW</th><th>Hits</th></tr></thead><tbody>${paths
            .slice(0, 100)
            .map(
              (p) =>
                `<tr><td>${esc(p.key)}<br>${esc(p.sourceId)} · ${p.wavelength} nm</td><td>${p.reflections}</td><td>${fmt(p.power)}</td><td>${p.hits}</td></tr>`,
            )
            .join(
              "",
            )}</tbody></table></div><p>${paths.length} matching path groups${paths.length > 100 ? " · first 100 displayed; CSV includes all" : ""}.</p><details><summary>Power by optical object</summary><div class="runbook-table"><table><thead><tr><th>Object</th><th>Encounters</th><th>Incident</th><th>Reflected</th><th>Transmitted</th><th>Absorbed</th><th>Detected</th></tr></thead><tbody>${Object.entries(
            run.surfaceStats,
          )
            .map(
              ([id, s]) =>
                `<tr><td>${esc(run.scene.objects.find((o) => o.id === id)?.label)}</td>${[s.encounters, s.incident, s.reflected, s.transmitted, s.absorbed, s.detected].map((v) => `<td>${fmt(v)}</td>`).join("")}</tr>`,
            )
            .join("")}</tbody></table></div></details>`
        : "<p>Choose a surface example or capture your bench, specify any missing prescriptions, then Trace rays.</p>"
    }</section></div></main>`;
    if (editIndex !== null && scene.objects[editIndex]) {
      root.querySelector("[data-object-select]").value = String(editIndex);
      objectEditor(editIndex);
    }
    drawDetector();
  }
  function objectEditor(index) {
    const o = scene.objects[index];
    if (!o) return;
    root.querySelector("[data-object-editor]").innerHTML =
      `<fieldset data-object="${index}" ${job ? "disabled" : ""}><legend>${esc(o.label)}</legend><label>Label<input data-object-label value="${esc(o.label)}" maxlength="200"></label><label>Explicit surface model<select data-kind>${Object.entries(
        rayKinds,
      )
        .map(
          ([k, v]) =>
            `<option value="${k}" ${o.kind === k ? "selected" : ""}>${esc(v)}</option>`,
        )
        .join(
          "",
        )}</select></label>${o.kind === "unsupported" ? '<p class="instrument-warning">No physical prescription is available. Select and specify a model, or remove this object from the study.</p>' : ""}${vectorEditor("Center · mm", "center", o.center)}${vectorEditor("Surface axis / normal", "normal", o.normal)}<div class="runbook-fields">${["sphere", "lens"].includes(o.kind) ? input("Radius of curvature · mm", "radius", o.radius) : input("Width · mm", "width", o.width) + input("Height · mm", "height", o.height)}${["plate", "lens"].includes(o.kind) ? input("Center thickness · mm", "thickness", o.thickness) : ""}${o.kind === "lens" ? input("Clear diameter · mm", "aperture", o.aperture) : ""}${
        ["plate", "sphere", "lens"].includes(o.kind)
          ? `<label>Material<select data-material>${Object.entries(rayMaterials)
              .map(
                ([k, m]) =>
                  `<option value="${k}" ${o.material === k ? "selected" : ""}>${esc(m.name)}</option>`,
              )
              .join("")}</select></label>`
          : ""
      }${["mirror", "splitter"].includes(o.kind) ? input("Reflected power fraction", "reflectivity", o.reflectivity) : ""}${o.kind === "splitter" ? input("Transmitted power fraction", "transmission", o.transmission) : ""}${!["plate", "sphere", "lens"].includes(o.kind) ? `<label>Outline<select data-shape><option ${o.shape === "rectangle" ? "selected" : ""}>rectangle</option><option ${o.shape === "disc" ? "selected" : ""}>disc</option></select></label>` : ""}</div><button data-ray="remove-object" data-index="${index}">Remove from ray study</button><p>This is an explicit ideal or parametric prescription, not verified manufacturer geometry. Normal vectors are normalized when tracing. Positions, radii and thickness are millimetres.</p></fieldset>`;
  }
  function drawDetector() {
    if (!run) return;
    const id = root.querySelector("[data-detector]")?.value,
      d = run.detectors.find((d) => d.id === id);
    if (!d) return;
    const max = Math.max(...d.irradiance),
      canvas = root.querySelector("canvas"),
      ctx = canvas?.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#070e16";
      ctx.fillRect(0, 0, 320, 320);
      for (let y = 0; y < d.bins; y++)
        for (let x = 0; x < d.bins; x++) {
          const t = max > 0 ? Math.sqrt(d.irradiance[y * d.bins + x] / max) : 0;
          ctx.fillStyle = `rgb(${Math.round(185 * t)},${Math.round(235 * t)},${Math.round(120 * t)})`;
          ctx.fillRect(
            (x * 320) / d.bins,
            ((d.bins - 1 - y) * 320) / d.bins,
            Math.ceil(320 / d.bins),
            Math.ceil(320 / d.bins),
          );
        }
    }
    root.querySelector("[data-detector-stats]").textContent =
      `${fmt(d.power)} mW collected. Peak bin irradiance ${fmt(max)} mW/mm². ${d.bins} × ${d.bins} bins over ${d.width} × ${d.height} mm. Square-root display scale; CSV contains linear values. U increases right; V increases upward. Ray sampling affects spatial resolution; increase rays to check convergence.`;
  }
  function cancel() {
    if (!job) return;
    const t = job;
    job = null;
    t.worker?.terminate();
    t.resolve?.(null);
    clearTimeout(t.timer);
    message =
      "Trace cancelled. The previous completed result is retained; partial output is not presented as a complete power balance.";
    render();
  }
  async function trace() {
    scene = validateRayScene(scene);
    const token = {};
    job = token;
    message = "Tracing reflected and transmitted branches…";
    render();
    token.timer = setTimeout(cancel, 120000);
    try {
      const result = execute
        ? await execute(scene)
        : await new Promise((resolve, reject) => {
            token.resolve = resolve;
            const w = new Worker(
              new URL("./nonsequential-worker.js", import.meta.url),
              { type: "module" },
            );
            token.worker = w;
            w.onmessage = ({ data }) => {
              if (job !== token) return;
              if (data.progress) {
                root.querySelector("[role=status]").textContent =
                  `${data.progress.segments} segments · ${data.progress.queued} branches queued`;
                return;
              }
              data.error ? reject(Error(data.error)) : resolve(data.result);
            };
            w.onerror = (e) => reject(Error(e.message));
            w.postMessage({ scene });
          });
      if (job !== token) return;
      run = result;
      selected = "";
      filter = { detectorId: "", contains: "", reflections: null };
      message = `Trace completed: ${run.segments.length} segments. Review the unresolved power before interpreting weak paths.`;
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
  async function action(a, index) {
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
      if (a.startsWith("view-")) view = a.slice(5);
      if (a === "benchmarks") {
        benchmarks = runRayBenchmarks();
        message = `${benchmarks.filter((b) => b.pass).length}/${benchmarks.length} analytical physics checks passed.`;
      }
      if (a === "capture") {
        editIndex = null;
        scene = sceneFromBench(getProject());
        run = null;
        message =
          "Bench copied into a separate ray study. Resolve every missing surface model before tracing.";
      }
      if (a.startsWith("example-")) {
        editIndex = null;
        scene = rayExample(a.slice(8));
        run = null;
        message = "Example scene loaded; live bench unchanged.";
      }
      if (a === "add-object") {
        scene.objects.push(
          newRayObject(root.querySelector("[data-add-kind]").value),
        );
        editIndex = scene.objects.length - 1;
        render();
        root.querySelector("[data-object-select]").value = String(
          scene.objects.length - 1,
        );
        objectEditor(scene.objects.length - 1);
        return;
      }
      if (a === "remove-object") {
        scene.objects.splice(Number(index), 1);
        editIndex = null;
      }
      if (a === "add-source") {
        const src = structuredClone(rayExample().sources[0]);
        src.id = crypto.randomUUID();
        src.label = "Additional source";
        scene.sources.push(src);
      }
      if (a === "remove-source") scene.sources.splice(Number(index), 1);
      if (a === "trace") {
        await trace();
        return;
      }
      if (a === "save-scene") {
        const saved = validateRayScene(scene);
        saved.id = crypto.randomUUID();
        await store.save(saved);
        history = await store.list();
        message = "Scene saved in this browser.";
      }
      if (a === "export-scene")
        download(
          "optibench-ray-scene.json",
          JSON.stringify(validateRayScene(scene)),
        );
      if (a === "save-run") {
        await store.save(run);
        history = await store.list();
        message = "Complete ray run saved in this browser.";
      }
      if (a === "export-run")
        download("optibench-ray-audit.json", JSON.stringify(run));
      if (a === "replay") {
        scene = structuredClone(run.scene);
        message = "Recorded scene restored. Trace again to recompute.";
      }
      if (a === "open") {
        const saved = history.find(
          (r) => r.id === root.querySelector("[data-history]").value,
        );
        if (!saved) throw Error("Choose a saved record.");
        if (saved.format.endsWith("-run")) {
          run = structuredClone(saved);
          scene = structuredClone(run.scene);
        } else {
          scene = validateRayScene(saved);
          run = null;
        }
        message = "Saved record opened.";
      }
      if (a === "detector-csv")
        download(
          "detector-irradiance.csv",
          detectorCSV(run, root.querySelector("[data-detector]").value),
          "text/csv",
        );
      if (a === "path-csv")
        download("ray-paths.csv", pathCSV(groups()), "text/csv");
    } catch (e) {
      message = e.message;
    }
    render();
  }
  return {
    async open() {
      if (!root) {
        scene = sceneFromBench(getProject());
        root = document.createElement("section");
        root.id = "nonsequential-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const b = e.target.closest("[data-ray]");
          if (b) void action(b.dataset.ray, b.dataset.index);
        };
        root.onchange = async (e) => {
          if (job) return;
          const t = e.target;
          try {
            if (t.matches("[data-object-select]")) {
              editIndex = t.value === "" ? null : Number(t.value);
              root.querySelector("[data-object-editor]").innerHTML = "";
              if (editIndex !== null) objectEditor(editIndex);
              return;
            }
            if (t.matches("[data-detector]")) {
              drawDetector();
              return;
            }
            if (t.matches("[data-path]")) selected = t.value;
            else if (t.dataset.filter) {
              filter[t.dataset.filter] =
                t.dataset.filter === "reflections"
                  ? t.value === ""
                    ? null
                    : Number(t.value)
                  : t.value;
              selected = "";
            } else if (t.matches("[data-import-scene]")) {
              const f = t.files?.[0];
              if (!f) return;
              if (f.size > 2 * 1024 * 1024)
                throw Error("Scene imports are limited to 2 MB.");
              scene = parseRayScene(await f.text());
              run = null;
              message = "Scene imported. Trace to compute fresh results.";
            } else if (t.matches("[data-scene-name]")) scene.name = t.value;
            else {
              const objectNode = t.closest("[data-object]"),
                sourceNode = t.closest("[data-source]"),
                obj = objectNode
                  ? scene.objects[Number(objectNode.dataset.object)]
                  : sourceNode
                    ? scene.sources[Number(sourceNode.dataset.source)]
                    : scene;
              if (t.matches("[data-kind]")) {
                obj.kind = t.value;
                message =
                  "Explicit parametric surface model selected; verify dimensions before tracing.";
              } else if (t.matches("[data-material]")) obj.material = t.value;
              else if (t.matches("[data-shape]")) obj.shape = t.value;
              else if (t.matches("[data-object-label]")) obj.label = t.value;
              else if (t.matches("[data-unpolarized]"))
                obj.unpolarized = t.checked;
              else if (t.dataset.number) {
                const keys = t.dataset.number.split("."),
                  val = t.value === "" ? NaN : Number(t.value);
                if (keys.length === 2) obj[keys[0]][keys[1]] = val;
                else obj[keys[0]] = val;
              } else return;
              if (objectNode) {
                editIndex = Number(objectNode.dataset.object);
                message = "Scene edited. Trace rays to update results.";
                render();
                return;
              }
              message = "Scene edited. Trace rays to update results.";
            }
          } catch (error) {
            message = error.message;
          }
          render();
        };
      }
      showWorkspace(root);
      render();
      try {
        history = await store.list();
      } catch (e) {
        message = e.message;
      }
      render();
    },
  };
}
