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
let resizeBench;
globalThis.ResizeObserver = class {
  constructor(callback) { this.callback = callback; }
  observe(target) { if (target.id === "stage") resizeBench = this.callback; }
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
test("app renders a 293-entry inventory and a fully traced laboratory setup", () => {
  assert.equal(document.querySelectorAll(".catalog-card").length, 293);
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
  assert.equal(document.querySelectorAll(".template-card").length, 12);
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
test("paired panel toggles are the only visibility controls", () => {
  const inventory = el('.inventory-toggle'), inspector = el('.inspector-toggle');
  assert.equal(inventory.parentElement, inspector.parentElement);
  assert.equal(document.querySelectorAll('[data-action="library"]').length, 1);
  assert.equal(document.querySelectorAll('[data-action="inspect"]').length, 1);
  assert.equal(el('[data-action="close-drawer"]'), null);
  for (const [button, id] of [[inventory, 'library-panel'], [inspector, 'inspector-panel']]) {
    const initial = button.getAttribute('aria-pressed');
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), String(initial !== 'true'));
    button.click();
    assert.equal(button.getAttribute('aria-pressed'), initial);
    assert.equal(button.getAttribute('aria-controls'), id);
  }
  if (inspector.getAttribute('aria-pressed') === 'true') inspector.click();
  click('[data-action="select"][data-id="2"]');
  assert.equal(inspector.getAttribute('aria-pressed'), 'false');
  inspector.click();
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


test("table scales with panel height while preserving zoom and centre", () => {
  const stage = el('#stage');
  let height = 300;
  Object.defineProperty(stage, 'clientWidth', { configurable: true, value: 1000 });
  Object.defineProperty(stage, 'clientHeight', { configurable: true, get: () => height });
  el('[data-action="fit"]').click();
  const box = () => el('#bench').getAttribute('viewBox').split(' ').map(Number);
  const before = box();
  height = 600;
  resizeBench();
  const after = box();
  assert.ok(1000 / after[2] > 1000 / before[2], 'table should grow with available height');
  assert.ok(Math.abs(after[2] / after[3] - 1000 / 600) < 1e-9);
  assert.ok(Math.abs(after[0] + after[2] / 2 - before[0] - before[2] / 2) < 1e-9);
  click('[data-action="zoom-in"]');
  const zoomed = box();
  height = 300;
  resizeBench();
  const smaller = box();
  assert.ok(Math.abs(smaller[2] / before[2] - zoomed[2] / after[2]) < 1e-9);
  delete stage.clientWidth;
  delete stage.clientHeight;
  click('[data-action="fit"]');
});

test('waveplate setup exposes source ellipticity, axis, retardance and extinction controls',()=>{
 click('[data-action="templates"]');click('[data-template="waveplates"]');
 click('[data-action="select"][data-id="2"]');
 assert.ok(el('[data-field="retardance"]'));
 change('[data-field="retardance"]',90);change('[data-field="axis"]',45);
 assert.equal(read().project.items.find(c=>c.id===2).retardance,90);
 el('[data-component="1"]').dispatchEvent(new window.PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:1,clientX:200,clientY:450}));
 el("#bench").dispatchEvent(new window.PointerEvent("pointerup",{bubbles:true,pointerId:1}));
 change('[data-field="ellipticity"]',45);
 assert.equal(read().project.items.find(c=>c.id===1).ellipticity,45);
 el('[data-component="3"]').dispatchEvent(new window.PointerEvent("pointerdown",{bubbles:true,button:0,pointerId:1,clientX:700,clientY:450}));
 el("#bench").dispatchEvent(new window.PointerEvent("pointerup",{bubbles:true,pointerId:1}));
 change('[data-field="leakage"]',.001);
 assert.equal(read().project.items.find(c=>c.id===3).leakage,.001);
});

test("launch guidance opens the first lab without leaving a blocking dialog", () => {
  click('[data-action="about"]');
  assert.ok(el("#dialog").open);
  click('#dialog-body [data-action="first-experiment"]');
  assert.equal(el("#dialog").open, false);
  assert.ok(el('[data-guide="close"]'));
  click('[data-guide="close"]');
  click('[data-action="about"]');
  click('#dialog-body [data-action="problem-report"]');
  assert.ok(el("#problem-details"));
  assert.match(el("#dialog-body").textContent, /No report is sent automatically/);
  closeDialog();
});
