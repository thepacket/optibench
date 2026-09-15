import test from "node:test";
import assert from "node:assert/strict";
import { makeProject } from "../dist/project.js";
import {
  readMeter,
  meterDefaults,
  makeZero,
  responsivity,
} from "../dist/power-meter.js";
import { Window } from "happy-dom";
import { createPowerWorkspace } from "../dist/power-meter-ui.js";
const bench = () => {
  const p = makeProject("michelson");
  p.items = p.items.filter((c) => ["source", "power"].includes(c.type));
  const head = p.items.find((c) => c.type === "power");
  head.x = 1000;
  head.y = 450;
  head.angle = 0;
  p.items[0].power = 0.001;
  return p;
};
test("meter conserves intercepted Gaussian power and responds to wavelength setting", () => {
  const p = bench(),
    c = { ...meterDefaults(), noiseNa: 0, darkNa: 0, rangeMw: 0.01 };
  const r = readMeter(p, 6, c, { seed: 10 });
  assert.ok(Math.abs(r.valueMw - 0.001) < 1e-7);
  assert.ok(Math.abs(r.truth.incidentPowerMw - 0.001) < 1e-9);
  const wrong = readMeter(p, 6, { ...c, wavelength: 900 }, { seed: 10 });
  assert.ok(
    Math.abs(wrong.valueMw / 0.001 - responsivity(633) / responsivity(900)) <
      1e-4,
  );
  assert.equal(
    readMeter(p, 6, { ...c, rangeMw: 0.0001 }, { seed: 10 }).valueMw,
    null,
  );
  assert.throws(() => readMeter(p, 123, c, { seed: 10 }), /enabled/);
});
test("shutter zero removes dark offset, preserves raw overload and requires matching calibration", () => {
  const p = bench(),
    c = { ...meterDefaults(), noiseNa: 0, darkNa: 20, rangeMw: 0.01 };
  assert.throws(() => makeZero(readMeter(p, 6, c, { seed: 1 })), /shutter/);
  const zero = makeZero(readMeter(p, 6, { ...c, shutter: true }, { seed: 1 }));
  const r = readMeter(p, 6, c, { seed: 2, zero });
  assert.ok(Math.abs(r.valueMw - 0.001) < 1e-7);
  assert.equal(
    readMeter(p, 6, { ...c, shutter: true }, { seed: 2, zero }).valueMw,
    0,
  );
  assert.throws(
    () => readMeter(p, 6, { ...c, wavelength: 800 }, { seed: 1, zero }),
    /different/,
  );
  const tooDark = readMeter(
    p,
    6,
    { ...c, rangeMw: 0.0001, darkNa: 1000, shutter: true },
    { seed: 1 },
  );
  assert.equal(tooDark.overload, true);
  assert.throws(() => makeZero(tooDark), /overloaded/);
});
test("averaging lowers noise variance and preserves reproducible raw samples", () => {
  const p = bench(),
    c = {
      ...meterDefaults(),
      shutter: true,
      darkNa: 0,
      noiseNa: 10,
      rangeMw: 0.001,
    };
  const rms = (n) =>
    Math.sqrt(
      Array.from(
        { length: 120 },
        (_, seed) =>
          readMeter(p, 6, { ...c, averages: n }, { seed }).valueMw ** 2,
      ).reduce((a, b) => a + b, 0) / 120,
    );
  assert.ok(rms(64) < rms(1) / 5);
  assert.deepEqual(
    readMeter(p, 6, c, { seed: 17 }).samplesMw,
    readMeter(p, 6, c, { seed: 17 }).samplesMw,
  );
});
test("two aligned Michelson arms change integrated power with mirror piston", () => {
  const p = makeProject("michelson");
  p.items.find((c) => c.id === 3).angle = 0;
  const c = { ...meterDefaults(), noiseNa: 0, darkNa: 0 };
  const a = readMeter(p, 6, c, { seed: 1 });
  p.items.find((c) => c.id === 3).pistonNm = 633 / 4;
  const b = readMeter(p, 6, c, { seed: 1 });
  assert.ok(Math.abs(a.truth.incidentPowerMw - b.truth.incidentPowerMw) > 8e-6);
});
test("power workspace selects head, zeroes, saves and opens history without changing live settings", async () => {
  const w = new Window();
  globalThis.window = w;
  globalThis.document = w.document;
  document.body.innerHTML = '<div id="app"></div>';
  let p = bench();
  const stored = new Map();
  const ui = createPowerWorkspace({
    getProject: () => structuredClone(p),
    store: {
      list: async () => [...stored.values()],
      save: async (r) => stored.set(r.id, structuredClone(r)),
    },
  });
  await ui.open();
  const root = document.querySelector("#power-workspace");
  const click = async (a) => {
    root.querySelector(`[data-meter="${a}"]`).click();
    await new Promise((r) => setTimeout(r, 5));
  };
  const change = (k, v) => {
    const el = root.querySelector(`[data-meter-setting="${k}"]`);
    if (el.type === "checkbox") el.checked = v;
    else el.value = v;
    el.dispatchEvent(new w.Event("change", { bubbles: true }));
  };
  assert.equal(root.querySelector('[data-meter="zero"]').disabled, true);
  change("rangeMw", "0.01");
  change("shutter", true);
  await click("zero");
  assert.match(root.textContent, /Zero captured/);
  change("shutter", false);
  await click("read");
  assert.equal(root.querySelector(".instrument-truth"), null);
  await click("save");
  assert.equal(stored.size, 1);
  change("wavelength", 800);
  assert.match(root.textContent, /No zero calibration/);
  root.querySelector("[data-meter-history]").value = [...stored.keys()][0];
  await click("open");
  assert.equal(
    root.querySelector('[data-meter-setting="wavelength"]').value,
    "800",
  );
  assert.match(root.textContent, /Live settings differ/);
  await click("close");
  assert.equal(root.hidden, true);
});
