import { evaluatePractice } from "./alignment-practice.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: evaluatePractice(data.setup, data.offsets) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
