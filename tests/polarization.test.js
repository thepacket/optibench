import test from "node:test";
import assert from "node:assert/strict";
import {
  sourceJones,
  polarizationElement as apply,
} from "../dist/polarization.js";
import { makeProject, validateProject } from "../dist/project.js";
import { trace } from "../dist/optics.js";
import { solveWave, cameraResponse } from "../dist/wave.js";
import { readMeter, meterDefaults } from "../dist/power-meter.js";
import { coherentField } from "../dist/interferometry.js";
const close = (a, b, t = 1e-10) =>
  assert.ok(Math.abs(a - b) < t, `${a} != ${b}`);
test("half-wave rotation, quarter-wave circularity and ellipticity follow Jones predictions", () => {
  for (const angle of [0, 10, 22.5, 45, 75, 90]) {
    const h = apply(sourceJones({}), {
      type: "waveplate",
      axis: angle,
      retardance: 180,
    });
    close(h.power, 1);
    close(
      apply(h.jones, { type: "polarizer", axis: 0 }).power,
      Math.cos((2 * angle * Math.PI) / 180) ** 2,
    );
  }
  const q = apply(sourceJones({}), {
    type: "waveplate",
    axis: 45,
    retardance: 90,
  });
  close(q.power, 1);
  for (const axis of [0, 30, 60, 90, 120])
    close(apply(q.jones, { type: "polarizer", axis }).power, 0.5);
  for (const e of [-45, 0, 20, 45])
    close(
      apply(sourceJones({ ellipticity: e }), { type: "polarizer", axis: 0 })
        .power,
      Math.cos((e * Math.PI) / 180) ** 2,
    );
  close(
    apply(sourceJones({ polarization: 90 }), {
      type: "polarizer",
      axis: 0,
      transmission: 0.8,
      leakage: 0.001,
    }).power,
    0.0008,
  );
});
test("bench, physical power meter and Fourier camera respond consistently to waveplate rotation", () => {
  const p = makeProject("waveplates");
  const wp = p.items.find((c) => c.type === "waveplate"),
    pol = p.items.find((c) => c.type === "polarizer"),
    head = p.items.find((c) => c.type === "power");
  pol.transmission = 1;
  pol.leakage = 0;
  wp.axis = 0;
  const first = readMeter(
    p,
    head.id,
    { ...meterDefaults(), darkNa: 0, noiseNa: 0, rangeMw: 0.0001 },
    { seed: 1 },
  );
  wp.axis = 22.5;
  const second = readMeter(
    p,
    head.id,
    { ...meterDefaults(), darkNa: 0, noiseNa: 0, rangeMw: 0.0001 },
    { seed: 1 },
  );
  close(second.truth.incidentPowerMw / first.truth.incidentPowerMw, 0.5, 1e-6);
  const cam = makeProject("waveplates-camera"),
    c = cam.items.find((c) => c.type === "camera"),
    plate = cam.items.find((c) => c.type === "waveplate");
  cam.wave = { n: 128, width: 8 };
  cam.items.find((c) => c.type === "polarizer").transmission = 1;
  cam.items.find((c) => c.type === "polarizer").leakage = 0;
  plate.axis = 0;
  const a = solveWave(cam, { detectorId: c.id, n: 128, width: 8 });
  plate.axis = 22.5;
  const b = solveWave(cam, { detectorId: c.id, n: 128, width: 8 });
  close(b.power / a.power, 0.5, 1e-6);
  const ra = cameraResponse(a.values, a.n, a.width, c, 633, { noise: false }),
    rb = cameraResponse(b.values, b.n, b.width, c, 633, { noise: false });
  const sum = (x) => x.reduce((s, v) => s + v, 0);
  close(sum(rb.values) / sum(ra.values), 0.5, 0.01);
  assert.equal(
    validateProject(cam).items.find((c) => c.type === "waveplate").retardance,
    180,
  );
});
test("advanced folded polarization fails explicitly instead of silently producing a scalar answer", () => {
  const p = makeProject("michelson");
  p.items.find((c) => c.type === "source").ellipticity = 45;
  assert.ok(
    trace(p).warnings.some(
      (w) => w.level === "error" && w.text.includes("straight"),
    ),
  );
  assert.throws(() => coherentField(p, 5), /straight/);
});
