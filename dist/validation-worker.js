import { runBenchmark } from "./validation.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: runBenchmark(data.id) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
