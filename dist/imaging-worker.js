import { analyzePupil, focusScan } from "./imaging.js";
self.onmessage = ({ data }) => {
  try {
    self.postMessage({
      result:
        data.kind === "focus"
          ? focusScan(data.run, data.selection, data.range)
          : analyzePupil(data.pupil),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
