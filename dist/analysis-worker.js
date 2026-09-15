import { monteCarlo } from "./optics.js";
self.onmessage = (e) => {
  try {
    const { project, detectorId, params } = e.data;
    self.postMessage({ result: monteCarlo(project, detectorId, params) });
  } catch (error) {
    self.postMessage({ error: error.message });
  }
};
