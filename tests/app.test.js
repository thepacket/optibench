import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { solveWave } from "../dist/wave.js";
import { monteCarlo } from "../dist/optics.js";
const window = new Window({ url: "http://localhost:5173" });
window.document.body.innerHTML = '<div id="app"></div>';
for (const key of [
  "window",
  "document",
  "localStorage",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "FormData",
  "XMLSerializer",
])
  globalThis[key] = window[key];
globalThis.innerWidth = 1440;
globalThis.ResizeObserver = class {
  observe() {}
};
globalThis.requestAnimationFrame = (callback) => {
  queueMicrotask(callback);
  return 1;
};
globalThis.Worker = class {
  constructor(url) {
    this.url = url;
  }
  postMessage(data) {
    queueMicrotask(() => {
      try {
        this.onmessage?.({
          data: this.url.includes("analysis")
            ? { result: monteCarlo(data.project, data.detectorId, data.params) }
            : { job: data.job, result: solveWave(data.project, data.options) },
        });
      } catch (error) {
        this.onmessage?.({ data: { job: data.job, error: error.message } });
      }
    });
  }
  terminate() {}
};
window.HTMLCanvasElement.prototype.getContext = function () {
  return {
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
    putImageData() {},
  };
};
const tools = new Map();
document.modelContext = {
  registerTool(tool) {
    tools.set(tool.name, tool);
  },
};
await import("../dist/app.js");
await new Promise((resolve) => queueMicrotask(resolve));
const el = (s) => document.querySelector(s);
const click = (s) => {
  const target = el(s);
  assert.ok(target, `Missing ${s}`);
  target.click();
};
const change = (selector, value) => {
  const target = el(selector);
  assert.ok(target, `Missing ${selector}`);
  if (target.type === "checkbox") target.checked = value;
  else target.value = String(value);
  target.dispatchEvent(new Event("change", { bubbles: true }));
};
const read = () => tools.get("read_optical_bench").execute({});
function closeDialog() {
  if (el("#dialog").open) click('[data-action="close-dialog"]');
}
test("app renders a 291-entry inventory and a fully traced laboratory setup", () => {
  assert.equal(document.querySelectorAll(".catalog-card").length, 291);
  assert.equal(read().project.items.length, 6);
  assert.equal(read().detectors.length, 2);
  assert.match(el("#table-label").textContent, /1500 × 900/);
  assert.ok(el("#detector-canvas"));
  assert.match(el("#results-body").textContent, /0.900000/);
});
test("manufacturer filter and part-number search narrow the real inventory", () => {
  change("#brand", "Edmund Optics");
  assert.equal(document.querySelectorAll(".catalog-card").length, 90);
  const search = el("#search");
  search.value = "47-641";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  assert.equal(document.querySelectorAll(".catalog-card").length, 1);
  assert.match(el(".part-number").textContent, /47-641/);
  search.value = "";
  search.dispatchEvent(new Event("input", { bubbles: true }));
  change("#brand", "All manufacturers");
});
test("precise inspector edits update computation and local recovery data", () => {
  const before = read().detectors[0].radiusMm;
  change('[data-field="f"]', 75);
  assert.equal(read().project.items.find((c) => c.id === 2).f, 75);
  assert.notEqual(read().detectors[0].radiusMm, before);
  assert.equal(
    JSON.parse(localStorage.getItem("optibench-lab-v2")).items.find(
      (c) => c.id === 2,
    ).f,
    75,
  );
  click('[data-action="undo"]');
  assert.equal(read().project.items.find((c) => c.id === 2).f, 50);
});
test("bad optical edits are rejected without corrupting the project", () => {
  click('[data-action="select"][data-id="2"]');
  change('[data-field="f"]', 0);
  assert.equal(read().project.items.find((c) => c.id === 2).f, 50);
  assert.match(el("#toast").textContent, /Focal length/);
});
test("WebMCP validates positions and reports state only after mutation", () => {
  const setter = tools.get("set_component_position");
  assert.throws(
    () => setter.execute({ componentId: 2, xMm: 90000 }),
    /X position/,
  );
  assert.equal(read().project.items.find((c) => c.id === 2).x, 400);
  setter.execute({ componentId: 2, xMm: 410, yMm: 300 });
  assert.equal(read().project.items.find((c) => c.id === 2).x, 410);
  setter.execute({ componentId: 2, xMm: 400 });
  assert.throws(
    () => tools.get("read_optical_bench").execute({ unknown: true }),
    /empty object/,
  );
});
test("component locking prevents agent and keyboard movement", () => {
  change('[data-field="locked"]', true);
  assert.throws(
    () =>
      tools.get("set_component_position").execute({ componentId: 2, xMm: 425 }),
    /locked/,
  );
  assert.equal(read().project.items.find((c) => c.id === 2).x, 400);
  change('[data-field="locked"]', false);
});
test("parts and template dialogs populate from the active project", () => {
  click('[data-action="bom"]');
  assert.equal(el("#dialog").open, true);
  assert.match(el("#dialog-body").textContent, /6 placed components/);
  closeDialog();
  click('[data-action="templates"]');
  assert.equal(document.querySelectorAll(".template-card").length, 10);
  closeDialog();
});
test("template switching traces folded paths and leaves prior project undoable", () => {
  click('[data-action="templates"]');
  click('[data-template="folded"]');
  assert.equal(read().project.title, "Folded optical path");
  assert.equal(read().detectors.length, 1);
  click('[data-action="undo"]');
  assert.equal(read().project.items.length, 6);
  assert.equal(read().detectors.length, 2);
});
test("desktop inventory does not open a blocking drawer scrim", () => {
  click('[data-action="library"]');
  assert.equal(el("#drawer-scrim").hidden, true);
});
test("reverse-design form produces buildable sourced component pairs", () => {
  click('[data-action="design"]');
  el('form[data-form="design"]').dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  assert.ok(document.querySelectorAll('[data-action="apply-design"]').length);
  click('[data-action="apply-design"]');
  assert.equal(read().project.items.length, 4);
  assert.match(read().project.title, /beam expander/);
  assert.equal(read().detectors.length, 1);
  assert.ok(read().project.items[1].provenance !== "ideal");
  click('[data-action="undo"]');
});
test("Fourier controls show unsupported geometry as an explicit error", async () => {
  change("#mode", "Fourier");
  click('[data-action="solve-wave"]');
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.match(el("#results-body").textContent, /straight common axis/);
  change("#mode", "Gaussian");
});
test("application surface keeps primary controls present after actions", () => {
  assert.ok(el("#bench"));
  assert.ok(el("#inspector-body"));
  assert.ok(el("#catalog-list"));
  assert.ok(el("#detector-select"));
  assert.equal(read().project.items.length, 6);
});
test("table settings apply metric hole-center snapping without losing the layout", () => {
  click('[data-action="table"]');
  el('input[name="snapToHoles"]').checked = true;
  el('form[data-form="table"]').dispatchEvent(
    new Event("submit", { bubbles: true, cancelable: true }),
  );
  assert.equal(read().project.table.snapToHoles, true);
  assert.equal(read().project.table.pitch, 25);
});
test("pointer dragging uses both physical axes and snaps to actual hole centers", () => {
  const svg = el("#bench");
  svg.getScreenCTM = () => ({
    inverse() {
      return this;
    },
  });
  svg.setPointerCapture = () => {};
  globalThis.DOMPoint = class {
    constructor(x, y) {
      this.x = x;
      this.y = y;
    }
    matrixTransform() {
      return this;
    }
  };
  const send = (target, type, x, y) =>
    target.dispatchEvent(
      new window.PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        pointerId: 1,
        clientX: x,
        clientY: y,
      }),
    );
  send(el('[data-component="2"]'), "pointerdown", 400, 300);
  send(svg, "pointermove", 430, 333);
  send(svg, "pointerup", 430, 333);
  const c = read().project.items.find((c) => c.id === 2);
  assert.equal(c.x, 437.5);
  assert.equal(c.y, 337.5);
  click('[data-action="undo"]');
  assert.equal(read().project.items.find((c) => c.id === 2).x, 400);
});
test("mobile catalog drawer exposes inventory and closes cleanly", () => {
  globalThis.innerWidth = 700;
  click('[data-action="library"]');
  assert.equal(el("#drawer-scrim").hidden, false);
  assert.ok(el("#library-panel").classList.contains("drawer-open"));
  click('[data-action="close-drawer"]');
  assert.equal(el("#drawer-scrim").hidden, true);
  globalThis.innerWidth = 1440;
});

test("interferometry setup, piston controls, phase scan and persistence", () => {
  click('[data-action="templates"]');
  click('[data-template="michelson"]');
  assert.equal(el("#mode").value, "Interferometry");
  assert.match(el("#fringe-quality").textContent, /Valid row fit/);
  click('[data-action="select"][data-id="3"]');
  change('[data-field="pistonNm"]', 100);
  assert.equal(read().project.items.find((c) => c.id === 3).pistonNm, 100);
  assert.equal(
    JSON.parse(localStorage.getItem("optibench-lab-v2")).solver,
    "Interferometry",
  );
  click('[data-action="phase-scan"]');
  assert.match(el("#results-body").textContent, /Mirror piston scan/);
  click('[data-action="undo"]');
  assert.equal(read().project.items.find((c) => c.id === 3).pistonNm, 0);
  change("#mode", "Gaussian");
  assert.ok(el("#branch-select"));
  click('[data-action="templates"]');
  click('[data-template="mach-zehnder"]');
  assert.match(el("#fringe-quality").textContent, /Valid row fit/);
});

test("measurement workspace captures the current interferometer without editing its layout", () => {
  const before = JSON.stringify(read().project);
  // The emulated canvas supports the ROI overlay used by the measurement viewer.
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData() {},
      strokeRect() {},
    };
  };
  click('[data-action="measurements"]');
  click('[data-measure="capture"]');
  assert.equal(
    document.querySelectorAll(".measurement-frame-list>div").length,
    4,
  );
  assert.match(el("#measurement-status").textContent, /simulated linear data/);
  assert.equal(JSON.stringify(read().project), before);
  window.dispatchEvent(
    new KeyboardEvent("keydown", { key: "Delete", bubbles: true }),
  );
  assert.equal(JSON.stringify(read().project), before);
  click('[data-measure="close"]');
  assert.equal(el("#measurement-workspace").hidden, true);
});

test("alignment instruments synchronize height edits, fine stages, side projection and undo", () => {
  click('[data-action="templates"]');
  click('[data-template="alignment"]');
  assert.equal(el("#mode").value, "Alignment");
  assert.ok(el("#alignment-side-svg"));
  assert.match(el(".alignment-summary").textContent, /adjust mirrors/);
  click('.alignment-target[data-id="5"]');
  assert.equal(
    el('[data-field="mountType"]').value,
    "xyz",
    el('[data-field="label"]').value +
      " " +
      el('[data-field="mountType"]').outerHTML,
  );
  const before = read().project.items.find((c) => c.id === 5).z;
  click('[data-action="alignment-nudge"][data-axis="z"][data-sign="1"]');
  assert.ok(
    Math.abs(read().project.items.find((c) => c.id === 5).z - before - 0.1) <
      1e-9,
  );
  assert.match(el("#alignment-side-svg").textContent, /100.100/);
  click('[data-action="undo"]');
  assert.equal(read().project.items.find((c) => c.id === 5).z, before);
  change("#side-axis", "y");
  assert.match(el("#alignment-side-svg").getAttribute("aria-label"), /Y Z/);
  click('.alignment-target[data-id="5"]');
  change('[data-field="z"]', 130);
  click('[data-action="result-checks"]');
  assert.match(el("#results-body").textContent, /travel/);
  assert.equal(
    JSON.parse(localStorage.getItem("optibench-lab-v2")).items[4].z,
    130,
  );
});
