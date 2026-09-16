import { acquireBeamProfile, scanBeamProfile } from "./beam-profiler.js";
self.onmessage = ({ data: d }) => {
  try {
    self.postMessage({
      result:
        d.mode === "scan"
          ? scanBeamProfile(d.project, d.settings, d.travel, (progress) =>
              self.postMessage({ progress }),
            )
          : acquireBeamProfile(d.project, d.settings),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
