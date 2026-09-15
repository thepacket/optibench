import { runAlignmentStudy } from "./alignment-study.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: runAlignmentStudy(data.project, data.config) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
