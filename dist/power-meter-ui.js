import {
  meterDefaults,
  readMeter,
  makeZero,
  powerStore,
} from "./power-meter.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(6) : "—");
function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })),
    a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function createPowerWorkspace({
  getProject,
  getDetector,
  onDetector,
  store = powerStore,
} = {}) {
  let root,
    headId = null,
    c = meterDefaults(),
    zero = null,
    reading = null,
    history = [],
    message = "",
    truth = false,
    busy = false;
  function sync() {
    const p = getProject(),
      heads = p.items.filter((x) => x.type === "power" && x.enabled),
      preferred = getDetector?.();
    const next = heads.some((h) => h.id === preferred)
      ? preferred
      : heads.some((h) => h.id === headId)
        ? headId
        : (heads[0]?.id ?? null);
    if (next !== headId) {
      zero = null;
      headId = next;
    }
    return { p, heads };
  }
  function render() {
    const { p, heads } = sync(),
      stale =
        reading &&
        (JSON.stringify(reading.project) !== JSON.stringify(p) ||
          reading.detectorId !== headId ||
          JSON.stringify(reading.settings) !== JSON.stringify(c));
    root.innerHTML = `<header class="measurement-header"><button data-meter="close">← Optical bench</button><h1>Optical power meter</h1><span>Simulated instrument</span></header><main class="instrument-main"><h2>Live bench · ${esc(p.title)}</h2><p role="status">${esc(message)}</p><div class="instrument-grid"><aside class="instrument-controls"><fieldset ${busy ? "disabled" : ""}><legend>Meter configuration</legend><label>Detector head<select data-meter-setting="head"><option value="">Choose a head</option>${heads.map((h) => `<option value="${h.id}" ${h.id === headId ? "selected" : ""}>${esc(h.label)} · ${esc(h.part)}</option>`).join("")}</select></label><p>Generic silicon response model · 400–1100 nm. Bench head geometry is used; this is not a vendor calibration.</p><label>Wavelength setting · nm<input type="number" min="400" max="1100" step="any" required data-meter-setting="wavelength" value="${c.wavelength}"></label><label>Range · mW<select data-meter-setting="rangeMw">${[0.0001, 0.001, 0.01, 0.1, 1, 10, 100].map((v) => `<option ${v === c.rangeMw ? "selected" : ""}>${v}</option>`).join("")}</select></label><label>Averaging · samples<select data-meter-setting="averages">${[1, 4, 16, 64, 256].map((v) => `<option ${v === c.averages ? "selected" : ""}>${v}</option>`).join("")}</select></label><label><input type="checkbox" data-meter-setting="shutter" ${c.shutter ? "checked" : ""}>Internal shutter closed</label><details><summary>Noise & offset assumptions</summary><label>Dark offset · nA<input type="number" min="-1000" max="1000" step="any" required data-meter-setting="darkNa" value="${c.darkNa}"></label><label>Noise · nA RMS per sample<input type="number" min="0" max="1000" step="any" required data-meter-setting="noiseNa" value="${c.noiseNa}"></label></details></fieldset><div class="measurement-buttons"><button data-meter="read" ${busy || !headId ? "disabled" : ""}>Acquire reading</button><button data-meter="zero" ${busy || !headId || !c.shutter ? "disabled" : ""}>Zero with shutter closed</button><button data-meter="clear-zero">Clear zero</button></div><p>${zero ? "Zero captured " + esc(zero.acquiredAt) : "No zero calibration"}. Changing head, wavelength, range or noise/offset assumptions clears the zero. Open the shutter to measure the beam.</p></aside><section class="instrument-results"><h2>Recorded measurement</h2>${stale ? '<p class="instrument-warning">Live settings differ from this recorded reading. Acquire again to measure the current setup.</p>' : ""}<div class="power-readout" role="status">${reading ? (reading.overload ? "OVERLOAD" : fmt(reading.valueMw) + " mW") : "— mW"}</div>${reading ? `<p>${esc(reading.acquiredAt)} · ${esc(reading.head.label)} · ${reading.settings.wavelength} nm · range ${reading.settings.rangeMw} mW · ${reading.settings.averages} samples · shutter ${reading.settings.shutter ? "closed" : "open"}</p><p>Resolution: ${fmt(reading.resolutionMw)} mW. Sample SD: ${fmt(reading.sampleSdMw)} mW.</p>${reading.overload ? '<p class="instrument-warning">At least one raw sample exceeded the range before zero correction. Increase the range; no valid reading is reported.</p>' : ""}${reading.warnings.map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("")}` : "<p>Select an enabled power head on the bench. Each acquisition records the current layout and meter settings.</p>"}<div class="measurement-buttons"><button data-meter="save" ${!reading || busy ? "disabled" : ""}>Save reading</button><button data-meter="json" ${!reading ? "disabled" : ""}>Export reading JSON</button><button data-meter="csv" ${!reading ? "disabled" : ""}>Export samples CSV</button></div><label class="measurement-check"><input data-meter-truth type="checkbox" ${truth ? "checked" : ""}>Show simulator truth</label>${truth && reading ? `<div class="instrument-truth"><h3>Simulator truth · not measured</h3><p>Incident ${fmt(reading.truth.incidentPowerMw)} mW · admitted ${fmt(reading.truth.admittedPowerMw)} mW · ${reading.truth.paths} traced paths</p></div>` : ""}<h3>Saved readings</h3><select data-meter-history><option value="">Choose a saved reading</option>${history.map((r) => `<option value="${esc(r.id)}">${esc(r.acquiredAt)} · ${esc(r.head.label)} · ${r.overload ? "OVERLOAD" : fmt(r.valueMw) + " mW"}</option>`).join("")}</select><button data-meter="open">Open recorded reading</button><p>Opening a record leaves live bench and instrument settings unchanged. Readings and raw samples are simulated; sample scatter is not a calibrated uncertainty budget.</p><details><summary>Model limits</summary><p>${esc(reading?.model || "Generic silicon response, dark offset, independent Gaussian current noise and fixed-scene averaging. Circular Gaussian-beam aperture integration; supported two-path interference is integrated coherently. No hardware calibration or thermal detector dynamics.")}</p></details></section></div></main>`;
    for (const key of ["rangeMw", "averages"])
      root.querySelector(`[data-meter-setting="${key}"]`).value = String(
        c[key],
      );
    root.querySelector('[data-meter-setting="head"]').value =
      headId == null ? "" : String(headId);
  }
  async function action(a) {
    if (busy) return;
    if (a === "close") {
      closeWorkspace(root);
      return;
    }
    try {
      if (a === "read" || a === "zero") {
        if (
          [...root.querySelectorAll('input[type="number"]')].some(
            (x) => !x.checkValidity(),
          )
        )
          throw Error("Enter valid meter settings.");
        sync();
        const seed = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648;
        const r = readMeter(getProject(), headId, c, {
          seed,
          zero: a === "zero" ? null : zero,
        });
        if (a === "zero") {
          zero = makeZero(r);
          message =
            "Zero captured. Open the internal shutter before measuring.";
        } else {
          reading = r;
          message = r.overload
            ? "Reading overloaded."
            : "New reading acquired. Save it to retain the bench snapshot.";
        }
      }
      if (a === "clear-zero") {
        zero = null;
        message = "Zero cleared.";
      }
      if (a === "save") {
        busy = true;
        await store.save(reading);
        history = await store.list();
        message = "Reading and bench snapshot saved locally.";
      }
      if (a === "open") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-meter-history]").value,
        );
        if (!r) throw Error("Choose a saved reading.");
        reading = structuredClone(r);
        truth = false;
        message = "Recorded measurement opened. Live settings unchanged.";
      }
      if (a === "json")
        download(
          "optibench-power-reading.json",
          JSON.stringify(reading, null, 2),
          "application/json",
        );
      if (a === "csv")
        download(
          "optibench-power-samples.csv",
          "acquired_at,sample,raw_mw,zero_offset_mw,range_mw,overload\n" +
            reading.samplesMw
              .map((v, i) =>
                [
                  reading.acquiredAt,
                  i + 1,
                  v,
                  reading.zero?.offsetMw || 0,
                  reading.settings.rangeMw,
                  reading.overload,
                ].join(","),
              )
              .join("\n"),
          "text/csv",
        );
    } catch (e) {
      message = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  return {
    async open() {
      if (!root) {
        root = document.createElement("section");
        root.id = "power-workspace";
        document.body.append(root);
        root.onclick = (e) => {
          const a = e.target.closest("[data-meter]")?.dataset.meter;
          if (a) void action(a);
        };
        root.onchange = (e) => {
          if (busy) return;
          if (e.target.matches("[data-meter-truth]")) {
            truth = e.target.checked;
            render();
            return;
          }
          const key = e.target.dataset.meterSetting;
          if (!key) return;
          if (!e.target.checkValidity()) return;
          if (key === "head") {
            headId = Number(e.target.value) || null;
            onDetector?.(headId);
            zero = null;
          } else {
            c[key] =
              key === "shutter" ? e.target.checked : Number(e.target.value);
            if (!["shutter", "averages"].includes(key)) zero = null;
          }
          message = "Live settings updated; recorded reading unchanged.";
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
