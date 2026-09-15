import { acquireInstrument } from "./instrument-lab.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({ result: acquireInstrument(data.project, data.config) });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
