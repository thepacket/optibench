import { checkSampling } from "./sampling-check.js";
import { compareStudies } from "./study-comparison.js";
import { reopenSimulationStudy } from "./sweep-archive.js";
import { simulateRuns } from "./simulation-runs.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result:
        data.operation === "sampling"
          ? checkSampling(data.project, data.detectorId, (progress) =>
              self.postMessage({ progress }),
            )
          : data.operation === "compare"
            ? compareStudies(data.left, data.right)
            : data.operation === "reopen"
              ? reopenSimulationStudy(data.input)
              : simulateRuns(data.project, data.config, {
                  onProgress: (progress) => self.postMessage({ progress }),
                }),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
