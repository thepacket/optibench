import {
  propagateCoherentBench,
  acquireCoherentPhase,
} from "./coherent-bench.js";
self.onmessage = ({ data }) => {
  try {
    const options = {
      onProgress: (progress) => self.postMessage({ progress }),
    };
    self.postMessage({
      result:
        data.mode === "phase"
          ? acquireCoherentPhase(
              data.project,
              data.settings,
              data.acquisition,
              options,
            )
          : propagateCoherentBench(data.project, data.settings, options),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
