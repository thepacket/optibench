import { solveWave } from "./wave.js";
self.onmessage = (e) => {
  try {
    const result = solveWave(e.data.project, e.data.options);
    self.postMessage({ job: e.data.job, result }, [result.values.buffer]);
  } catch (error) {
    self.postMessage({ job: e.data.job, error: error.message });
  }
};
