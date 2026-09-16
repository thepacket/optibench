import { traceNonsequential } from "./nonsequential.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result: traceNonsequential(data.scene, {
        onProgress: (progress) => self.postMessage({ progress }),
      }),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
