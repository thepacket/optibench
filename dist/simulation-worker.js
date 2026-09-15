import { simulateRuns } from "./simulation-runs.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: simulateRuns(data.project, data.config) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
