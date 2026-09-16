import test from "node:test";
import assert from "node:assert/strict";
import {
  defaultPupil,
  validatePupil,
  pupilSamples,
  pupilMap,
  parsePupil,
  fitZernike,
  zernike,
  analyzePupil,
  spotStatistics,
  focusScan,
  selectSpot,
  imagingCSV,
} from "../dist/imaging.js";
import { rayExample, traceNonsequential } from "../dist/nonsequential.js";
import { createImagingWorkspace } from "../dist/imaging-ui.js";
import { Window } from "happy-dom";
const near = (a, b, t = 1e-8) =>
  assert.ok(Math.abs(a - b) <= t, `${a} != ${b} ± ${t}`);
test("power-weighted spots recover centroid covariance axes and collected energy radii", () => {
  const s = spotStatistics([
    { uv: [-1, 0], power: 1 },
    { uv: [1, 0], power: 3 },
  ]);
  near(s.power, 4);
  near(s.centroid[0], 0.5);
  near(s.rmsRadius, Math.sqrt(0.75));
  near(s.sigmaMinor, 0);
  near(s.r50, 0.5);
  near(s.r80, 1.5);
  near(s.curve.at(-1).fraction, 1);
  assert.equal(spotStatistics([]).status, "no signal");
});
test("spot selection partitions actual ray paths and retains source and detector choices", () => {
  const s = rayExample("plate");
  s.options.rays = 4;
  const r = traceNonsequential(s);
  const all = selectSpot(r, { detectorId: "detector" }).statistics,
    direct = selectSpot(r, {
      detectorId: "detector",
      path: "direct",
    }).statistics,
    spec = selectSpot(r, {
      detectorId: "detector",
      path: "specular",
    }).statistics;
  near(all.power, direct.power + spec.power);
  assert.ok(spec.power > 0);
  assert.equal(
    selectSpot(r, { detectorId: "detector", sourceId: "missing" }).statistics
      .status,
    "no signal",
  );
  assert.throws(() => selectSpot(r, { detectorId: "bad" }));
});
function convergingRun() {
  return {
    scene: { objects: [{ kind: "detector", id: "d", normal: [0, 0, 1] }] },
    detectorHits: [-1, 0, 1].map((x) => ({
      detectorId: "d",
      uv: [x, 0],
      power: 1,
      path: [],
      direction: [-x / 10, 0, 1],
    })),
  };
}
test("free-space focus scan recovers an analytic focus without mutating scene or weights", () => {
  const r = convergingRun(),
    before = JSON.stringify(r),
    s = focusScan(r, { detectorId: "d" }, { start: 0, end: 20, count: 21 });
  near(s.optimum, 10);
  near(s.minimum, 0);
  near(s.rows[10].rmsRadius, 0);
  near(s.rows[10].power, 3);
  assert.equal(JSON.stringify(r), before);
  const bounded = focusScan(
    r,
    { detectorId: "d" },
    { start: 0, end: 5, count: 3 },
  );
  near(bounded.bestInRange, 5);
  r.detectorHits.forEach((h) => (h.direction = [0, 0, 1]));
  assert.equal(focusScan(r, { detectorId: "d" }).optimum, null);
});
test("pupil validation rejects malformed maps, unsupported NA and nonfinite data", () => {
  const p = defaultPupil();
  assert.throws(() => validatePupil({ ...p, focalLength: 1 }), /paraxial/);
  assert.throws(() => validatePupil({ ...p, grid: 96 }));
  assert.throws(() => validatePupil({ ...p, coefficients: [0] }));
  const m = pupilMap(p);
  m.opd[m.opd.findIndex((v) => v !== null)] = NaN;
  assert.throws(() => validatePupil(m));
  const outside = pupilMap(p);
  outside.opd[0] = 0;
  assert.throws(() => validatePupil(outside), /outside/);
  assert.throws(() => parsePupil("{bad"));
});
test("full-disk normalized Zernike modes have expected analytic values and RMS", () => {
  near(zernike(3, 0, 0), -Math.sqrt(3));
  near(zernike(10, 1, 0), Math.sqrt(5));
  const s = pupilSamples({ ...defaultPupil(), grid: 128 });
  for (let i = 1; i < 11; i++) {
    const mean = s.reduce((a, p) => a + zernike(i, p.x, p.y), 0) / s.length,
      rms = Math.sqrt(
        s.reduce((a, p) => a + zernike(i, p.x, p.y) ** 2, 0) / s.length,
      );
    near(mean, 0, 0.006);
    near(rms, 1, 0.006);
  }
});
test("least-squares decomposition recovers mixed coefficients on full and obscured pupils", () => {
  for (const obscuration of [0, 0.5, 0.8]) {
    const p = defaultPupil();
    p.obscuration = obscuration;
    p.coefficients = [120, 7, -4, 22, 3, -8, 12, -15, 6, 5, 9];
    const m = pupilMap(p),
      q = parsePupil(JSON.stringify(m)),
      f = fitZernike(pupilSamples(q));
    f.coefficients.forEach((c, i) => near(c, p.coefficients[i], 1e-7));
    near(f.residualRms, 0, 1e-7);
  }
  assert.throws(
    () => fitZernike(Array(30).fill({ x: 0, y: 0, opd: 0 })),
    /rank deficient/,
  );
});
test("ideal circular pupil PSF conserves normalized power, has unit Strehl and matches analytic circular MTF", () => {
  const r = analyzePupil(defaultPupil());
  near(
    r.psf.reduce((a, b) => a + b),
    1,
    1e-12,
  );
  near(r.strehl, 1);
  near(r.rms, 0);
  near(r.mtf[0].x, 1);
  for (const i of [8, 16, 32, 48, 64]) {
    const v = r.mtf[i].frequency / r.cutoff,
      exact =
        v >= 1 ? 0 : (2 / Math.PI) * (Math.acos(v) - v * Math.sqrt(1 - v * v));
    near(r.mtf[i].x, exact, 0.003);
    near(r.mtf[i].x, r.mtf[i].y, 1e-12);
  }
  assert.match(imagingCSV(r), /frequency_cycles_per_mm/);
});
test("piston and removed tilt leave PSF unchanged; aberrations reduce Strehl and enlarge energy radius", () => {
  const p = defaultPupil(),
    ideal = analyzePupil(p);
  p.coefficients[0] = 2000;
  p.coefficients[1] = 70;
  p.coefficients[2] = -55;
  const removed = analyzePupil(p);
  near(removed.strehl, 1, 1e-10);
  near(removed.rms, 0, 1e-8);
  p.coefficients[3] = 80;
  const bad = analyzePupil(p);
  assert.ok(bad.strehl < 0.8);
  assert.ok(bad.encircled.r80 > ideal.encircled.r80);
  near(bad.rms, 80, 0.4);
});
test("physical scales follow wavelength and focal length, while MTF scale follows inverse image scale", () => {
  const p = defaultPupil(),
    a = analyzePupil(p);
  p.wavelength = 1100;
  const b = analyzePupil(p);
  near(b.pixelMm, 2 * a.pixelMm);
  near(b.cutoff, a.cutoff / 2);
  near(b.encircled.r80, 2 * a.encircled.r80);
});
test("integer-sample tilt translates PSF without changing incoherent MTF; phase undersampling is flagged", () => {
  const p = defaultPupil();
  p.remove = "piston";
  const a = analyzePupil(p);
  p.coefficients[1] = p.wavelength / 16;
  const b = analyzePupil(p);
  for (let i = 0; i < 70; i++) near(a.mtf[i].x, b.mtf[i].x, 1e-10);
  p.coefficients[3] = 10000;
  assert.ok(analyzePupil(p).warnings.some((w) => w.includes("exceeds π")));
});
test("imported non-Zernike OPD retains its residual and finite maps at both grid sizes", () => {
  const p = defaultPupil();
  p.grid = 128;
  const m = pupilMap(p);
  for (let j = 0; j < m.opd.length; j++)
    if (m.opd[j] !== null) m.opd[j] = 10 * Math.sin(j % 128);
  const r = analyzePupil(m);
  assert.ok(r.fit.residualRms > 5);
  assert.equal(r.n, 512);
  assert.ok(r.psf.every(Number.isFinite));
  assert.ok(r.encircled.curve.length < 1000);
});
test("imaging workspace calculates, preserves stale labels, saves, restores and exports", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  w.HTMLAnchorElement.prototype.click = () => {};
  const records = new Map();
  const ui = createImagingWorkspace({
    store: {
      list: async () => [...records.values()],
      save: async (r) => records.set(r.id, structuredClone(r)),
    },
    execute: async (d) =>
      d.kind === "focus"
        ? focusScan(d.run, d.selection, d.range)
        : analyzePupil(d.pupil),
  });
  try {
    const scene = rayExample("lens");
    scene.options.rays = 16;
    await ui.open(traceNonsequential(scene));
    const root = document.getElementById("imaging-workspace"),
      click = async (a) => {
        root.querySelector(`[data-imaging="${a}"]`).click();
        await new Promise((r) => setTimeout(r, 10));
      };
    await click("calculate");
    assert.match(root.textContent, /Results match/);
    await click("focus");
    assert.match(root.textContent, /least-RMS offset/);
    const field = root.querySelector('[data-coefficient="3"]');
    field.value = "40";
    field.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.match(root.textContent, /Inputs changed/);
    await click("save");
    assert.equal(records.size, 1);
    await click("ideal");
    root.querySelector("[data-imaging-history]").value = [...records.keys()][0];
    await click("open");
    assert.equal(root.querySelector('[data-coefficient="3"]').value, "40");
    for (const a of [
      "export-input",
      "audit",
      "mtf-csv",
      "psf-csv",
      "spot-csv",
      "focus-csv",
    ])
      await click(a);
    assert.equal(document.getElementById("app").inert, true);
    await click("close");
    assert.equal(document.getElementById("app").inert, false);
  } finally {
    await w.happyDOM.abort();
  }
});
test("imaging cancellation ignores late worker completion and retains previous result", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  w.HTMLCanvasElement.prototype.getContext = () => null;
  let finish;
  const ui = createImagingWorkspace({
    store: { list: async () => [] },
    execute: (d) =>
      new Promise((r) => {
        finish = () => r(analyzePupil(d.pupil));
      }),
  });
  try {
    await ui.open();
    const root = document.getElementById("imaging-workspace");
    root.querySelector('[data-imaging="calculate"]').click();
    await new Promise((r) => setTimeout(r, 5));
    ui.cancel();
    finish();
    await new Promise((r) => setTimeout(r, 5));
    assert.match(root.textContent, /Calculation cancelled/);
    assert.equal(root.querySelector('[data-map="psf"]'), null);
  } finally {
    await w.happyDOM.abort();
  }
});
