import { guidedSweep, guidedAssessment } from "./guided-experiment.js";
self.onmessage = ({ data }) => {
  try {
    const progress = (progress) => self.postMessage({ progress });
    const result =
      data.operation === "assess"
        ? guidedAssessment(data.source, progress)
        : guidedSweep(data.setup, data.operation === "preview", progress);
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
