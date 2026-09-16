import { importProfilerRecord } from "./profiler-records.js";
import { autoExposeProfile, repeatBeamProfile } from "./profiler-workflows.js";
import { acquireBeamProfile, scanBeamProfile } from "./beam-profiler.js";
self.onmessage = ({ data: d }) => {
  try {
    self.postMessage({
      result:
        d.mode === "import"
          ? importProfilerRecord(d.text)
          : d.mode === "repeat"
            ? repeatBeamProfile(
                d.project,
                d.settings,
                d.repeatCount,
                (progress) => self.postMessage({ progress }),
              )
            : d.mode === "auto"
              ? autoExposeProfile(d.project, d.settings, (progress) =>
                  self.postMessage({ progress }),
                )
              : d.mode === "scan"
                ? scanBeamProfile(d.project, d.settings, d.travel, (progress) =>
                    self.postMessage({ progress }),
                  )
                : acquireBeamProfile(d.project, d.settings),
    });
  } catch (e) {
    self.postMessage({ error: e.message });
  }
};
