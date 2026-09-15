import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createMetrologyWorkspace } from "../dist/metrology-ui.js";
const win = new Window({ url: "http://localhost:5173" });
for (const k of ["window", "document", "Event", "MouseEvent"])
  globalThis[k] = win[k];
globalThis.Worker = undefined;
win.HTMLCanvasElement.prototype.getContext = function () {
  return {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
    strokeRect() {},
  };
};
const records = new Map(),
  store = {
    list: async () => Array.from(records.values()),
    save: async (r) => records.set(r.id, r),
    remove: async (id) => records.delete(id),
  };
const workspace = createMetrologyWorkspace({
  getProject: () => ({ title: "Bench reference", items: [] }),
  capture: () => {
    throw Error("Select a fringe detector.");
  },
  store,
});
const $ = (s) => document.querySelector(s),
  tick = () => new Promise((r) => setTimeout(r, 0)),
  click = async (action) => {
    $(`[data-measure="${action}"]`).click();
    await tick();
  };
test("measurement workspace reconstructs an example and saves complete immutable runs", async () => {
  workspace.open();
  await tick();
  assert.match($("#measurement-status").textContent, /Import images/);
  await click("demo");
  await click("analyze");
  assert.match($("#measurement-status").textContent, /complete/);
  assert.equal(document.querySelectorAll(".measurement-metrics>div").length, 4);
  await click("save");
  assert.equal(records.size, 1);
  const r = Array.from(records.values())[0];
  assert.equal(r.frames.length, 4);
  assert.equal(r.frames[0].values.length, 65536);
  assert.equal(r.result.phase.length, 65536);
  assert.equal(r.project.title, "Bench reference");
  assert.equal(r.engine, "1.0.0");
});
test("editing calibration invalidates the result and creates a distinct run after reconstruction", async () => {
  const input = $('[data-setting="wavelength"]');
  input.value = "532";
  input.dispatchEvent(new Event("change", { bubbles: true }));
  assert.equal($('[data-measure="save"]').disabled, true);
  await click("analyze");
  await click("save");
  assert.equal(records.size, 2);
  const runs = Array.from(records.values());
  assert.equal(runs[0].settings.wavelength, 633);
  assert.equal(runs[1].settings.wavelength, 532);
});
test("run comparison flags incompatible settings and saved runs restore decoded source data", async () => {
  for (let i = 0; i < 2; i++) {
    const input = document.querySelectorAll("[data-run-compare]")[i];
    input.checked = true;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }
  assert.match(
    $("#measurement-comparison").textContent,
    /Different analysis settings/,
  );
  await click("load-run");
  assert.match($("#measurement-status").textContent, /complete/);
  assert.ok(document.querySelector(".measurement-metrics"));
});
test("the single-image method and sideband controls work within the measurement workspace", async () => {
  const el = $('[data-setting="method"]');
  el.value = "fourier";
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await click("demo");
  assert.ok($('[data-setting="carrierX"]'));
  await click("analyze");
  assert.match($("#measurement-results").textContent, /Carrier \(12, 5\)/);
  await click("close");
  assert.equal($("#measurement-workspace").hidden, true);
  workspace.open();
  assert.equal($("#measurement-workspace").hidden, false);
});

test("image import sorts phase frames, preserves decoded pixels and reconstructs them", async () => {
  const { demoFrames } = await import("../dist/metrology.js");
  const fixtures = demoFrames(64).map((f, i) => ({
    ...f,
    name: `phase_${String(i * 90).padStart(3, "0")}.png`,
    size: 1000,
  }));
  const objects = new Map();
  let next = 0;
  const originalCreate = URL.createObjectURL,
    originalRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (f) => {
    const id = "blob:fixture-" + next++;
    objects.set(id, f);
    return id;
  };
  URL.revokeObjectURL = (id) => objects.delete(id);
  globalThis.Image = class {
    set src(url) {
      this.frame = objects.get(url);
    }
    async decode() {
      this.naturalWidth = this.frame.width;
      this.naturalHeight = this.frame.height;
    }
  };
  win.HTMLCanvasElement.prototype.getContext = function () {
    let image;
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      strokeRect() {},
      drawImage(i) {
        image = i;
      },
      getImageData() {
        return {
          data: Uint8ClampedArray.from(
            { length: image.frame.values.length * 4 },
            (_, i) =>
              i % 4 === 3
                ? 255
                : Math.round(image.frame.values[Math.floor(i / 4)] * 255),
          ),
        };
      },
    };
  };
  try {
    const method = $('[data-setting="method"]');
    method.value = "four-step";
    method.dispatchEvent(new Event("change", { bubbles: true }));
    const input = $("#measurement-files");
    Object.defineProperty(input, "files", {
      value: [fixtures[2], fixtures[0], fixtures[3], fixtures[1]],
    });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await tick();
    assert.match($("#measurement-status").textContent, /Images imported/);
    assert.equal($('[data-setting="n"]').value, "64");
    const names = Array.from(
      document.querySelectorAll(".measurement-frame-list span"),
    ).map((el) => el.textContent);
    assert.match(names[0], /phase_000/);
    assert.match(names[1], /phase_090/);
    await click("analyze");
    assert.match($("#measurement-status").textContent, /complete/);
    await click("save");
    const saved = Array.from(records.values()).at(-1);
    assert.equal(saved.frames[0].width, 64);
    assert.equal(saved.frames[0].origin, "Imported image · decoded luminance");
    assert.ok(saved.result.stats.validFraction > 0.99);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
  }
});

test("measurement exports include reproducible samples, a pixel map and an escaped report", async () => {
  const captured = [];
  const oldCreate = URL.createObjectURL,
    oldRevoke = URL.revokeObjectURL,
    oldClick = win.HTMLAnchorElement.prototype.click;
  URL.createObjectURL = (blob) => {
    captured.push(blob);
    return "blob:export-test";
  };
  URL.revokeObjectURL = () => {};
  win.HTMLAnchorElement.prototype.click = function () {};
  win.HTMLCanvasElement.prototype.toDataURL = () =>
    "data:image/png;base64,iVBORw0KGgo=";
  try {
    const notes = $("#measurement-notes");
    notes.value = "<script>untrusted note</script>";
    notes.dispatchEvent(new Event("change", { bubbles: true }));
    await click("export-run");
    const run = JSON.parse(await captured[0].text());
    assert.equal(run.frames.length, 4);
    assert.equal(run.result.height.length, 4096);
    assert.equal(run.notes, "<script>untrusted note</script>");
    await click("csv");
    assert.equal((await captured[1].text()).split("\n").length, 4097);
    await click("report");
    const report = await captured[2].text();
    assert.match(report, /&lt;script&gt;untrusted note/);
    assert.doesNotMatch(report, /<script>/);
    assert.match(report, /Relative OPD/);
    assert.match(report, /data:image\/png;base64/);
  } finally {
    URL.createObjectURL = oldCreate;
    URL.revokeObjectURL = oldRevoke;
    win.HTMLAnchorElement.prototype.click = oldClick;
  }
});
