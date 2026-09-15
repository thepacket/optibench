const database = () =>
  new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(
        Error(
          "This browser cannot store experiment runs. Export the run JSON to keep a copy.",
        ),
      );
    const request = indexedDB.open("optibench-measurements", 2);
    request.onupgradeneeded = () => {
      for (const name of ["runs", "archives"])
        if (!request.result.objectStoreNames.contains(name))
          request.result.createObjectStore(name, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        Error("Experiment storage could not be opened. Export your run JSON."),
      );
    request.onblocked = () =>
      reject(Error("Close other OptiBench tabs to open experiment storage."));
  });
async function transact(mode, action, storeName = "runs") {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode),
      req = action(tx.objectStore(storeName));
    let value;
    req.onsuccess = () => {
      value = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(value);
    };
    tx.onerror = tx.onabort = () => {
      db.close();
      reject(
        Error(
          "Could not save or read the experiment. Browser storage may be full; export a JSON backup.",
        ),
      );
    };
  });
}
export const runStore = {
  list: () => transact("readonly", (s) => s.getAll()),
  save: (r) => transact("readwrite", (s) => s.put(r)),
  remove: (id) => transact("readwrite", (s) => s.delete(id)),
};
export const serializable = (value) =>
  JSON.parse(
    JSON.stringify(value, (_key, v) =>
      ArrayBuffer.isView(v) ? Array.from(v) : v,
    ),
  );

export const archiveStore = {
  list: () => transact("readonly", (s) => s.getAll(), "archives"),
  save: (a) => transact("readwrite", (s) => s.add(a), "archives"),
  remove: (id) => transact("readwrite", (s) => s.delete(id), "archives"),
};

// One transaction prevents partial project imports, including cross-store conflicts.
export async function importProjectRecords(records) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["runs", "archives"], "readwrite");
    let failure;
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        failure || Error("Project import failed; no records were written."),
      );
    };
    for (const r of records) {
      const store = tx.objectStore(
          r.format === "optibench-measurement" ? "runs" : "archives",
        ),
        req = store.get(r.id);
      req.onsuccess = () => {
        if (req.result) {
          failure = Error(
            "A record changed while importing. Retry after refreshing the navigator.",
          );
          tx.abort();
        } else store.add(r);
      };
    }
  });
}

export async function changeStoredRecord(action, record) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(["runs", "archives"], "readwrite"),
      archives = tx.objectStore("archives");
    let reason;
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(reason || Error("Storage change failed. Nothing was changed."));
    };
    if (action === "trash") {
      const target = tx.objectStore(
          record.format === "optibench-measurement" ? "runs" : "archives",
        ),
        req = target.get(record.id);
      req.onsuccess = () => {
        if (!req.result) {
          reason = Error("Record no longer exists. Refresh storage.");
          tx.abort();
          return;
        }
        archives.add({
          format: "optibench-trash",
          version: 1,
          id: crypto.randomUUID(),
          createdAt: new Date().toISOString(),
          record: req.result,
        });
        target.delete(record.id);
      };
    } else if (action === "restore") {
      const req = archives.get(record.id);
      req.onsuccess = () => {
        const saved = req.result;
        if (saved?.format !== "optibench-trash") {
          reason = Error("Trash entry missing.");
          tx.abort();
          return;
        }
        const target = tx.objectStore(
          saved.record.format === "optibench-measurement" ? "runs" : "archives",
        );
        target.add(saved.record);
        archives.delete(saved.id);
      };
    } else if (action === "purge") {
      const req = archives.get(record.id);
      req.onsuccess = () => {
        if (req.result?.format !== "optibench-trash") {
          reason = Error("Only trash entries can be permanently removed.");
          tx.abort();
          return;
        }
        archives.delete(record.id);
      };
    } else {
      reason = Error("Unknown storage operation.");
      tx.abort();
    }
  });
}
