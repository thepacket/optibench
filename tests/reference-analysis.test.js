import test from "node:test";
import assert from "node:assert/strict";
import {
  subtractReference,
  estimateTranslation,
  crossSection,
} from "../dist/reference-analysis.js";
const frame = () => ({
  n: 64,
  version: "1",
  settings: {
    method: "four-step",
    n: 64,
    pixelUm: 2,
    wavelength: 633,
    geometry: "opd",
    incidence: 0,
    removeTilt: false,
    x: 0,
    y: 0,
  },
  height: Float64Array.from(
    { length: 4096 },
    (_, i) => (i % 64) ** 2 + Math.floor(i / 64) * 3,
  ),
  corrected: Float64Array.from(
    { length: 4096 },
    (_, i) => Math.sin(i * 12.9898) * Math.cos(i * 78.233),
  ),
  mask: new Uint8Array(4096).fill(1),
  stats: {},
});
test("reference subtraction removes only common mean and retains known residual", () => {
  const r = frame(),
    s = frame();
  s.height = s.height.map((v, i) => v + 5 + 2 * (i % 64));
  const d = subtractReference(s, r, { verified: true });
  assert.equal(d.stats.pvNm, 126);
  assert.equal(d.removedMeanNm, 68);
  assert.equal(d.height[0], -63);
  assert.equal(d.height[63], 63);
  assert.throws(() => subtractReference(s, r), /Verify/);
  r.settings.wavelength = 532;
  assert.throws(
    () => subtractReference(s, r, { verified: true }),
    /wavelength/,
  );
});
test("subpixel bilinear translation respects masks and overlap", () => {
  const r = frame(),
    s = frame();
  r.height = r.height.map((v, i) => i % 64);
  s.height = s.height.map((v, i) => (i % 64) + 0.5);
  r.mask[20] = 0;
  const d = subtractReference(s, r, { dx: 0.5, dy: 0, verified: true });
  assert.equal(d.mask[19], 0);
  assert.equal(d.mask[20], 0);
  assert.equal(d.mask[63], 0);
  assert.ok(d.stats.rmsNm < 1e-10);
  assert.throws(
    () => subtractReference(s, r, { dx: 17, verified: true }),
    /translation/,
  );
});
test("correlation recovers a known translation from nonperiodic texture", () => {
  const r = frame(),
    s = frame();
  for (let y = 0; y < 64; y++)
    for (let x = 0; x < 64; x++) {
      const i = y * 64 + x;
      if (x + 3 < 64 && y + 2 < 64)
        s.corrected[i] = r.corrected[(y + 2) * 64 + x + 3];
      else s.mask[i] = 0;
    }
  const e = estimateTranslation(s, r, { radius: 6 });
  assert.equal(e.dx, 3);
  assert.equal(e.dy, 2);
  assert.ok(e.score > 0.999);
});
test("profiles preserve excluded gaps and calibrated pixel-center coordinates", () => {
  const r = frame();
  r.mask[2 * 64 + 4] = 0;
  const p = crossSection(r, { axis: "horizontal", index: 2, pixelUm: 2 });
  assert.equal(p[4].value, null);
  assert.equal(p[0].positionUm, 1);
  assert.equal(p[63].positionUm, 127);
  assert.equal(crossSection(r, { axis: "vertical", index: 4 })[2].value, null);
});
