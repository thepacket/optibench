import { runRayStudy } from "./ray-studies.js";
import { traceNonsequential } from "./nonsequential.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result:
        data.mode === "study"
          ? runRayStudy(data.scene, data.settings, {
              onEvent: (event) => self.postMessage({ event }),
            })
          : traceNonsequential(data.scene, {
              onProgress: (progress) => self.postMessage({ progress }),
            }),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
