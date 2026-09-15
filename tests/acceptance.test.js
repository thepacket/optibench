import test from "node:test";
import assert from "node:assert/strict";
import { Window } from "happy-dom";
import {
  requirementDefaults,
  createRequirements,
  assessEvidence,
  evaluateAcceptance,
} from "../dist/acceptance.js";
import { makeProject } from "../dist/project.js";
import { simulateRuns } from "../dist/simulation-runs.js";
import { createSweepArchive } from "../dist/sweep-archive.js";
import {
  createProjectBundle,
  validateBundle,
} from "../dist/project-navigator.js";
import {
  createAcceptanceWorkspace,
  acceptanceHTML,
} from "../dist/acceptance-ui.js";
const rules = (extra = {}) =>
  createRequirements("Test <limits>", {
    ...requirementDefaults,
    requireTolerance: false,
    requireSampling: false,
    ...extra,
  });
const row = {
  status: "complete",
  visibility: 0.5,
  validFraction: 0.75,
  errorRMSNm: 1,
};
test("inclusive boundaries meet; a known violation overrides missing evidence", () => {
  assert.equal(assessEvidence(rules(), { rows: [row] }).status, "meets");
  const r = assessEvidence(rules(), {
    rows: [{ ...row, visibility: 0.49 }, { status: "failed" }],
  });
  assert.equal(r.status, "fails");
  assert.equal(r.checks[1].status, "insufficient evidence");
  assert.equal(
    assessEvidence(rules(), { rows: [] }).status,
    "insufficient evidence",
  );
});
test("tolerance trials use current requirements, require minimum count and count failures", () => {
  const req = rules({
      requireTolerance: true,
      minTrials: 5,
      minTrialFraction: 0.8,
    }),
    trials = [row, row, row, row, { status: "failed", pass: true }];
  assert.equal(
    assessEvidence(req, { rows: [row], trials }).checks[3].observed,
    0.8,
  );
  assert.equal(assessEvidence(req, { rows: [row], trials }).status, "meets");
  assert.equal(
    assessEvidence(req, { rows: [row], trials: trials.slice(0, 4) }).status,
    "insufficient evidence",
  );
  assert.equal(
    assessEvidence(req, { rows: [row] }).status,
    "insufficient evidence",
  );
});
test("sampling uses both adjacent changes and does not ignore failed grids", () => {
  const req = rules({ requireSampling: true, maxSamplingChange: 0.02 });
  const sampling = [
    {
      rows: [
        { n: 64, status: "complete", visibility: 0.5 },
        { n: 128, status: "complete", visibility: 0.55 },
        { n: 256, status: "complete", visibility: 0.551 },
      ],
    },
  ];
  assert.equal(assessEvidence(req, { rows: [row], sampling }).status, "fails");
  sampling[0].rows[1].status = "failed";
  assert.equal(
    assessEvidence(req, { rows: [row], sampling }).status,
    "insufficient evidence",
  );
});
test("saved sweep is regenerated and report backups include source and requirements", () => {
  const p = makeProject("michelson"),
    study = simulateRuns(p, {
      parameter: "piston",
      start: 0,
      end: 10,
      count: 2,
      seed: 42,
      detectorId: p.items.find((x) => x.type === "camera").id,
      mirrorId: p.items.find((x) => x.type === "mirror").id,
    }),
    source = createSweepArchive(study, {
      title: "Sweep",
      revisionName: "First",
    }),
    req = rules({ minVisibility: 0, minValidFraction: 0, maxErrorRMSNm: 1 });
  source.study.rows[0].visibility = 0;
  const r = evaluateAcceptance(req, source);
  assert.equal(r.status, "meets");
  assert.ok(r.evidence.rows[0].visibility > 0);
  assert.equal(r.sourceId, source.id);
  assert.equal(r.requirementsId, req.id);
  assert.equal(r.evaluatedLayouts.length, 2);
  assert.match(acceptanceHTML(r), /Test &lt;limits&gt;/);
  const backup = createProjectBundle([r, req, source], [r.id], {
    title: "Evidence",
  });
  assert.equal(
    validateBundle(JSON.parse(JSON.stringify(backup))).records.length,
    3,
  );
});
test("invalid requirements reject unknown or nonnumeric limits", () => {
  assert.throws(() => rules({ minVisibility: 2 }), /Invalid/);
  assert.throws(() => rules({ maxSamplingChange: NaN }), /Invalid/);
  assert.throws(() => rules({ samplingMetric: "unknown" }), /Invalid/);
});
test("requirements UI saves immutable revisions and invalidates saved state on edits", async () => {
  const w = new Window();
  globalThis.document = w.document;
  document.body.innerHTML = '<main id="app"></main>';
  globalThis.Worker = undefined;
  const entries = [];
  const ui = createAcceptanceWorkspace({
    store: {
      list: async () => entries,
      save: async (r) => entries.push(structuredClone(r)),
    },
  });
  await ui.open();
  document.querySelector('[data-accept="save-requirements"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(entries.length, 1);
  const id = entries[0].id;
  const input = document.querySelector('[data-limit="minVisibility"]');
  input.value = "0.7";
  input.dispatchEvent(new w.Event("input", { bubbles: true }));
  assert.equal(
    document.querySelector('[data-accept="evaluate"]').disabled,
    true,
  );
  assert.equal(entries[0].limits.minVisibility, 0.5);
  document.querySelector('[data-accept="save-requirements"]').click();
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(entries[1].parentRevisionId, id);
  assert.equal(entries[1].limits.minVisibility, 0.7);
});
test("alignment acceptance refuses a different saved proposal", async () => {
  const { runAlignmentStudy } = await import('../dist/alignment-study.js');
  const p = makeProject('michelson');
  const source = runAlignmentStudy(p, {
    detectorId: p.items.find(x => x.type === 'camera').id,
    target: 'visibility', seed: 42, trials: 5, minVisibility: 0, minValid: 0,
    controls: [{ id: p.items.find(x => x.type === 'mirror').id, axis: 'angle', bound: 0.02, tolerance: 0.001 }]
  });
  const req = rules({ minVisibility: 0, minValidFraction: 0, maxErrorRMSNm: 100 });
  assert.equal(evaluateAcceptance(req, source).replay.savedProposalMatches, true);
  source.proposedProject.items[0].x += 1;
  const report = evaluateAcceptance(req, source);
  assert.equal(report.status, 'insufficient evidence');
  assert.equal(report.replay.savedProposalMatches, false);
  assert.equal(report.evaluatedLayouts.length, 0);
  assert.deepEqual(report.source.proposedProject, source.proposedProject);
});
