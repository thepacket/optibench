import { compareStudies } from "./study-comparison.js";
import { reopenSimulationStudy } from "./sweep-archive.js";
import { simulateRuns } from "./simulation-runs.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result:
        data.operation === "compare"
          ? compareStudies(data.left, data.right)
          : data.operation === "reopen"
            ? reopenSimulationStudy(data.input)
            : simulateRuns(data.project, data.config),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
