import { recomputeArchive } from "./experiment-archive.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: recomputeArchive(data) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
