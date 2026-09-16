# Measured alignment: eight iterations

## Scope
Bounded alignment on frozen bench copies, evaluated through existing noisy camera/power instruments. No new optical solver or hardware-validity claim. Preserve current application appearance. Apply requires an explicit action and an unchanged live bench.

## Plan and checkpoint
1. Alignment goals: camera centering, camera diameter, maximum indicated power — implemented.
2. Parameters: selectable positions/angles with finite travel and resolution — implemented.
3. Measured objectives: quality-gated instrument acquisitions, independent seeds — implemented.
4. Runner: bounded coordinate search, progress, cancellation, evaluation budget — implemented.
5. Constraints: project geometry, stage travel, invalid/saturated readings — implemented.
6. Verification: fresh baseline/candidate repeats, mean/SD/SEM and explicit outcome — implemented.
7. Review/apply: parameter changes, before/after, stale-bench guard and undo — implemented.
8. Runbook: saved/replayable alignment procedures, JSON audit and printable report — implemented.

## Decisions
- Use the existing Runbook storage and instrument functions; expose alignment procedures from Runbook and the app rail.
- Keep objective evaluation independent of simulator truth. Preserve raw acquisitions in the audit.
- Local derivative-free coordinate search is not a global optimizer. Noise variability is descriptive; hardware uncertainty is outside scope.
- Use worker isolation; cancellation keeps completed evaluations and never enables Apply on a partial run.

## Validation / next action
Initial repository: clean main at 33859d3.
- New core, workspace, worker, report, and Runbook handoff modules are implemented.
- Eleven focused tests passed, including three real-instrument examples, qualification replay, noise rejection, cancellation, stale bench protection and UI workflows.
- Final validation: all 219 tests passed; JavaScript syntax and whitespace checks passed. All eight iterations are implemented.
- Next: commit the validated source, push it, and publish to the existing public Site.
- No browser interaction QA was performed (Sites skill permits it only when explicitly requested). Local preview served successfully.
- Public publishing must follow the Sites hosting skill and preserve the existing audience if deployment is authorized.
