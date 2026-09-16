import test from "node:test";
import assert from "node:assert/strict";
import { makeProject } from "../dist/project.js";
import { meterDefaults, readMeter, makeZero } from "../dist/power-meter.js";
import {
  fitPolarization,
  runPolarizationScan,
  scanStore,
} from "../dist/polarization-scan.js";
import { Window } from "happy-dom";
import { indexedDB } from "fake-indexeddb";
import { createScanPanel } from "../dist/polarization-scan-ui.js";

const synthetic = (a, b, c, h = 4) =>
  Array.from({ length: 37 }, (_, i) => {
    const angle = i * 5,
      t = ((angle * Math.PI) / 180) * h;
    return {
      angle,
      reading: {
        valueMw: a + b * Math.cos(t) + c * Math.sin(t),
        overload: false,
        resolutionMw: 1e-8,
        zero: {},
      },
    };
  });
test("harmonic fit recovers measured curve and ignores simulator truth", () => {
  const pts = synthetic(10, 3, 4);
  pts.forEach((p) => (p.reading.truth = { incidentPowerMw: 999 }));
  const f = fitPolarization(pts, 4);
  assert.ok(Math.abs(f.contrast - 0.5) < 1e-12);
  assert.ok(Math.abs(f.extinctionRatio - 3) < 1e-12);
  assert.ok(Math.abs(f.axisDeg - 13.2825255885) < 1e-8);
  assert.ok(f.rmsMw < 1e-12);
  pts[0].reading.overload = true;
  assert.equal(fitPolarization(pts, 4).excluded, 1);
  assert.equal(fitPolarization(synthetic(1, 0, 0), 4).axisDeg, null);
  assert.equal(fitPolarization(synthetic(1, 1, 0), 4).extinctionRatio, null);
  assert.throws(() => fitPolarization(pts.slice(0, 3), 4), /seven/);
});
test("HWP scan acquires independent readings, snapshots and a measured fit", () => {
  const p = makeProject("waveplates"),
    original = JSON.stringify(p),
    c = { ...meterDefaults(), noiseNa: 0, darkNa: 0 };
  const zero = makeZero(readMeter(p, 5, { ...c, shutter: true }, { seed: 10 }));
  const scan = runPolarizationScan(p, 5, c, {
    componentId: 2,
    start: 0,
    end: 90,
    count: 17,
    seed: 100,
    zero,
  });
  assert.equal(JSON.stringify(p), original);
  assert.equal(scan.points.length, 17);
  assert.equal(scan.fit.harmonic, 4);
  assert.ok(scan.fit.rSquared > 0.999);
  assert.equal(
    scan.points[4].reading.project.items.find((x) => x.id === 2).axis,
    22.5,
  );
  assert.notEqual(scan.points[0].reading.seed, scan.points[1].reading.seed);
  assert.throws(
    () =>
      runPolarizationScan(p, 5, { ...c, shutter: true }, { componentId: 2 }),
    /shutter/,
  );
  p.items.find((x) => x.id === 2).retardance = 90;
  assert.throws(() => runPolarizationScan(p, 5, c, { componentId: 2 }), /180/);
  const analyzer = runPolarizationScan(p, 5, c, { componentId: 3, count: 9 });
  assert.equal(analyzer.fit.harmonic, 2);
  p.items.find((x) => x.id === 3).x = 1300;
  assert.throws(
    () => runPolarizationScan(p, 5, c, { componentId: 3, count: 9 }),
    /illuminate/,
  );
});
test("scan storage retains snapshots and overload never becomes zero-valued fit data", async () => {
  globalThis.indexedDB = indexedDB;
  const p = makeProject("waveplates");
  p.items.find((x) => x.type === "source").power = 10;
  const scan = runPolarizationScan(
    p,
    5,
    { ...meterDefaults(), rangeMw: 0.0001 },
    { componentId: 2, count: 9, start: 0, end: 90 },
  );
  assert.ok(scan.points.some((p) => p.reading.overload));
  assert.equal(scan.fit, null);
  assert.match(scan.fitError, /seven/);
  await scanStore.save(scan);
  const rows = await scanStore.list();
  assert.deepEqual(
    rows.find((r) => r.id === scan.id),
    scan,
  );
});
test("scan panel acquires, displays fit and reopens saved record", async () => {
  const w = new Window();
  globalThis.document = w.document;
  const p = makeProject("waveplates"),
    records = [];
  const panel = createScanPanel({
    getContext: () => ({
      project: p,
      detectorId: 5,
      settings: { ...meterDefaults(), noiseNa: 0 },
      zero: null,
    }),
    store: {
      list: async () => records,
      save: async (r) => records.push(structuredClone(r)),
    },
    run: async (d) =>
      runPolarizationScan(d.project, d.detectorId, d.settings, d.options),
  });
  const root = document.createElement("section");
  document.body.append(root);
  panel.mount(root);
  await new Promise((r) => setTimeout(r, 10));
  root.querySelector('[data-scan-action="run"]').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.ok(root.querySelector("svg"));
  assert.match(root.textContent, /Residual RMS/);
  root.querySelector('[data-scan-action="save"]').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(records.length, 1);
  root.querySelector("[data-scan-history]").value = records[0].id;
  root.querySelector('[data-scan-action="open"]').click();
  await new Promise((r) => setTimeout(r, 10));
  assert.match(root.textContent, /Recorded scan opened/);
  w.happyDOM.abort();
});
