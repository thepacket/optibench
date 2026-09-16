import { runPolarizationScan } from "./polarization-scan.js";
self.onmessage = ({ data: d }) => {
  try {
    self.postMessage({
      result: runPolarizationScan(
        d.project,
        d.detectorId,
        d.settings,
        d.options,
        (progress) => self.postMessage({ progress }),
      ),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
