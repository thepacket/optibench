import { scanStore } from "./polarization-scan.js";
import { TaskWorker } from "./task-worker.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const fmt = (v) => (Number.isFinite(v) ? v.toPrecision(5) : "—");
function plot(scan) {
  const pts = scan.points.filter(
    (p) => !p.reading.overload && Number.isFinite(p.reading.valueMw),
  );
  if (!pts.length) return "<p>No valid readings to plot.</p>";
  const { start, end } = scan.options,
    f = scan.fit,
    curve = Array.from({ length: 201 }, (_, i) => {
      const angle = start + ((end - start) * i) / 200,
        t = ((angle * Math.PI) / 180) * (f?.harmonic || 2);
      return {
        angle,
        y: f
          ? f.coefficients[0] +
            f.coefficients[1] * Math.cos(t) +
            f.coefficients[2] * Math.sin(t)
          : 0,
      };
    });
  const values = [
      0,
      ...pts.map((p) => p.reading.valueMw),
      ...(f ? curve.map((p) => p.y) : []),
    ],
    lo = Math.min(...values),
    hi = Math.max(...values),
    span = hi - lo || 1,
    x = (a) => 65 + ((a - start) / (end - start)) * 620,
    y = (v) => 230 - ((v - lo) / span) * 195;
  return `<svg viewBox="0 0 730 280" role="img" aria-label="Measured optical power versus angle, with harmonic fit" style="width:100%;max-height:380px"><path d="M65 25V230H690" fill="none" stroke="#92a3b5"/>${f ? `<polyline points="${curve.map((p) => `${x(p.angle)},${y(p.y)}`).join(" ")}" fill="none" stroke="#b5df71" stroke-width="2"/>` : ""}${pts.map((p) => `<circle cx="${x(p.angle)}" cy="${y(p.reading.valueMw)}" r="3" fill="#70c9f1"/>`).join("")}<g fill="currentColor" font-size="12"><text x="65" y="16">Power · mW (${fmt(lo)} to ${fmt(hi)})</text><text x="65" y="250">${start}°</text><text x="660" y="250">${end}°</text><text x="255" y="272">Angle · degrees | blue: readings · green: fit</text></g></svg>`;
}
export function createScanPanel({ getContext, store = scanStore, run } = {}) {
  let root,
    record = null,
    history = [],
    busy = false,
    message = "",
    options = { componentId: null, start: 0, end: 180, count: 37 };
  function render() {
    if (!root) return;
    const ctx = getContext(),
      items = ctx.project.items.filter(
        (x) => x.enabled && ["waveplate", "polarizer"].includes(x.type),
      );
    if (!items.some((x) => x.id === options.componentId))
      options.componentId = items[0]?.id ?? null;
    root.innerHTML = `<h2>Polarization angle scan</h2><p>Scan a frozen copy of the current bench using the meter settings above. Half-wave plate: 90° period; analyzer: 180° period. Use one source and one analyzer on a straight path.</p><fieldset ${busy ? "disabled" : ""}><legend>Scan settings</legend><label>Rotate<select data-scan-field="componentId">${items.map((x) => `<option value="${x.id}">${esc(x.label)} · ${esc(x.type)}</option>`).join("")}</select></label>${[
      ["start", "Start · °", -360, 360],
      ["end", "End · °", -360, 360],
      ["count", "Number of readings", 9, 181],
    ]
      .map(
        ([key, label, min, max]) =>
          `<label>${label}<input type="number" required min="${min}" max="${max}" step="${key === "count" ? 1 : "any"}" data-scan-field="${key}" value="${options[key]}"></label>`,
      )
      .join(
        "",
      )}<button data-scan-action="run" ${!items.length ? "disabled" : ""}>Acquire angle scan</button></fieldset><p role="status">${esc(message)}</p>${record ? `${plot(record)}<p>${esc(record.acquiredAt)} · ${esc(record.component.label)} · ${record.settings.averages} samples per angle · range ${record.settings.rangeMw} mW</p>${record.fit ? `<p>Maximum-transmission axis: ${fmt(record.fit.axisDeg)}° (modulo ${360 / record.fit.harmonic}°) · contrast: ${fmt(record.fit.contrast === null ? null : record.fit.contrast * 100)}% · system extinction ratio: ${fmt(record.fit.extinctionRatio)}</p><p>Residual RMS: ${fmt(record.fit.rmsMw)} mW · R²: ${fmt(record.fit.rSquared)} · ${record.fit.valid} fitted / ${record.fit.excluded} excluded readings</p>${record.fit.warnings.map((w) => `<p class="instrument-warning">${esc(w)}</p>`).join("")}` : `<p class="instrument-warning">${esc(record.fitError)}</p>`}<p>${esc(record.model)}</p><div class="measurement-buttons"><button data-scan-action="save">Save scan</button><button data-scan-action="json">Export scan JSON</button><button data-scan-action="csv">Export scan CSV</button></div>` : ""}<h3>Saved angle scans</h3><select data-scan-history><option value="">Choose a scan</option>${history.map((s) => `<option value="${esc(s.id)}">${esc(s.acquiredAt)} · ${esc(s.component.label)}</option>`).join("")}</select><button data-scan-action="open">Open scan</button><p>Saved records include raw samples, each angle’s bench snapshot, zero calibration and fit diagnostics. JSON exports include simulator truth separately; the fit uses measured readings only.</p>`;
    root.querySelector('[data-scan-field="componentId"]').value = String(
      options.componentId ?? "",
    );
  }
  async function action(a) {
    if (busy) return;
    try {
      if (a === "run") {
        if ([...root.querySelectorAll("input")].some((x) => !x.checkValidity()))
          throw Error("Enter valid scan settings.");
        const ctx = getContext(),
          data = {
            ...ctx,
            options: {
              ...options,
              zero: ctx.zero,
              seed: crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648,
            },
          };
        busy = true;
        message = "Acquiring angle scan…";
        render();
        record = await (run
          ? run(data)
          : new Promise((resolve, reject) => {
              const worker = new TaskWorker(
                new URL("./polarization-scan-worker.js", import.meta.url),
                { type: "module" },
              );
              worker.onmessage = (e) =>
                e.data.error
                  ? reject(Error(e.data.error))
                  : resolve(e.data.result);
              worker.onerror = (e) => reject(Error(e.message));
              worker.postMessage(data);
            }));
        message = "Scan complete. Save to retain this acquisition.";
      }
      if (a === "save") {
        await store.save(record);
        history = await store.list();
        message = "Scan saved locally.";
      }
      if (a === "open") {
        const r = history.find(
          (r) => r.id === root.querySelector("[data-scan-history]").value,
        );
        if (!r) throw Error("Choose a saved scan.");
        record = structuredClone(r);
        message = "Recorded scan opened; live bench settings unchanged.";
      }
      if (a === "json" || a === "csv") {
        const text =
          a === "json"
            ? JSON.stringify(record, null, 2)
            : "angle_deg,power_mw,overload,seed\n" +
              record.points
                .map((p) =>
                  [
                    p.angle,
                    p.reading.valueMw ?? "",
                    p.reading.overload,
                    p.reading.seed,
                  ].join(","),
                )
                .join("\n");
        const url = URL.createObjectURL(
            new Blob([text], {
              type: a === "json" ? "application/json" : "text/csv",
            }),
          ),
          link = document.createElement("a");
        link.href = url;
        link.download = "optibench-angle-scan." + a;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (e) {
      message = e.message;
    } finally {
      busy = false;
      render();
    }
  }
  return {
    mount(el) {
      root = el;
      root.onclick = (e) => {
        const a = e.target.closest("[data-scan-action]")?.dataset.scanAction;
        if (a) {
          e.stopPropagation();
          void action(a);
        }
      };
      root.onchange = (e) => {
        const key = e.target.dataset.scanField;
        if (key) {
          e.stopPropagation();
          if (e.target.checkValidity()) options[key] = Number(e.target.value);
        }
      };
      render();
      store
        .list()
        .then((h) => {
          history = h;
          render();
        })
        .catch((e) => {
          message = e.message;
          render();
        });
    },
  };
}
