import test from "node:test";
import assert from "node:assert/strict";
import {
  runScientificValidation,
  validationSummary,
  scientificHTML,
  coverageHTML,
} from "../dist/scientific-validation.js";
test("optical fixtures match independent formulas and preserve sampling provenance", () => {
  const r = runScientificValidation();
  assert.equal(r.rows.length, 3);
  assert.ok(r.rows.every((x) => x.passed && x.error <= x.tolerance));
  assert.ok(r.rows.every((x) => x.project.items.length));
  assert.deepEqual(
    r.sampling.rows.map((x) => x.n),
    [64, 128, 256],
  );
  assert.ok(r.sampling.rows.every((x) => x.status === "complete"));
  assert.equal(r.samplingProject.solver, "Interferometry");
  const s = validationSummary([{ passed: true }], 1, r);
  assert.equal(s.status, "All named checks passed");
  assert.equal(s.qualifiedLaboratoryDatasets, 0);
  r.rows[0].reference = "<script>bad</script>";
  assert.ok(scientificHTML(r).includes("&lt;script&gt;"));
  assert.match(coverageHTML(), /Imported laboratory frames/);
});
test("summary never treats missing optical, reconstruction, or sampling evidence as complete", () => {
  assert.equal(validationSummary([], 8, null).status, "Incomplete evidence");
  const r = {
    rows: [{ passed: true }],
    sampling: { rows: [{ status: "failed" }] },
  };
  assert.equal(
    validationSummary([{ passed: true }], 1, r).status,
    "Incomplete evidence",
  );
  r.rows[0].passed = false;
  assert.equal(validationSummary([], 8, r).status, "Checks failed");
});
