import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import { createValidationCenter } from "../dist/validation-ui.js";
const win = new Window();
globalThis.document = win.document;
globalThis.Worker = undefined;
document.body.innerHTML = '<main id="app"></main>';
const center = createValidationCenter();
test("validation center runs benchmarks, shows comparisons and restores bench access", async () => {
  center.open();
  assert.equal(document.querySelector("#app").inert, true);
  document.querySelector('[data-validation="all"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.match(
    document.querySelector('#validation-center [role="status"]').textContent,
    /8 cases run · 8 passed/,
  );
  assert.equal(document.querySelectorAll("#validation-center svg").length, 8);
  assert.equal(
    document.querySelector('[data-validation="json"]').disabled,
    false,
  );
  document.querySelector('[data-validation="close"]').click();
  assert.equal(document.querySelector("#app").inert, false);
  assert.equal(document.querySelector("#validation-center").hidden, true);
});
