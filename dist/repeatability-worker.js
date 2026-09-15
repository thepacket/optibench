import { analyzeRepeats } from "./repeatability.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result: analyzeRepeats(data.runs, { verified: data.verified }),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
