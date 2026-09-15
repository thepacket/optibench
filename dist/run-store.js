const database = () =>
  new Promise((resolve, reject) => {
    if (!globalThis.indexedDB)
      return reject(
        Error(
          "This browser cannot store experiment runs. Export the run JSON to keep a copy.",
        ),
      );
    const request = indexedDB.open("optibench-measurements", 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("runs", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(
        Error("Experiment storage could not be opened. Export your run JSON."),
      );
    request.onblocked = () =>
      reject(Error("Close other OptiBench tabs to open experiment storage."));
  });
async function transact(mode, action) {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("runs", mode),
      req = action(tx.objectStore("runs"));
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
