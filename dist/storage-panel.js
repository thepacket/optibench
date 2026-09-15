import { archiveStore, runStore, changeStoredRecord } from "./run-store.js";
const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const recordBytes = (r) => new Blob([JSON.stringify(r)]).size;
export function createStoragePanel() {
  let root,
    records = [],
    message = "",
    busy = false,
    loaded = false;
  async function refresh() {
    records = [...(await archiveStore.list()), ...(await runStore.list())];
    loaded = true;
    render();
  }
  function render() {
    if (!root) return;
    const bytes = records.reduce((s, r) => s + recordBytes(r), 0);
    root.innerHTML = `<details class="storage-summary"><summary>Local storage · ${records.length} entries · ${(bytes / 1048576).toFixed(2)} MB serialized data</summary><button data-storage="refresh">Refresh storage sizes</button><p>Sizes estimate JSON payloads, not database overhead. Project backups contain independent copies. Moving an entry to Trash is reversible and does not free space. Export a backup before permanent deletion.</p><p role="status">${esc(message)}</p><table><tr><th>Record</th><th>Size</th><th>Actions</th></tr>${records.map((r) => `<tr><td>${esc(r.title || r.name || r.record?.title || r.record?.name || r.format)}<small>${esc(r.createdAt)} ${r.format === "optibench-trash" ? " · Trash" : ""}</small></td><td>${(recordBytes(r) / 1048576).toFixed(2)} MB</td><td><button data-storage="backup" data-id="${esc(r.id)}">Export backup</button>${r.format === "optibench-trash" ? `<button data-storage="restore" data-id="${esc(r.id)}">Restore</button><button data-storage="purge" data-id="${esc(r.id)}">Delete permanently</button>` : `<button data-storage="trash" data-id="${esc(r.id)}">Move to Trash</button>`}</td></tr>`).join("")}</table></details>`;
  }
  return {
    async mount(target) {
      root = target;
      root.onclick = async (e) => {
        const b = e.target.closest("[data-storage]");
        if (!b || busy) return;
        e.stopPropagation();
        if (b.dataset.storage === "refresh") {
          await refresh();
          root.querySelector("details").open = true;
          return;
        }
        const r = records.find((r) => r.id === b.dataset.id),
          action = b.dataset.storage;
        if (
          action === "purge" &&
          !confirm(
            "Permanently delete this trash entry? Export a backup first. This cannot be undone.",
          )
        )
          return;
        busy = true;
        try {
          if (action === "backup") {
            const u = URL.createObjectURL(
                new Blob([JSON.stringify(r.record || r)], {
                  type: "application/json",
                }),
              ),
              a = document.createElement("a");
            a.href = u;
            a.download = "optibench-storage-backup.json";
            a.click();
            setTimeout(() => URL.revokeObjectURL(u), 1000);
            message =
              "Backup download requested. Verify the downloaded file before deleting.";
          } else {
            await changeStoredRecord(action, r);
            message =
              action === "trash"
                ? "Moved to Trash. Related project snapshots remain intact. Refresh Projects to update its index."
                : action === "restore"
                  ? "Record restored. Refresh Projects to update its index."
                  : "Trash entry permanently deleted.";
          }
          await refresh();
          root.querySelector("details").open = true;
        } catch (e) {
          message = e.message;
          render();
          root.querySelector("details").open = true;
        } finally {
          busy = false;
        }
      };
      try {
        if (!loaded) await refresh();
        else render();
      } catch (e) {
        message = e.message;
        render();
      }
    },
  };
}
