import { TaskWorker } from "./task-worker.js";
import {
  createArchive,
  recomputeArchive,
  guidedArchive,
} from "./experiment-archive.js";
import { archiveStore } from "./run-store.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function createArchivePanel({
  capture,
  restore,
  download,
  store = archiveStore,
  onBusy = () => {},
}) {
  let root,
    entries = [],
    parent = null,
    title = "",
    revisionName = "",
    revisionNotes = "",
    message = "",
    check = null,
    busy = false;
  async function refresh() {
    try {
      entries = (await store.list())
        .filter((a) => a.format === "optibench-experiment")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      if (root) render(root);
    } catch (e) {
      message = e.message;
      if (root) render(root);
    }
  }
  async function open(a) {
    busy = true;
    onBusy(true);
    message = "Recomputing archived source data…";
    render(root);
    try {
      let computed;
      if (typeof Worker === "undefined") computed = recomputeArchive(a);
      else {
        const w = new TaskWorker(
          new URL("./archive-worker.js", import.meta.url),
          {
            type: "module",
          },
        );
        try {
          computed = await new Promise((resolve, reject) => {
            w.onmessage = ({ data }) =>
              data.error ? reject(Error(data.error)) : resolve(data.result);
            w.onerror = () =>
              reject(Error("Archive reconstruction worker failed."));
            w.postMessage(a);
          });
        } finally {
          w.terminate();
        }
      }
      await restore(a, computed);
      parent = a;
      title = a.title;
      revisionName = "";
      revisionNotes = "";
      check = computed;
      message = computed.summary + ". " + computed.review;
    } finally {
      busy = false;
      onBusy(false);
      render(root);
    }
  }
  function render(target) {
    root = target;
    if (!root) return;
    root.innerHTML = `<section class="measurement-records"><h2>Complete experiment archive</h2><p>Immutable named revisions keep the bench, current source/calibration frames, reference, selected repeat study and uncertainty record together. Stored on this browser; export JSON for backup.</p><div class="measurement-two"><label>Experiment title<input data-archive-field="title" value="${esc(title)}" maxlength="120"></label><label>Revision name<input data-archive-field="revisionName" value="${esc(revisionName)}" maxlength="120" placeholder="e.g. Calibration review"></label></div><label>Revision notes<textarea data-archive-field="revisionNotes" maxlength="10000">${esc(revisionNotes)}</textarea></label><p>${parent ? "Next revision branches from " + esc(parent.revisionName) : "New experiment history"}</p><div class="measurement-buttons"><button data-archive="save" ${busy ? "disabled" : ""}>Save revision</button><button data-archive="new" ${busy ? "disabled" : ""}>New history</button><button data-archive="import" ${busy ? "disabled" : ""}>Open archive JSON</button><button data-archive="guided" ${busy ? "disabled" : ""}>Guided synthetic experiment</button></div><p role="status">${esc(message)}</p>${check ? `<details open><summary>Recomputation: ${esc(check.summary)}</summary><p>Numeric comparison tolerance: scalar 10⁻⁷ + 10⁻⁹ × |saved|; maps 10⁻⁷ nm and identical masks.</p><ul>${check.checks.map((c) => `<li>${esc(c.label)}: <b>${esc(c.status)}</b>${c.delta != null ? " · Δ " + c.delta.toExponential(3) : ""}${c.maxDifferenceNm != null ? " · max Δ " + c.maxDifferenceNm.toExponential(3) + " nm" : ""}</li>`).join("")}${check.warnings.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>` : ""}<div class="measurement-table-scroll"><table><thead><tr><th>Experiment / revision</th><th>Saved / evidence</th><th>Notes / parent</th><th>Actions</th></tr></thead><tbody>${entries.map((a) => `<tr><td>${esc(a.title)}<small>${esc(a.revisionName)}</small></td><td>${esc(a.createdAt)}<small>${esc(a.evidence)}</small></td><td>${esc(a.revisionNotes)}<small>${esc(a.parentRevisionId || "Root revision")}</small></td><td><button data-archive="open" data-id="${esc(a.id)}">Open & recompute</button><button data-archive="export" data-id="${esc(a.id)}">Export</button></td></tr>`).join("")}</tbody></table></div><details><summary>Guided workflow</summary><ol><li>Load the guided synthetic experiment to restore an illustrative Michelson layout and three analytical acquisitions. The frames are not calculated from that layout.</li><li>Review phase maps, profiles and the repeatability study below.</li><li>Inspect the synthetic calibration and uncertainty budget; its values are illustrative.</li><li>Return to the bench and use Validate to run known-answer benchmarks.</li><li>Give your revision a name, save it, export it, and reopen it to check reproducibility.</li></ol></details><input type="file" accept=".json" hidden></section>`;
    root.onchange = (e) => {
      if (e.target.dataset.archiveField) {
        e.stopPropagation();
        const k = e.target.dataset.archiveField;
        if (["title", "revisionName", "revisionNotes"].includes(k))
          ({
            title: (v) => (title = v),
            revisionName: (v) => (revisionName = v),
            revisionNotes: (v) => (revisionNotes = v),
          })[k](e.target.value);
        return;
      }
      if (e.target.files?.length) {
        e.stopPropagation();
        const f = e.target.files[0];
        (async () => {
          try {
            if (busy) return;
            if (f.size > 250 * 1024 * 1024)
              throw Error("Archive exceeds 250 MB.");
            await open(JSON.parse(await f.text()));
          } catch (e) {
            message = e.message;
            render(root);
          }
        })();
      }
    };
    root.onclick = async (e) => {
      const b = e.target.closest("[data-archive]");
      if (!b) return;
      e.stopPropagation();
      if (busy) return;
      try {
        switch (b.dataset.archive) {
          case "save": {
            const a = createArchive({
              ...capture(),
              title,
              revisionName,
              revisionNotes,
              parent,
            });
            await store.save(a);
            parent = a;
            title = a.title;
            revisionName = "";
            revisionNotes = "";
            message =
              "Immutable revision saved. Export it for a portable backup.";
            await refresh();
            break;
          }
          case "new":
            parent = null;
            title = "";
            revisionName = "";
            revisionNotes = "";
            check = null;
            message = "New experiment history selected.";
            render(root);
            break;
          case "import":
            root.querySelector("input[type=file]").click();
            break;
          case "open":
            await open(entries.find((a) => a.id === b.dataset.id));
            break;
          case "guided":
            await open(guidedArchive());
            message =
              "Guided synthetic experiment loaded. Follow the workflow below, then save a named revision.";
            render(root);
            break;
          case "export":
            download(
              "optibench-experiment.json",
              JSON.stringify(entries.find((a) => a.id === b.dataset.id)),
            );
            break;
        }
      } catch (e) {
        message = e.message;
        render(root);
      }
    };
  }
  return { render, refresh, open };
}
