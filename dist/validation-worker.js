import { runScientificValidation } from "./scientific-validation.js";
import { runBenchmark } from "./validation.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result:
        data.id === "optical-suite"
          ? runScientificValidation((progress) =>
              self.postMessage({ progress }),
            )
          : runBenchmark(data.id),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
