import { evaluateAcceptance } from "./acceptance.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result: evaluateAcceptance(data.requirements, data.source, (progress) =>
        self.postMessage({ progress }),
      ),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
