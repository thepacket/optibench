import { analyzeMeasurement } from "./metrology.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      job: data.job,
      result: analyzeMeasurement(data.frames, data.settings, data.calibration),
    });
  } catch (error) {
    self.postMessage({ job: data.job, error: error.message });
  }
};
