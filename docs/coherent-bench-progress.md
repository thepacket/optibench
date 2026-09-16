# Coherent bench integration

Baseline: 70a869a, 263 passing tests.

Completed first bounded integration:
- Dedicated coplanar chief-ray path discovery, up to sixteen detector paths.
- Angular-spectrum propagation through folds, centered thin lenses and finite apertures.
- Complex detector recombination with ideal splitter phases and uniform Jones polarization.
- Recorded-field camera acquisition and four physical optical-piston phase steps.
- Direct handoff to existing Measure workflow; snapshots, exports and saved field runs.

Boundaries: no recurrent/cavity solver, no non-coplanar transport, no thick-glass/coating connection. Diffracted tails cannot discover new paths. Scalar-grid and native-camera sampling are explicitly distinct. These items remain outstanding from the larger architectural roadmap.

Validation: all 275 automated tests pass, including 12 new coherent-physics and UI tests. JavaScript syntax, local module references and diff whitespace checks pass.
