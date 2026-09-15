import { createStoragePanel } from "./storage-panel.js";
import { showWorkspace, closeWorkspace } from "./workspace-state.js";
import { archiveStore, runStore, importProjectRecords } from "./run-store.js";
import {
  kinds,
  sourceBench,
  recordIndex,
  recordTitle,
  links,
  createLayout,
  createProjectBundle,
  validateBundle,
  planImport,
  searchRecord,
} from "./project-navigator.js";
import { comparisonHTML } from "./study-comparison-ui.js";
const esc = (v) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const download = (r) => {
  const u = URL.createObjectURL(
      new Blob([JSON.stringify(r)], { type: "application/json" }),
    ),
    a = document.createElement("a");
  a.href = u;
  a.download =
    (r.format === "optibench-project-bundle"
      ? "optibench-project"
      : "optibench-record") + ".json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(u), 1000);
};
export function createProjectNavigator({
  getProject,
  onOpen,
  onRequirements,
  archives = archiveStore,
  runs = runStore,
  importRecords = importProjectRecords,
}) {
  const storagePanel = createStoragePanel();
  let root,
    records = [],
    bundles = [],
    selected = new Set(),
    parent = null,
    title = "",
    notes = "",
    query = "",
    message = "",
    busy = false,
    report = null;
  async function refresh() {
    const [aa, rr] = await Promise.all([archives.list(), runs.list()]);
    records = [...aa, ...rr].filter((r) => Object.hasOwn(kinds, r.format));
    bundles = aa
      .filter((r) => r.format === "optibench-project-bundle")
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }
  function available() {
    const map = new Map(records.map((r) => [r.id, r]));
    for (const r of parent?.records || []) map.set(r.id, r);
    return [...map.values()];
  }
  function view() {
    return available().filter(
      (r) =>
        (!parent || parent.records.some((x) => x.id === r.id)) &&
        searchRecord(r, query),
    );
  }
  function projectTree() {
    const groups = new Map();
    for (const b of bundles) {
      const list = groups.get(b.projectId) || [];
      list.push(b);
      groups.set(b.projectId, list);
    }
    return [...groups.values()]
      .map(
        (list) =>
          `<details open><summary>${esc(list[0].title)}</summary>${list.map((b) => `<button class="navigator-project" data-nav="project" data-id="${esc(b.id)}"><b>${esc(b.title)}</b><small>${esc(b.createdAt)} · ${b.records.length} records</small></button>`).join("")}</details>`,
      )
      .join("");
  }
  function render() {
    const visible = view(),
      map = recordIndex(available());
    root.innerHTML = `<header class="measurement-header"><button data-nav="close" ${busy ? "disabled" : ""}>← Optical bench</button><h1>Projects & experiments</h1><button data-nav="requirements" ${busy ? "disabled" : ""}>Requirements & acceptance</button><button data-nav="refresh" ${busy ? "disabled" : ""}>Refresh</button><button data-nav="import" ${busy ? "disabled" : ""}>Import project backup</button></header><section id="navigator-storage"></section><div class="navigator-layout"><aside><h2>Project revisions</h2><button data-nav="all">All local records</button><button data-nav="new">New project</button>${projectTree()}<p>Records are stored in this browser. Export project backups for portability.</p></aside><main><div class="measurement-two"><label>Project name<input data-meta="title" maxlength="120" value="${esc(title)}"></label><label>Purpose / notes<textarea data-meta="notes" maxlength="10000">${esc(notes)}</textarea></label></div><p>${parent ? "Editing selection from saved project revision " + esc(parent.createdAt) + ". Saving creates a new revision." : "Select records for a new project revision."}</p><div class="measurement-buttons"><button data-nav="layout" ${busy ? "disabled" : ""}>Save current bench layout</button><button data-nav="select">Select visible records</button><button data-nav="clear">Clear selection</button><button data-nav="save" ${busy ? "disabled" : ""}>Save project revision (${selected.size})</button><button data-nav="export" ${parent && !busy ? "" : "disabled"}>Export saved project backup</button></div><label>Search records<input data-query value="${esc(query)}" placeholder="Name, component, date, ID or notes"></label><p role="status">${esc(message)}</p>${parent?.missingReferences?.length ? `<p>Missing referenced records: ${parent.missingReferences.map(esc).join(", ")}. The backup preserves those IDs but cannot include unavailable records.</p>` : ""}${Object.entries(
      kinds,
    )
      .map(([format, label]) => {
        const rows = visible.filter((r) => r.format === format);
        return `<details open class="navigator-group"><summary>${label} · ${rows.length}</summary>${
          rows
            .map(
              (r) =>
                `<article class="navigator-record"><label><input type="checkbox" data-select="${esc(r.id)}" ${selected.has(r.id) ? "checked" : ""}> <b>${esc(recordTitle(r))}</b> ${esc(r.revisionName)}</label><small>${esc(r.createdAt)} · ${esc(r.id)}</small><p>${esc(r.notes || r.revisionNotes || "")}</p>${sourceBench(r) ? `<p>Recorded source bench: ${esc(sourceBench(r).title)} · ${sourceBench(r).items.length} components <button data-nav="source" data-id="${esc(r.id)}">Restore source bench (undo available)</button></p>` : ""}<p>${
                  links(r)
                    .map((id) =>
                      map.has(id)
                        ? `Related revision: <button data-nav="related" data-id="${esc(map.get(id).id)}">${esc(recordTitle(map.get(id)))}</button>`
                        : `Missing reference: ${esc(id)}`,
                    )
                    .join(" · ") || "No explicit parent reference recorded."
                }</p><button data-nav="open" data-id="${esc(r.id)}" ${busy ? "disabled" : ""}>${format === "optibench-layout" ? "Restore layout (undo available)" : format === "optibench-alignment-study" ? "Open inputs for recomputation" : "Open & recompute"}</button><button data-nav="record-export" data-id="${esc(r.id)}">Export record</button></article>`,
            )
            .join("") || "<p>No matching records.</p>"
        }</details>`;
      })
      .join(
        "",
      )}${report ? `<section><h2>Recomputed comparison</h2>${comparisonHTML(report)}</section>` : ""}</main></div><input type="file" accept=".json" hidden data-import>`;
    storagePanel.mount(root.querySelector("#navigator-storage"));
  }
  async function action(e) {
    const b = e.target.closest("[data-nav]");
    if (!b || busy) return;
    const a = b.dataset.nav;
    if (a === "import") {
      root.querySelector("[data-import]").click();
      return;
    }
    try {
      if (a === "requirements") {
        await onRequirements?.(available());
        return;
      }
      if (a === "close") {
        root.hidden = true;
        document.querySelector("#app").inert = false;
        return;
      }
      if (a === "refresh") {
        busy = true;
        await refresh();
        message = "Local records refreshed.";
      }
      if (a === "all") {
        parent = null;
        query = "";
      }
      if (a === "new") {
        parent = null;
        selected.clear();
        title = "";
        notes = "";
        query = "";
        report = null;
      }
      if (a === "project") {
        parent = bundles.find((x) => x.id === b.dataset.id);
        title = parent.title;
        notes = parent.notes || "";
        selected = new Set(parent.records.map((r) => r.id));
        query = "";
        report = null;
      }
      if (a === "related") {
        parent = null;
        query = b.dataset.id;
      }
      if (a === "select") view().forEach((r) => selected.add(r.id));
      if (a === "clear") selected.clear();
      if (a === "layout") {
        busy = true;
        const r = createLayout(getProject(), getProject().title, notes);
        await archives.save(r);
        await refresh();
        selected.add(r.id);
        parent = null;
        message = "Current bench saved as a layout snapshot and selected.";
      }
      if (a === "save") {
        busy = true;
        const bundle = createProjectBundle(available(), [...selected], {
          title,
          notes,
          parent,
        });
        await archives.save(bundle);
        await refresh();
        parent = bundle;
        selected = new Set(bundle.records.map((r) => r.id));
        message = `Saved ${bundle.records.length} records, including available referenced revisions. ${bundle.missingReferences.length} missing references.`;
      }
      if (a === "export" && parent) download(parent);
      if (a === "record-export")
        download(available().find((r) => r.id === b.dataset.id));

      if (a === "source") {
        const r = available().find((r) => r.id === b.dataset.id);
        await onOpen(createLayout(sourceBench(r)), available());
        root.hidden = true;
      }
      if (a === "open") {
        busy = true;
        message = "Restoring inputs and recomputing where supported…";
        render();
        const r = available().find((r) => r.id === b.dataset.id),
          out = await onOpen(r, available());
        if (out?.format === "optibench-study-comparison") {
          report = out;
          message = "Comparison regenerated from both source revisions.";
        } else {
          root.hidden = true;
          message = "Opened in its analysis workspace.";
        }
      }
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
        root.id = "project-navigator";
        document.body.append(root);
        root.onclick = action;
        root.oninput = (e) => {
          if (e.target.dataset.meta) {
            if (e.target.dataset.meta === "title") title = e.target.value;
            else notes = e.target.value;
          }
          if (e.target.hasAttribute("data-query")) {
            query = e.target.value;
            const pos = e.target.selectionStart;
            render();
            const input = root.querySelector("[data-query]");
            input.focus();
            input.setSelectionRange(pos, pos);
          }
        };
        root.onchange = async (e) => {
          if (busy) return;
          if (e.target.dataset.select) {
            e.target.checked
              ? selected.add(e.target.dataset.select)
              : selected.delete(e.target.dataset.select);
            render();
            return;
          }
          if (e.target.hasAttribute("data-import")) {
            const f = e.target.files[0];
            if (!f) return;
            busy = true;
            message = "Validating project backup…";
            render();
            try {
              if (f.size > 250 * 1024 * 1024)
                throw Error("Project backup exceeds 250 MB.");
              const bundle = validateBundle(JSON.parse(await f.text()));
              await refresh();
              const additions = planImport(bundle, [...records, ...bundles]);
              await importRecords(additions);
              await refresh();
              parent = bundle;
              title = bundle.title;
              notes = bundle.notes || "";
              selected = new Set(bundle.records.map((r) => r.id));
              message = `Imported ${additions.length} new records; existing identical records kept. Open individual records to recompute their results.`;
            } catch (e) {
              message = e.message;
            } finally {
              busy = false;
              render();
            }
          }
        };
      }
      showWorkspace(root);
      document.querySelector("#app").inert = true;
      busy = true;
      render();
      try {
        await refresh();
        message = "Choose a project revision or browse all local records.";
      } catch (e) {
        message = e.message;
      } finally {
        busy = false;
        render();
      }
    },
  };
}
