import { profilerStore, profilerExample } from "./beam-profiler.js";
import { TaskWorker } from "./task-worker.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
function graph(series, label, xLabel, yLabel) {
  const all = series.flatMap((s) => s.points);
  if (!all.length) return "";
  const loX = Math.min(...all.map((p) => p[0])),
    hiX = Math.max(...all.map((p) => p[0])),
    loY = Math.min(0, ...all.map((p) => p[1])),
    hiY = Math.max(...all.map((p) => p[1])),
    x = (v) => 55 + ((v - loX) / (hiX - loX || 1)) * 600,
    y = (v) => 180 - ((v - loY) / (hiY - loY || 1)) * 150;
  return `<figure class="profile-chart"><figcaption>${esc(label)}</figcaption><svg viewBox="0 0 710 225" role="img" aria-label="${esc(label)}"><path d="M55 25V180H660" fill="none" stroke="#708696"/>${series.map((s) => (s.dots ? s.points.map((p) => `<circle cx="${x(p[0])}" cy="${y(p[1])}" r="3" fill="${s.color}"/>`).join("") : `<polyline points="${s.points.map((p) => `${x(p[0])},${y(p[1])}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="1.6"/>`)).join("")}<g fill="currentColor" font-size="11"><text x="55" y="16">${esc(yLabel)} · ${fmt(loY)} to ${fmt(hiY)}</text><text x="55" y="198">${fmt(loX)}</text><text x="620" y="198">${fmt(hiX)}</text><text x="280" y="219">${esc(xLabel)}</text></g></svg></figure>`;
}
function profileGraphs(r) {
  const a = r.analysis;
  if (!a) return "";
  const n = r.frame.n,
    pitch = r.camera.pixelPitch / 1000;
  return ["x", "y"]
    .map((axis) => {
      const fit = axis === "x" ? a.fitX : a.fitY,
        points = (v) => v.map((y, i) => [(i + 0.5 - n / 2) * pitch, y]);
      return (
        graph(
          [
            { points: points(a.profiles[axis]), color: "#6bc9ec" },
            ...(fit ? [{ points: points(fit.fitted), color: "#b7e97d" }] : []),
          ],
          `${axis.toUpperCase()} integrated profile · blue measured / green Gaussian`,
          "Sensor position · mm",
          "Summed normalized ADC",
        ) +
        (fit
          ? graph(
              [{ points: points(fit.residuals), color: "#e9b86f" }],
              `${axis.toUpperCase()} fit residual · RMS ${fmt(fit.rms)}`,
              "Sensor position · mm",
              "Measured − fit",
            )
          : "")
      );
    })
    .join("");
}
function scanGraph(r) {
  return graph(
    ["x", "y"].flatMap((axis, i) => {
      const color = i ? "#b7e97d" : "#6bc9ec",
        key = i ? "diameterYmm" : "diameterXmm",
        f = r.fits[axis];
      return [
        {
          color,
          dots: true,
          points: r.points
            .filter((p) => p.record.analysis?.valid)
            .map((p) => [p.positionMm, p.record.analysis[key]]),
        },
        ...(f
          ? [
              {
                color,
                points: Array.from({ length: 101 }, (_, i) => {
                  const z =
                      r.travel.start +
                      ((r.travel.end - r.travel.start) * i) / 100,
                    t = (z - f.mid) / f.scale;
                  return [
                    z,
                    2 *
                      Math.sqrt(
                        Math.max(
                          0,
                          f.coefficients[0] +
                            f.coefficients[1] * t +
                            f.coefficients[2] * t * t,
                        ),
                      ),
                  ];
                }),
              },
            ]
          : []),
      ];
    }),
    "Propagation · blue X / green Y · dots measured / curves fitted",
    "Camera travel · mm",
    "D4σ diameter · mm",
  );
}
export function createProfilerWorkspace({
  getProject,
  getDetector,
  onDetector,
  onBench,
  store = profilerStore,
  run,
} = {}) {
  let root,
    record = null,
    history = [],
    message = "",
    busy = false,
    selectedFrame = 0;
  const settings = {
      detectorId: null,
      n: 256,
      exposure: 2,
      backgroundFrames: 8,
    },
    travel = { start: -100, end: 100, count: 11 };
  function sync() {
    const p = getProject(),
      cameras = p.items.filter((c) => c.enabled && c.type === "camera");
    if (!cameras.some((c) => c.id === settings.detectorId)) {
      settings.detectorId =
        cameras.find((c) => c.id === getDetector?.())?.id ??
        cameras[0]?.id ??
        null;
      const camera = cameras.find((c) => c.id === settings.detectorId);
      if (camera) settings.exposure = camera.exposure;
    }
    return { p, cameras };
  }
  function render() {
    if (!root) return;
    const { p, cameras } = sync(),
      scan = record?.format === "optibench-beam-scan",
      r = scan
        ? record.points[Math.min(selectedFrame, record.points.length - 1)]
            .record
        : record,
      a = r?.analysis;
    root.innerHTML = `<header class="measurement-header"><button data-profiler="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Camera beam profiler</h1><span>Simulated instrument</span></header><main class="instrument-main"><h2>${esc(p.title)}</h2><p role="status">${esc(message)}</p><div class="instrument-grid"><aside class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Camera acquisition</legend><label>Camera<select data-profile-setting="detectorId">${cameras.map((c) => `<option value="${c.id}">${esc(c.label)}</option>`).join("")}</select></label><label>Exposure · ms<input type="number" min="0.001" max="10000" step="any" required data-profile-setting="exposure" value="${settings.exposure}"></label><label>Native-pixel square ROI<select data-profile-setting="n">${[64, 128, 256, 512].map((n) => `<option value="${n}">${n} × ${n}</option>`).join("")}</select></label><label>Shutter-closed background average<select data-profile-setting="backgroundFrames">${[1, 4, 8, 16].map((n) => `<option value="${n}">${n} frames</option>`).join("")}</select></label><button data-profiler="acquire" ${!cameras.length ? "disabled" : ""}>Acquire beam frame</button><p>Exposure is applied to this acquisition. Pixel pitch, noise, QE, gain and full well come from the bench camera. Background is acquired at matching settings.</p></fieldset><fieldset ${busy ? "disabled" : ""}><legend>Detector-position scan</legend>${[
      ["start", "Start travel · mm", -1500, 1500],
      ["end", "End travel · mm", -1500, 1500],
      ["count", "Positions", 7, 21],
    ]
      .map(
        ([k, l, min, max]) =>
          `<label>${l}<input required type="number" min="${min}" max="${max}" step="${k === "count" ? 1 : "any"}" data-profile-travel="${k}" value="${travel[k]}"></label>`,
      )
      .join(
        "",
      )}<button data-profiler="scan" ${!cameras.length ? "disabled" : ""}>Acquire propagation scan</button><p>Travel follows the camera normal from its current position. Keep the scan in free space and bracket the waist. Use an ROI up to 256 pixels for scans.</p></fieldset><button data-profiler="example" ${busy ? "disabled" : ""}>Load focused-beam example</button><p>Loads a new bench layout. Acquisitions and scans use frozen copies of the current bench.</p></aside><section class="instrument-results">${
      r
        ? `<h2>Recorded acquisition</h2><p>${esc(r.acquiredAt)} · ${esc(r.camera.label)} · ${r.settings.exposure} ms · ${r.frame.n} × ${r.frame.n} pixels</p>${scan ? `<label>Recorded scan frame<select data-profile-frame>${record.points.map((p, i) => `<option value="${i}">${fmt(p.positionMm)} mm · ${p.record.analysis?.valid ? "valid" : "flagged"}</option>`).join("")}</select></label>` : ""}<div class="instrument-readout"><figure><canvas data-profile-image width="${r.frame.n}" height="${r.frame.n}" aria-label="Background-subtracted camera image"></canvas><figcaption>Background-subtracted display, autoscaled for viewing. Analysis uses recorded ADC values.</figcaption></figure><div>${a ? `<dl><dt>Centroid · ROI-relative X / Y</dt><dd>${fmt(a.centroidXmm)} / ${fmt(a.centroidYmm)} mm</dd><dt>D4σ diameter · X / Y</dt><dd>${fmt(a.diameterXmm)} / ${fmt(a.diameterYmm)} mm</dd><dt>Principal diameters · major / minor</dt><dd>${fmt(a.majorDiameterMm)} / ${fmt(a.minorDiameterMm)} mm</dd><dt>Ellipticity · minor / major</dt><dd>${fmt(a.ellipticity)}</dd><dt>Major-axis orientation</dt><dd>${a.orientationDeg === null ? "Unresolved · nearly circular" : fmt(a.orientationDeg) + "°"}</dd><dt>Clipped pixels</dt><dd>${fmt(a.saturatedFraction * 100)}%</dd></dl>` : `<p class="instrument-warning">${esc(r.analysisError)}</p>`}</div></div>${[...(a?.warnings || []), ...r.warnings].map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("")}${profileGraphs(r)}${
            scan
              ? `<h2>Measured propagation</h2>${scanGraph(record)}${["x", "y"]
                  .map((axis) => {
                    const f = record.fits[axis];
                    return f
                      ? `<p><strong>${axis.toUpperCase()}</strong> waist radius ${fmt(f.waistRadiusMm)} mm · waist at ${fmt(f.waistPositionMm)} mm travel · divergence half-angle ${fmt(f.halfAngleMrad)} mrad</p><p>Radius-squared residual RMS ${fmt(f.rmsRadiusSquaredMm2)} mm² · ${f.valid} fitted / ${f.excluded} excluded positions</p>`
                      : `<p class="instrument-warning">${axis.toUpperCase()}: ${esc(record.errors[axis])}</p>`;
                  })
                  .join("")}<p>${esc(record.model)}</p>`
              : ""
          }<div class="measurement-buttons"><button data-profiler="save" ${busy ? "disabled" : ""}>Save ${scan ? "scan" : "frame"}</button><button data-profiler="json">Export complete JSON</button><button data-profiler="csv">Export ${scan ? "widths" : "profiles"} CSV</button></div><details><summary>Acquisition model and method</summary><p>${esc(r.model)}</p><p>Diameter = four standard deviations of the intensity distribution. Gaussian fits are shown for comparison. Orientation is withheld for nearly circular beams.</p><a href="https://www.rp-photonics.com/beam_radius.html" target="_blank" rel="noreferrer">Beam-radius definitions</a></details>`
        : "<h2>Acquire a camera frame</h2><p>Select a bench camera or load the focused-beam example. The profiler measures recorded pixels after an averaged dark frame and border-offset correction.</p>"
    }<h3>Saved profiles and scans</h3><select data-profile-history><option value="">Choose a saved record</option>${history.map((r) => `<option value="${esc(r.id)}">${esc(r.acquiredAt)} · ${r.format === "optibench-beam-scan" ? "Propagation scan" : "Camera profile"}</option>`).join("")}</select><button data-profiler="open" ${busy ? "disabled" : ""}>Open record</button><p>Records are saved in this browser, including frames, averaged backgrounds, settings, bench snapshots and diagnostics. Export JSON for a portable copy. Opening a record leaves the live bench unchanged.</p></section></div></main>`;
    for (const key of ["detectorId", "n", "backgroundFrames"])
      root.querySelector(`[data-profile-setting="${key}"]`).value = String(
        settings[key] ?? "",
      );
    if (scan)
      root.querySelector("[data-profile-frame]").value = String(selectedFrame);
    if (r) {
      const canvas = root.querySelector("canvas"),
        ctx = canvas.getContext("2d");
      if (ctx) {
        const n = r.frame.n,
          img = ctx.createImageData(n, n),
          data = r.frame.values.map((v, i) =>
            Math.max(0, v - r.dark[i] - (r.analysis?.borderOffset || 0)),
          ),
          max = data.reduce((m, v) => Math.max(m, v), 0) || 1;
        for (let i = 0; i < data.length; i++) {
          const v = Math.sqrt(data[i] / max);
          img.data[i * 4] = 255 * v;
          img.data[i * 4 + 1] = 220 * v;
          img.data[i * 4 + 2] = 105 * v;
          img.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(img, 0, 0);
      }
    }
  }
  async function action(action) {
    if (busy) return;
    try {
      if (action === "close") {
        closeWorkspace(root);
        return;
      }
      if (action === "example") {
        onBench?.(profilerExample());
        settings.detectorId = null;
        sync();
        message =
          "Focused-beam example loaded. Acquire a frame or scan from −100 to +100 mm.";
      }
      if (action === "acquire" || action === "scan") {
        if (
          [
            ...root.querySelectorAll(
              action === "scan" ? "input" : "input[data-profile-setting]",
            ),
          ].some((el) => !el.checkValidity())
        )
          throw Error("Enter valid acquisition settings.");
        sync();
        const data = {
          mode: action === "scan" ? "scan" : "frame",
          project: getProject(),
          settings: {
            ...settings,
            seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147482000,
          },
          travel: { ...travel },
        };
        busy = true;
        message = "Acquiring simulated camera data…";
        render();
        const result = await (run
          ? run(data)
          : new Promise((resolve, reject) => {
              const worker = new TaskWorker(
                new URL("./beam-profiler-worker.js", import.meta.url),
                { type: "module" },
              );
              worker.onmessage = (e) =>
                e.data.error
                  ? reject(Error(e.data.error))
                  : resolve(e.data.result);
              worker.onerror = (e) => reject(Error(e.message));
              worker.postMessage(data);
            }));
        record = result;
        selectedFrame = 0;
        message =
          "Acquisition complete. Results below belong to the recorded bench snapshot.";
      }
      if (action === "save") {
        await store.save(record);
        history = await store.list();
        message = "Camera data and bench snapshots saved locally.";
      }
      if (action === "open") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-profile-history]").value,
        );
        if (!r) throw Error("Choose a saved record.");
        record = structuredClone(r);
        selectedFrame = 0;
        message = "Recorded acquisition opened. Live settings unchanged.";
      }
      if (action === "json" || action === "csv") {
        const scan = record.format === "optibench-beam-scan",
          text =
            action === "json"
              ? JSON.stringify(record)
              : scan
                ? "travel_mm,diameter_x_mm,diameter_y_mm,valid\n" +
                  record.points
                    .map((p) =>
                      [
                        p.positionMm,
                        p.record.analysis?.diameterXmm ?? "",
                        p.record.analysis?.diameterYmm ?? "",
                        p.record.analysis?.valid ?? false,
                      ].join(","),
                    )
                    .join("\n")
                : "position_mm,profile_x,fit_x,residual_x,profile_y,fit_y,residual_y\n" +
                  (record.analysis
                    ? record.analysis.profiles.x
                        .map((v, i) =>
                          [
                            ((i + 0.5 - record.frame.n / 2) *
                              record.camera.pixelPitch) /
                              1000,
                            v,
                            record.analysis.fitX?.fitted[i] ?? "",
                            record.analysis.fitX?.residuals[i] ?? "",
                            record.analysis.profiles.y[i],
                            record.analysis.fitY?.fitted[i] ?? "",
                            record.analysis.fitY?.residuals[i] ?? "",
                          ].join(","),
                        )
                        .join("\n")
                    : "");
        const url = URL.createObjectURL(
            new Blob([text], {
              type: action === "json" ? "application/json" : "text/csv",
            }),
          ),
          link = document.createElement("a");
        link.href = url;
        link.download = `optibench-beam-${scan ? "scan" : "profile"}.${action}`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      message = e.message;
    } finally {
      busy = false;
      if (action !== "close") render();
    }
  }
  return {
    async open() {
      if (!root) {
        root = document.createElement("section");
        root.id = "profiler-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const a = e.target.closest("[data-profiler]")?.dataset.profiler;
          if (a) void action(a);
        };
        root.onchange = (e) => {
          if (busy) return;
          if (e.target.matches("[data-profile-frame]")) {
            selectedFrame = Number(e.target.value);
            render();
            return;
          }
          const k = e.target.dataset.profileSetting,
            t = e.target.dataset.profileTravel;
          if (!(k || t) || !e.target.checkValidity()) return;
          if (k) {
            settings[k] = Number(e.target.value);
            if (k === "detectorId") {
              onDetector?.(settings.detectorId);
              settings.exposure =
                getProject().items.find((c) => c.id === settings.detectorId)
                  ?.exposure || 2;
            }
          } else travel[t] = Number(e.target.value);
          message =
            "Acquisition settings changed; recorded results remain unchanged.";
          render();
        };
      }
      sync();
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
