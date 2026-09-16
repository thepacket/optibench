import test from "node:test";
import assert from "node:assert/strict";
import {
  profilerExample,
  analyzeBeamFrame,
  acquireBeamProfile,
  scanBeamProfile,
  fitBeamPropagation,
  profilerStore,
} from "../dist/beam-profiler.js";
import { trace, waistInfo } from "../dist/optics.js";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { createProfilerWorkspace } from "../dist/beam-profiler-ui.js";
function ellipse({
  n = 128,
  pitch = 10,
  sx = 0.08,
  sy = 0.045,
  angle = 30,
  mx = 0.07,
  my = -0.03,
  amplitude = 0.5,
} = {}) {
  const a = (angle * Math.PI) / 180,
    values = Array.from({ length: n * n }, (_, i) => {
      const x = (((i % n) + 0.5 - n / 2) * pitch) / 1000 - mx,
        y = ((Math.floor(i / n) + 0.5 - n / 2) * pitch) / 1000 - my,
        u = x * Math.cos(a) + y * Math.sin(a),
        v = -x * Math.sin(a) + y * Math.cos(a);
      return (
        0.01 + amplitude * Math.exp(-0.5 * ((u / sx) ** 2 + (v / sy) ** 2))
      );
    });
  return { frame: { n, values }, dark: Array(n * n).fill(0.01), pitch };
}
test("measured pixel moments recover rotated elliptical Gaussian centroid, diameters and orientation", () => {
  const { frame, dark, pitch } = ellipse(),
    a = analyzeBeamFrame(frame, dark, pitch);
  assert.ok(a.valid, a.warnings.join());
  assert.ok(Math.abs(a.centroidXmm - 0.07) < 1e-5);
  assert.ok(Math.abs(a.centroidYmm + 0.03) < 1e-5);
  assert.ok(Math.abs(a.majorDiameterMm - 0.32) < 1e-4);
  assert.ok(Math.abs(a.minorDiameterMm - 0.18) < 1e-4);
  assert.ok(Math.abs(a.orientationDeg - 30) < 0.01);
  assert.ok(Math.abs(a.ellipticity - 0.5625) < 1e-4);
  assert.ok(a.fitX.relativeRms < 0.001);
});
test("poor frames flag saturation, truncation, undersampling and absent signal", () => {
  let e = ellipse({ amplitude: 2 });
  e.frame.values = e.frame.values.map((v) => Math.min(1, v));
  assert.ok(
    analyzeBeamFrame(e.frame, e.dark, e.pitch).warnings.some((w) =>
      /Saturation/.test(w),
    ),
  );
  e = ellipse({ sx: 0.22, sy: 0.22 });
  assert.ok(
    analyzeBeamFrame(e.frame, e.dark, e.pitch).warnings.some((w) =>
      /boundary/.test(w),
    ),
  );
  e = ellipse({ sx: 0.012, sy: 0.012, mx: 0, my: 0 });
  assert.ok(
    analyzeBeamFrame(e.frame, e.dark, e.pitch).warnings.some((w) =>
      /eight pixels/.test(w),
    ),
  );
  assert.throws(
    () =>
      analyzeBeamFrame(
        { n: 64, values: Array(4096).fill(0) },
        Array(4096).fill(0),
        5,
      ),
    /weak/,
  );
  e = ellipse({ sx: 0.08, sy: 0.08 });
  assert.equal(analyzeBeamFrame(e.frame, e.dark, e.pitch).orientationDeg, null);
});
test("camera acquisition uses seeded instrument noise, dark correction and frozen bench", () => {
  const p = profilerExample(),
    before = JSON.stringify(p),
    opts = { detectorId: 3, n: 256, seed: 101 },
    r = acquireBeamProfile(p, opts),
    again = acquireBeamProfile(p, opts);
  assert.equal(JSON.stringify(p), before);
  assert.deepEqual(r.frame, again.frame);
  assert.equal(r.backgroundSeeds.length, 8);
  assert.equal(r.dark.length, 256 * 256);
  assert.ok(r.analysis.valid);
  const truth = trace(p).detectors.find((h) => h.id === 3);
  assert.ok(Math.abs(r.analysis.diameterXmm / (2 * truth.radius) - 1) < 0.05);
  assert.notDeepEqual(
    r.frame,
    acquireBeamProfile(p, { ...opts, seed: 102 }).frame,
  );
  assert.throws(
    () => acquireBeamProfile(p, { ...opts, exposure: -1 }),
    /exposure/,
  );
  const saturated = acquireBeamProfile(p, { ...opts, exposure: 1000 });
  assert.equal(saturated.analysis?.valid, false);
});
test("measured propagation fit recovers waist and half-angle and rejects extrapolated waist", () => {
  const points = Array.from({ length: 11 }, (_, i) => {
    const z = i * 20 - 100,
      w = Math.sqrt(0.1 ** 2 + (0.002 * (z - 10)) ** 2);
    return {
      positionMm: z,
      record: {
        analysis: { valid: true, diameterXmm: 2 * w, diameterYmm: 2 * w },
      },
    };
  });
  const f = fitBeamPropagation(points, "x");
  assert.ok(Math.abs(f.waistRadiusMm - 0.1) < 1e-12);
  assert.ok(Math.abs(f.waistPositionMm - 10) < 1e-10);
  assert.ok(Math.abs(f.halfAngleMrad - 2) < 1e-10);
  points[0].record.analysis.valid = false;
  assert.equal(fitBeamPropagation(points, "x").excluded, 1);
  assert.throws(() => fitBeamPropagation(points.slice(0, 4), "x"), /seven/);
  assert.throws(
    () =>
      fitBeamPropagation(
        points.slice(0, 8).map((p) => ({
          ...p,
          record: {
            analysis: {
              valid: true,
              diameterXmm:
                2 * Math.sqrt(0.01 + (0.002 * (p.positionMm - 300)) ** 2),
            },
          },
        })),
        "x",
      ),
    /bracket/,
  );
});
test("propagation scan measures frames, checks travel and persists complete records", async () => {
  const p = profilerExample(),
    s = scanBeamProfile(
      p,
      { detectorId: 3, n: 256, seed: 9, backgroundFrames: 4 },
      { start: -80, end: 100, count: 11 },
    );
  assert.equal(s.points.length, 11);
  assert.ok(s.fits.x, s.errors.x);
  assert.ok(s.fits.y, s.errors.y);
  const hit = trace(p).detectors.find((h) => h.id === 3);
  const expected = waistInfo(hit.q, hit.wavelength, hit.m2);
  assert.ok(Math.abs(s.fits.x.waistRadiusMm / expected.waist - 1) < 0.05);
  assert.ok(Math.abs(s.fits.x.waistPositionMm - expected.distance) < 3);
  assert.ok(
    Math.abs(
      s.fits.x.halfAngleMrad / ((expected.waist / expected.rayleigh) * 1000) -
        1,
    ) < 0.05,
  );
  assert.throws(
    () =>
      scanBeamProfile(
        p,
        { detectorId: 3, n: 128 },
        { start: -300, end: 100, count: 7 },
      ),
    /crosses|reach/,
  );
  assert.throws(
    () =>
      scanBeamProfile(
        p,
        { detectorId: 3, n: 128 },
        { start: 0, end: 1500, count: 7 },
      ),
    /table|beam/,
  );
  globalThis.indexedDB = indexedDB;
  await profilerStore.save(s);
  const saved = (await profilerStore.list()).find((r) => r.id === s.id);
  assert.deepEqual(saved, s);
});
test("profiler UI acquires, scans, saves and opens records without changing live settings", async () => {
  const w = new Window();
  globalThis.document = w.document;
  w.HTMLCanvasElement.prototype.getContext = () => null;
  document.body.innerHTML = '<div id="app"></div>';
  let p = profilerExample();
  const rows = [];
  const ui = createProfilerWorkspace({
    getProject: () => p,
    getDetector: () => 3,
    onBench: (q) => (p = q),
    store: {
      list: async () => rows,
      save: async (r) => rows.push(structuredClone(r)),
    },
    run: async (d) =>
      d.mode === "scan"
        ? scanBeamProfile(d.project, d.settings, d.travel)
        : acquireBeamProfile(d.project, d.settings),
  });
  await ui.open();
  const root = document.getElementById("profiler-workspace");
  const click = async (a) => {
    root.querySelector(`[data-profiler="${a}"]`).click();
    await new Promise((r) => setTimeout(r, 20));
  };
  await click("acquire");
  assert.match(root.textContent, /D4σ diameter/);
  assert.ok(root.querySelector("canvas"));
  await click("save");
  assert.equal(rows.length, 1);
  await click("scan");
  assert.match(root.textContent, /Measured propagation/);
  assert.ok(root.querySelector("[data-profile-frame]"));
  await click("save");
  assert.equal(rows.length, 2);
  root.querySelector("[data-profile-history]").value = rows[0].id;
  await click("open");
  assert.match(root.textContent, /Live settings unchanged/);
  await click("close");
  assert.equal(root.hidden, true);
  assert.equal(document.getElementById("app").inert, false);
  w.happyDOM.abort();
});
