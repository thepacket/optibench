import { executeAlignment } from "./measured-optimization.js";
self.onmessage = async ({ data }) => {
  try {
    const result = await executeAlignment(data.recipe, {
      onEvent: (event) => self.postMessage({ event }),
    });
    self.postMessage({ result });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
