import test from "node:test";
import assert from "node:assert/strict";
import { profilerExample } from "../dist/beam-profiler.js";
import { autoExposeProfile } from "../dist/profiler-workflows.js";
test("automatic exposure recovers from saturation using recorded camera readings", () => {
  const p = profilerExample(),
    before = JSON.stringify(p),
    r = autoExposeProfile(p, {
      detectorId: 3,
      n: 128,
      exposure: 1000,
      seed: 12,
      backgroundFrames: 1,
    });
  assert.ok(r.autoExposure.converged);
  assert.ok(r.autoExposure.attempts[0].clipped);
  assert.equal(r.frame.saturated, 0);
  assert.ok(r.settings.exposure < 1000);
  assert.equal(JSON.stringify(p), before);
  assert.ok(r.autoExposure.attempts.length <= 8);
});
test("automatic exposure observes low-gain full-well limit and reports unresolved cases", () => {
  const p = profilerExample();
  p.items[2].gain = 0.1;
  let r = autoExposeProfile(p, {
    detectorId: 3,
    n: 128,
    exposure: 1000,
    seed: 1,
    backgroundFrames: 1,
  });
  assert.ok(r.autoExposure.converged);
  assert.equal(r.frame.saturated, 0);
  assert.ok(r.frame.values.every((v) => v < 0.1));
  p.items[0].power = 100;
  r = autoExposeProfile(p, {
    detectorId: 3,
    n: 64,
    exposure: 0.001,
    seed: 1,
    backgroundFrames: 1,
  });
  assert.equal(r.autoExposure.converged, false);
  assert.match(r.autoExposure.reason, /limits/);
});
import { acquireBeamProfile } from "../dist/beam-profiler.js";
import { centerProfileROI } from "../dist/profiler-workflows.js";
test("movable ROI preserves physical centroid and stays within sensor bounds", () => {
  const p = profilerExample();
  p.items[2].y += 0.1;
  const r = acquireBeamProfile(p, {
    detectorId: 3,
    n: 256,
    seed: 12,
    roiX: -20,
    roiY: 0,
  });
  assert.ok(Math.abs(r.analysis.sensorCentroidXmm + 0.1) < 0.01);
  const centered = centerProfileROI(r),
    next = acquireBeamProfile(p, {
      detectorId: 3,
      n: 256,
      seed: 13,
      ...centered,
    });
  assert.ok(
    Math.abs(next.analysis.centroidXmm) < (p.items[2].pixelPitch / 1000) * 2,
  );
  assert.ok(
    Math.abs(next.analysis.sensorCentroidXmm - r.analysis.sensorCentroidXmm) <
      0.005,
  );
  assert.throws(
    () => acquireBeamProfile(p, { detectorId: 3, n: 256, roiX: 20000 }),
    /sensor/,
  );
  assert.throws(
    () => acquireBeamProfile(p, { detectorId: 3, n: 256, roiX: 0.2 }),
    /integer/,
  );
});
import {
  repeatBeamProfile,
  summarizeProfileRepeats,
} from "../dist/profiler-workflows.js";
test("repeatability records independent frames and unbiased sample statistics", () => {
  const p = profilerExample(),
    r = repeatBeamProfile(
      p,
      { detectorId: 3, n: 256, exposure: 2, seed: 22, backgroundFrames: 1 },
      3,
    );
  assert.equal(r.records.length, 3);
  assert.equal(r.summary.valid, 3);
  assert.ok(r.summary.metrics.diameterXmm.sd > 0);
  assert.notDeepEqual(r.records[0].frame.values, r.records[1].frame.values);
  const records = [1, 2, 3].map((v) => ({
    analysis: {
      valid: true,
      diameterXmm: v,
      diameterYmm: v,
      sensorCentroidXmm: v,
      sensorCentroidYmm: v,
    },
  }));
  const s = summarizeProfileRepeats(records);
  assert.equal(s.metrics.diameterXmm.mean, 2);
  assert.equal(s.metrics.diameterXmm.sd, 1);
  assert.equal(s.metrics.diameterXmm.sem, 1 / Math.sqrt(3));
  records[0].analysis.valid = false;
  assert.match(summarizeProfileRepeats(records).error, /three/);
});
import { fitBeamPropagation } from "../dist/beam-profiler.js";
test("propagation intervals reflect residual scatter and preserve dimensional units", () => {
  const make = (amp) =>
    Array.from({ length: 11 }, (_, i) => {
      const z = i * 20 - 100,
        w2 = 0.01 + (0.002 * (z - 10)) ** 2 + amp * Math.sin(i * 1.7);
      return {
        positionMm: z,
        record: { analysis: { valid: true, diameterXmm: 2 * Math.sqrt(w2) } },
      };
    });
  const clean = fitBeamPropagation(make(0), "x"),
    noisy = fitBeamPropagation(make(0.0002), "x");
  assert.ok(clean.uncertainty.waistRadiusMm.standardError < 1e-10);
  assert.ok(noisy.uncertainty.waistRadiusMm.standardError > 0);
  assert.equal(noisy.uncertainty.dof, 8);
  for (const key of ["waistRadiusMm", "waistPositionMm", "halfAngleMrad"]) {
    const ci = noisy.uncertainty[key].ci95;
    assert.ok(ci[0] < noisy[key] && ci[1] > noisy[key]);
  }
  assert.match(noisy.uncertainty.method, /Excludes pixel calibration/);
});
import { importProfilerRecord } from "../dist/profiler-records.js";
import { scanBeamProfile } from "../dist/beam-profiler.js";
test("JSON import recomputes measurements and rejects malformed pixels and metadata", () => {
  const r = acquireBeamProfile(profilerExample(), {
    detectorId: 3,
    n: 128,
    seed: 12,
  });
  r.analysis.diameterXmm = 999;
  r.id = "old-id";
  const imported = importProfilerRecord(JSON.stringify(r));
  assert.notEqual(imported.id, r.id);
  assert.equal(imported.sourceId, r.id);
  assert.notEqual(imported.analysis.diameterXmm, 999);
  const bad = structuredClone(r);
  bad.frame.values[0] = null;
  assert.throws(() => importProfilerRecord(bad), /Pixel arrays/);
  bad.frame.values[0] = 0;
  bad.roi.originX++;
  assert.throws(() => importProfilerRecord(bad), /ROI/);
  assert.throws(() => importProfilerRecord("{"), /JSON/);
});
test("scan and repeat imports retain frames and recompute summaries without trusting saved fits", () => {
  const p = profilerExample(),
    settings = { detectorId: 3, n: 128, seed: 12, backgroundFrames: 1 };
  const repeat = repeatBeamProfile(p, settings, 3),
    rr = importProfilerRecord(repeat);
  assert.equal(rr.records.length, 3);
  assert.equal(rr.summary.valid, repeat.summary.valid);
  const scan = scanBeamProfile(
    p,
    { ...settings, n: 256 },
    { start: -80, end: 100, count: 7 },
  );
  scan.fits.x.waistRadiusMm = 999;
  const imported = importProfilerRecord(scan);
  assert.ok(imported.fits.x.waistRadiusMm < 1);
  scan.points[1].positionMm += 1;
  assert.throws(() => importProfilerRecord(scan), /inconsistent/);
});
import { compareProfilerRecords } from "../dist/profiler-records.js";
test("saved-run comparisons retain units, condition differences and reject invalid results", () => {
  const p = profilerExample(),
    a = acquireBeamProfile(p, { detectorId: 3, n: 256, seed: 22 }),
    b = structuredClone(a);
  b.id = "second";
  b.analysis.diameterXmm += 0.01;
  b.settings.exposure *= 2;
  const c = compareProfilerRecords(a, b);
  assert.ok(
    Math.abs(c.rows.find((r) => r.label === "diameterXmm").delta - 0.01) <
      1e-12,
  );
  assert.ok(c.conditions.some((s) => s.includes("exposure")));
  assert.match(c.note, /significance/);
  b.analysis.valid = false;
  assert.throws(() => compareProfilerRecords(a, b), /quality/);
  assert.throws(
    () => compareProfilerRecords(a, { format: "other" }),
    /same kind/,
  );
});
import { profilerReport } from "../dist/profiler-report.js";
test("standalone lab report includes units, diagnostics and escaped user annotations", () => {
  const r = acquireBeamProfile(profilerExample(), {
    detectorId: 3,
    n: 128,
    seed: 22,
  });
  r.name = "<script>alert(1)</script>";
  r.notes = "<img src=x onerror=alert(1)> & notes";
  const html = profilerReport(r);
  assert.ok(html.startsWith("<!doctype html>"));
  assert.match(html, /D4σ X · mm/);
  assert.match(html, /Recorded optical bench/);
  assert.match(html, /&lt;script&gt;/);
  assert.ok(!html.includes("<script>"));
  assert.ok(!html.includes("<img src=x"));
  assert.match(html, /complete JSON/);
});
import { profilerStore } from "../dist/beam-profiler.js";
import { indexedDB } from "fake-indexeddb";
test("local records can be trashed, restored and deleted without touching other acquisitions", async () => {
  globalThis.indexedDB = indexedDB;
  const a = acquireBeamProfile(profilerExample(), {
      detectorId: 3,
      n: 64,
      seed: 2,
    }),
    b = { ...a, id: crypto.randomUUID() };
  await profilerStore.save(a);
  await profilerStore.save(b);
  await profilerStore.save({ ...a, trashedAt: new Date().toISOString() });
  assert.ok((await profilerStore.list()).find((r) => r.id === a.id).trashedAt);
  await profilerStore.save(a);
  assert.equal(
    (await profilerStore.list()).find((r) => r.id === a.id).trashedAt,
    undefined,
  );
  await profilerStore.remove(a.id);
  assert.ok(!(await profilerStore.list()).some((r) => r.id === a.id));
  assert.ok((await profilerStore.list()).some((r) => r.id === b.id));
});
import { Window } from "happy-dom";
import { createProfilerWorkspace } from "../dist/beam-profiler-ui.js";
test("extended profiler UI supports automatic exposure, repeats, comparison, notes, reports, imports and Trash", async () => {
  const w = new Window();
  globalThis.document = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLCanvasElement.prototype.toDataURL = () => null;
  w.HTMLAnchorElement.prototype.click = () => {};
  document.body.innerHTML = '<div id="app"></div>';
  const saved = new Map(),
    outputs = [],
    oldURL = URL.createObjectURL;
  URL.createObjectURL = (b) => {
    outputs.push(b);
    return "blob:test";
  };
  const run = async (d) =>
    d.mode === "auto"
      ? autoExposeProfile(d.project, d.settings)
      : d.mode === "repeat"
        ? repeatBeamProfile(d.project, d.settings, d.repeatCount)
        : d.mode === "import"
          ? importProfilerRecord(d.text)
          : acquireBeamProfile(d.project, d.settings);
  const ui = createProfilerWorkspace({
    getProject: () => profilerExample(),
    getDetector: () => 3,
    store: {
      list: async () => [...saved.values()],
      save: async (r) => saved.set(r.id, structuredClone(r)),
      remove: async (id) => saved.delete(id),
    },
    run,
  });
  try {
    await ui.open();
    const root = document.getElementById("profiler-workspace");
    const wait = () => new Promise((r) => setTimeout(r, 25));
    const click = async (a) => {
      root.querySelector(`[data-profiler="${a}"]`).click();
      await wait();
    };
    await click("auto");
    assert.match(root.textContent, /Automatic exposure found/);
    const repeats = root.querySelector("[data-profile-repeats]");
    repeats.value = "3";
    repeats.dispatchEvent(new w.Event("change", { bubbles: true }));
    await click("repeat");
    assert.match(root.textContent, /Measured repeatability/);
    const name = root.querySelector('[data-profile-note="name"]');
    name.value = "Baseline";
    name.dispatchEvent(new w.Event("change", { bubbles: true }));
    await click("save");
    const baseline = [...saved.keys()][0];
    assert.equal(saved.get(baseline).name, "Baseline");
    await click("repeat");
    await click("save");
    root.querySelector("[data-profile-history]").value = baseline;
    await click("compare");
    assert.match(root.textContent, /Saved-run comparison/);
    await click("report");
    assert.match(await outputs.at(-1).text(), /Saved-run comparison/);
    root.querySelector("[data-profile-history]").value = baseline;
    await click("trash");
    assert.ok(saved.get(baseline).trashedAt);
    await click("restore");
    assert.equal(saved.get(baseline).trashedAt, undefined);
    root.querySelector("[data-profile-history]").value = baseline;
    await click("trash");
    await click("purge");
    assert.ok(saved.has(baseline));
    await click("confirm-purge");
    assert.ok(!saved.has(baseline));
    assert.equal(saved.size, 1);
    const record = [...saved.values()][0],
      input = root.querySelector("[data-profile-import]");
    Object.defineProperty(input, "files", {
      value: [{ size: 100, text: async () => JSON.stringify(record) }],
    });
    input.dispatchEvent(new w.Event("change", { bubbles: true }));
    await wait();
    assert.match(root.textContent, /Import reviewed/);
    await click("save");
    assert.equal(saved.size, 2);
  } finally {
    URL.createObjectURL = oldURL;
    w.happyDOM.abort();
  }
});
