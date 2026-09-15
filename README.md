# OptiBench

A browser-based optical laboratory layout and first-order simulation application. The working surface is a physical-coordinate optical table rather than a page of controls.

## Run and validate

```sh
npm ci
npm test
npm run check
npm start
```

Open the local server at `http://localhost:5173`. Runtime code has no npm dependencies. `happy-dom` and `prettier` are development tools only. Hosted output is the authored `dist/` directory; `.openai/hosting.json` preserves the existing private Sites project.

## Alignment workflow

Open **Setups → Two-mirror alignment**. The Alignment instrument tray shows an X–Z/Y–Z side projection, iris centroid targets and fine yaw/elevation/height adjustments. Select an optic to set its axis height and attach a parametric post/holder, kinematic mount or XYZ stage. Stage travel, holder extension, thread mismatch and optic/table clearance generate design checks. Mount coordinates and stage offsets export as CSV; the complete project preserves all mechanical settings.

Vertical ray propagation is a first-order extension of the plan-view trace, limited to small elevation angles. The coherent/Fourier solvers continue to require coplanar optics. See the validation document for these boundaries.

## Measurement workflow

Choose **Measure** in the app rail. Import a single spatial-carrier image or four frames ordered 0°, 90°, 180°, 270°. The workbench accepts opaque PNG/JPEG/WebP decoded to 8-bit luminance at native resolution, with optional dark and flat frames. Set a square ROI, sample-plane pixel calibration, wavelength and OPD/reflection geometry; reconstruct phase, inspect masks and diagnostics, then save a named experiment.

Runs are stored locally in IndexedDB. Export run JSON for portable backup; it contains all decoded signal/calibration samples, settings, the associated bench snapshot and results. Pixel maps export as CSV and reports as printable standalone HTML. Keep original camera files separately. The app provides analysis, not hardware acquisition or a calibrated uncertainty certificate.

## Included capabilities

- 291 inventory entries: 154 sourced manufacturer references and 137 parametric design entries. Manufacturer families include Thorlabs, Edmund Optics and Newport. Source links, lookup date, legacy status and assumptions travel with the catalog.
- Metric or imperial optical-table hole patterns, arbitrary X/Y placement, optical-normal rotation, adjustable mounting envelopes, hole-center or incremental snapping, locking, multiple selection, pan, zoom, rulers and numerical placement.
- Two-dimensional intersection and reflection, beamsplitter branches, finite-aperture ray clipping, ideal thin lenses, polarizers, neutral-density filters, screens, power meters and camera planes.
- Coherent Michelson and Mach–Zehnder experiments: two-arm field summation, mirror piston, finite coherence, simulated camera fringe fits, phase scans and measurement CSV. Open **Setups → Michelson interferometer**. See the validation document for the supported ideal model.
- Complex-q Gaussian propagation and a separate 13-ray geometric trace.
- Numerical scalar Fourier propagation with a 2D FFT angular-spectrum operator, thin-lens phase, apertures, slits, coherent image inputs and sampling diagnostics; 128² through 1024² grids.
- A configurable native-pixel camera-response model including QE, exposure, photon/dark shot noise, read noise, full-well clipping, digital gain and ADC quantization. Preview is decimated and camera calibration parameters are explicitly assumed.
- Catalog comparison, custom catalog JSON import, equivalent-lens replacement, two-lens reverse design, bounded parameter sweeps and seeded Monte Carlo analysis in a worker.
- Device-local recovery, versioned project import/export, legacy project migration, included source-image data, undo/redo, BOM CSV, optical-path CSV, tolerance CSV, wave cross-section CSV and table SVG export.

## Architecture

| File                      | Responsibility                                                       |
| ------------------------- | -------------------------------------------------------------------- |
| `dist/catalog.js`         | Source-attributed catalog and component factory                      |
| `dist/project.js`         | Project schema validation, legacy migration, experiment templates    |
| `dist/optics.js`          | Pure geometry, complex-q and ray solvers, tolerances, reverse design |
| `dist/wave.js`            | Pure FFT, scalar wave propagation, moments, sensor model             |
| `dist/wave-worker.js`     | Numerical wave computation off the UI thread                         |
| `dist/analysis-worker.js` | Monte Carlo computation off the UI thread                            |
| `dist/app.js`             | Workspace UI, canvas interaction, local persistence and exports      |
| `dist/icons.js`           | Functional interface icon geometry                                   |
| `dist/style.css`          | Desktop workspace and compact drawer layouts                         |
| `tests/`                  | Analytical/numerical regression and emulated-DOM workflow tests      |

## Engineering scope

This is a laboratory planning and first-order optical modeling tool, not a qualified physical-assembly or lens-prescription solver. It does not certify damage thresholds, mount fit or experimental safety. Catalog records are reference data, not a live availability/price feed. Reference EFLs are modeled at ideal principal planes; source BFL values are metadata. Surface prescriptions, wavelength-dependent glass dispersion and coatings, thick-lens aberrations, vector wave fields and out-of-plane geometry are not implemented.

See [model validation](docs/VALIDATION.md) for verified cases and numerical limitations. The same limitations and model references are available in the app's Guide and inspector.

## Precision import and reference measurements

Open **Measure** to import unsigned monochrome 8/16-bit TIFF or numerical JSON. TIFF supports classic, single-page, top-left strip images with no compression, LZW, PackBits or Deflate, including horizontal predictor 2. Color, signed, floating-point, tiled, rotated and multipage TIFF files require conversion. Original integer precision is retained through Float64 normalization. JSON uses `{width,height,fullScale,values}` with a flat row-major array, 64–2048 pixels per side and samples between zero and the declared full scale; a template is available in the app. PNG/JPEG/WebP retain their existing browser-decoded 8-bit luminance path.

Save a reference experiment, reconstruct the sample, then choose the saved reference under **Reference wavefront**. Matching reconstruction geometry, ROI, scale, wavelength and detrending are required. Translation samples the reference at `(sampleX + dx, sampleY + dy)` using bilinear interpolation. The corrected-intensity correlation search proposes an integer shift within ±12 pixels; periodic fringes can produce false matches. The operator must verify registration and physical phase sign before applying subtraction. Rotation, magnification differences and distortion are not corrected. The result uses the valid-mask intersection (at least 25% overlap) and removes its common mean. It subtracts the independently detrended wavefronts, so absolute piston and removed tilt are unavailable.

Horizontal and vertical cross-sections select a zero-based ROI row or column from the sample or difference map. Profiles retain invalid-pixel gaps and use pixel-center distances from the ROI origin. Difference maps and profiles export as CSV. Saved run JSON embeds a single-level reference with its original frames and calibration, registration and profile selection; reopening recomputes both wavefronts and the comparison. Printable reports include reference identity, translation, overlap, descriptive PV/RMS and the selected profile.

## Repeatability and quality

**Measure → Saved experiments → Repeat** selects 3–20 independent acquisitions. Confirm the same sample, spatial registration and unchanged conditions, then choose **Analyze repeats**. Every wavefront is reconstructed from its stored intensity and calibration. Settings must match; at least 25% of the ROI must be valid in every run. PV and RMS use this common region with a separate mean removed from each acquisition. The study reports their means and sample standard deviations, plus a mean map and a temporal standard-deviation map (N−1 denominator). The spatial RMS of that SD map summarizes wavefront variation. Multiple saves sharing an acquisition ID are rejected. Reimported/legacy files still require the operator to establish independence.

Enter actual acquisition times as ISO 8601 with timezone before saving. Linear PV/RMS drift uses those timestamps in minutes and is unavailable if any are absent, invalid or duplicated. File save times are not acquisition times. Simulation captures are timestamped; imported images and examples require entered acquisition times. Study JSON includes all contributing runs, settings and statistical maps; summary/map CSV and a standalone HTML report are also available. Exports provide archival data; study JSON is not currently a workspace-import format.

The quality panel screens clipping, retained mean visibility, valid area, phase-step residual, unwrap conflicts and reference-registration verification. Thresholds (20% visibility, 75% valid area and 5% phase-step residual) are review aids, not experimentally qualified acceptance criteria. Simulation provenance and Fourier sign ambiguity remain visible. Statistics do not provide a complete uncertainty budget, assess removed piston/tilt, or certify an instrument.

GitHub Actions runs locked dependency installation, syntax checks and the numerical/workflow test suite on pushes and pull requests. The workflow has read-only repository permission and does not publish the app. See [GitHub's Node.js workflow documentation](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs) and [NIST's discussion of repeatability](https://www.itl.nist.gov/div898/handbook/mpc/section1/mpc114.htm).

## Phase-stepped uncertainty budget

After a repeatability study, use **Measure → Phase-stepped uncertainty budget** for the current single-acquisition sample map. Its settings and valid mask must match the repeat study. Fourier reconstructions, reference-difference maps and unresolved quality flags are excluded. Enter a calibration record ID/date, certificate and instrument references, scope/corrections, and explicit standard uncertainties. Convert a certificate's expanded uncertainty by its stated coverage factor before entry; blanks mean unknown, while zero requires a written justification. Calibration records and evaluated budgets are embedded in saved measurement runs; reopening restores the calibration and requires reevaluation. JSON and standalone HTML budget exports include the sample identity, model version, settings, contributing repeat IDs and assumptions.

The budget combines single-acquisition repeatability SD, wavelength scale sensitivity, reflection-incidence sensitivity, four independent spatially uniform phase-step offsets and user-evaluated remaining PV/RMS effects in quadrature. It does not divide repeat SD by √N because the measurand is a single acquisition. Pixel-scale uncertainty applies to fixed-ROI width, not PV/RMS of the same pixels. All inputs are treated as independent; correlated step errors, registration, camera nonlinearity, environment and other unmodeled effects require an external evaluation and documented inclusion without double counting. Known biases must already be corrected.

The bounded first-order model accepts wavelength standard uncertainty ≤1%, pixel scale ≤5%, and angle/phase-step uncertainty ≤1°. Phase derivatives are projected through the selected plane removal, then differentiated through PV/RMS using central finite differences. Asymmetry above 20% in ±u responses flags nonlinear behavior and suppresses decisions. Near-normal incidence with nonzero angle uncertainty can require a higher-order model. This screening does not establish full model adequacy.

Expanded U = k × combined standard uncertainty, with explicit k from 1 to 5 and no automatic coverage-probability claim. For an optional upper tolerance L: within limit requires y+U≤L; above limit requires y−U>L; otherwise the verdict is indeterminate. Simulation, nonlinear-model review and a zero combined uncertainty suppress physical acceptance verdicts. These are conditional assessments under the stated budget, not certified conformity decisions.

Method references: [NIST uncertainty propagation and coverage](https://physics.nist.gov/cuu/Uncertainty/coverage.html), [NIST reporting guidance](https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-7-reporting-uncertainty), and [JCGM 106 conformity assessment](https://www.bipm.org/en/doi/10.59161/jcgm106-2012).

## Validation Center

Choose **Validate** on the bench rail, then **Run all benchmarks**. Eight deterministic cases cover known sinusoidal OPD, multi-wrap unwrapping, reflection conversion at 30°, seeded camera noise, phase-step calibration error, exposure drift, inter-frame displacement and saturation. Accuracy cases require error RMS within their displayed tolerance, >99% valid area and no unwrap conflicts. Diagnostic PASS means an injected fault was detected, not that the corrupted reconstruction is accurate. Expected PV/RMS describes the full analytic ROI; fault cases may retain only a subset.

Each case shows expected/recovered PV and RMS, pointwise error RMS/max, validity and diagnostics, plus a center-row expected/recovered profile. All cases use 128² native samples and λ=633 nm. Noise has independent uniform samples with σ=0.003 and fixed seed 4731. The fixture export contains source frames, analytic truth, settings and case definition; it is a benchmark bundle rather than an image-import file. JSON/HTML reports record suite and engine versions. Open a prior JSON report as a baseline to compare error RMS; historical reports are operator-provided and are not rerun or authenticated.

The suite establishes analytical/synthetic evidence for the phase-measurement engine, not whole-app or physical instrument qualification. The candidate-data section links [published ceramic/steel interferograms](https://zenodo.org/records/18440754) and [quadrature calibration research](https://perso.ens-lyon.fr/ludovic.bellon/wp/2022/harmonic-calibration-of-quadrature-phase-interferometry/). Those data have not been imported, qualified or counted as benchmark evidence. Admission requires calibration, known phase ordering, a suitable independent reference result and reuse permission.

## Complete experiment archives

Open **Measure → Complete experiment archive**. Give the experiment and revision a name, add notes, and choose **Save revision**. Each immutable revision includes the current bench layout, current measurement's original source/calibration frames and settings, its reference and registration, the active repeat study with all contributing acquisitions, and its calibration/uncertainty record. Each revision has its own ID, experiment ID and parent-revision link. **New history** starts a separate experiment; reopening an older revision and saving creates a branch from that revision. Revisions are stored locally in IndexedDB; **Export** creates a portable JSON backup. Archive import is limited to 250 MB.

**Open & recompute** or **Open archive JSON** reconstructs source images before applying the archive to the workspace. The bench restore is undoable. Repeat mean/SD maps, sample maps and scalar statistics are compared to their saved counterparts; missing, changed and failed results are reported explicitly. Scalar tolerance is 10⁻⁷ + 10⁻⁹ × |saved|; map tolerance is 10⁻⁷ nm with identical masks. Those tolerances check software reproducibility, not measurement accuracy. Imported repeat records appear in the working session; the archive remains their durable container. Saved ordinary runs remain intact. Exported archives are not authenticated or tamper-proof.

Recomputation reuses archived operator assertions for registration, repeatability and budget scope. Restored uncertainty reports identify this explicitly; review those assumptions before new measurement decisions. A failed reference/study/budget computation leaves its result unavailable and reports the reason, while malformed primary source data prevents restoration.

**Guided synthetic experiment** loads an illustrative Michelson layout, three deterministic analytical acquisitions, their repeat study and a synthetic uncertainty record. The layout and analytical frames are independent examples, and the timestamps/calibration values are illustrative. Follow the in-app steps to inspect measurements, review uncertainty, run the Validation Center, then save and reopen your own named revision. No equipment is required and no physical calibration is implied.

## Controlled simulation runs

Open a two-arm interferometer under **Setups**, then choose **Simulate** on the rail. Select the detector and arm mirror, a parameter and 2–12 values. Supported controls are absolute mirror piston (±10000 nm), mirror-angle offset (±0.1°), relative exposure (0.05–4) and Gaussian normalized-intensity noise σ (0–0.05). Each point traces a separate copy of the bench; the active bench is unchanged. The 128² square sampling width is held fixed across the sweep. Unsupported or lost paths and failed reconstructions remain explicit failed cases in the exported study.

Readout uses one peak irradiance from the base bench across all cases: `0.02 + 0.9 × exposureMultiplier × irradiance/basePeak`, followed by Gaussian noise and clipping to [0,1]. This is an illustrative normalized readout, not the existing hardware camera model. Per-phase seeds are reused across cases to isolate parameter effects, so sweep points are not independent repeats. Repeatability analysis rejects differing controlled-sweep conditions.

The comparison table reports first-frame center intensity, mean visibility, PV/RMS, valid area and error RMS against ideal readout on the same modified bench. Each reconstruction removes its own fitted plane, so the error includes changes caused by masking/detrending. Piston and tilt removed during reconstruction cannot be inferred from PV/RMS; the first-frame intensity plot reveals the piston fringe cycle. Model-to-model error is not physical accuracy or uncertainty.

**Save acquisitions & measure** stores successful cases with exact bench snapshots, sweep IDs/values, sampling, fixed normalization and seeds. These fields survive measurement run exports and experiment archives. **Export complete study** preserves the base bench, configuration, successful acquisitions and failed-case details; this JSON can be reopened through **Open study / archive** in Simulate. The ordinary simulation capture also records its detector, grid, normalization and ideal-readout provenance.

## Reopening and archiving entire sweeps

In **Simulate**, choose **Open study / archive** to reopen an exported simulation-study JSON or a named sweep archive (maximum 250 MB). The saved base bench and controls become the frozen working study; the active optical bench is unchanged. Every point is regenerated with its recorded seed and compared against its stored frames, maps, masks, scalar results, bench snapshots and success/failure status. The comparison flags changes; current recomputed plots and measurements are displayed. Original acquisition IDs are preserved for reproduced successful cases so replay is not mistaken for an independent acquisition.

**Save entire sweep revision** stores every point, including failures, in one immutable local revision with an experiment title, revision name, notes and parent link. Export a saved revision for backup. Open an earlier revision to branch from it; old revisions remain unchanged. Sweep histories are displayed in Simulate, while measurement archives remain in Measure. Bare study files start a new history when saved. Imported archives retain their parent identity even when the preceding revision is not stored on this browser.

Closing and reopening Simulate retains the working study. **Use current bench** explicitly starts from the current optical layout and clears the current result and archive parent. Editing sweep controls invalidates displayed results while retaining the frozen study bench. Frame comparison tolerance is 10⁻¹² normalized intensity; scalar/map tolerance is 10⁻⁷, and masks, bench snapshots and status must agree. These checks concern software reproducibility, not experimental accuracy. If a historical failed point now succeeds, its saved failure remains visible in the comparison and original archive.

## Comparing saved sweep revisions

In **Simulate → Compare saved studies**, select revisions A and B and choose **Recompute & compare**. Both revisions are regenerated before overlaying center intensity, mean visibility, reconstruction error RMS and valid area. The point table reports A, B and B−A; failed and missing points remain visible. Bench changes list component additions/removals and changed properties using saved component IDs.

Different parameters, ordered grids, detectors, swept mirrors or reconstruction settings disable overlays and deltas. There is no interpolation. Different base intensity normalization disables the intensity overlay and delta specifically; other metrics carry a readout warning. Noise seed changes and differences from archived results are reported. Component IDs establish correspondence and must be reviewed when comparing independently created layouts.

Export a standalone HTML report or comparison JSON with both revision IDs, sweep configurations, recomputation checks and bench differences. Revisions remain unchanged. Comparisons use synthetic model results and do not establish physical accuracy or automatically rank designs.

## Alignment optimization and tolerance evidence

In **Simulate**, select a detector and choose **Alignment & tolerances**. Choose visibility or valid detector fraction as the objective. Select up to four unique axes across unlocked mirrors, with explicit relative search bounds and uniform tolerance half-widths. Supported axes are plan-view angle (degrees, maximum ±0.1), X/Y position (mm, maximum ±5), and optical piston (nm, maximum ±10000). Piston changes phase without translating the mount. X/Y translations change the traced geometry and arm lengths.

The optimizer makes three coordinate-search passes at full, half and quarter bounds. It retains the best reconstructable candidate, including the starting layout, without claiming a global optimum. The preview shows starting/proposed values, visibility and valid fraction. **Apply proposal** requires the active bench to match the study's frozen input and adds an undo step. For a stale study, return to Simulate and choose **Use current bench** before starting another alignment study.

Choose 5–100 trials and an integer seed. Each trial independently draws uniform offsets around the proposal for the selected axes. Tolerance perturbations may extend beyond optimization bounds; stage travel, mechanical violations, lost paths and reconstruction errors count as failures in the denominator. The displayed fraction is the observed fraction satisfying both chosen thresholds in this synthetic sample, not a certified yield or confidence bound. Other degrees of freedom and environmental effects are not randomized.

Evaluation uses the existing 128² four-phase reconstruction with ideal normalized readout; each candidate has its own intensity normalization. Visibility is averaged over retained pixels, so increasing it can reduce usable area; review both metrics. This is not a calibrated camera or 3D wave model. Save immutable evidence locally or export JSON containing base/proposed layouts, controls, search evaluations, all trials, thresholds and the source sweep revision ID when available. Saved or imported evidence reopens its validated inputs for a fresh computation, never applies a cached proposal. Cancel stops a running browser worker without changing the bench.

## Project & Experiment Navigator

Choose **Projects** on the bench rail. The project tree groups saved project revisions; the record folders organize bench layouts, measurements, measurement archives, sweeps, comparisons and alignment studies. Search by name, notes, date, component label/part or record ID. **Save current bench layout** captures the active bench; select records, give the project a name and purpose/notes, then **Save project revision**. Selection from an existing project creates a new immutable revision with a parent link. Saved project views use their captured record snapshots.

Each record exposes its embedded source bench where available, with undoable restoration. Explicit parent references link revisions and comparisons. Acquisitions link to a saved sweep when their study ID resolves uniquely; ambiguous or unavailable references remain unresolved rather than guessing a revision. **Open & recompute** sends measurements, archives and sweeps to their existing workflows. Alignment records reopen validated inputs for a fresh run. Comparisons recompute from both source sweep revisions and show their compatibility checks. Missing comparison sources prevent recomputation. Layout restoration does not imply analysis validation.

Use **Save comparison to Projects** in Simulate to retain comparison references. Applying an alignment proposal now saves its evidence and an applied-layout snapshot linked to that evidence. Earlier applications were not recorded retroactively. Changes to a saved layout afterward do not rewrite that snapshot.

**Export saved project backup** includes the selected revision's record snapshots and available referenced record ancestors. All source frames, settings and embedded layouts travel with their records. Unavailable references are identified; prior project-selection revisions, unselected unrelated records and unsaved workspace edits are not included. Capture and select the current bench before backing it up. Import accepts up to 250 MB and 1000 records, validates inputs, and writes new records in one IndexedDB transaction. Identical records are reused; conflicting IDs stop the import without overwriting evidence. Open records after importing to recompute numerical results. Backups are local JSON files, not authenticated evidence or cloud synchronization.

## Reliability controls

Finite analysis workers now show elapsed time and a shared **Cancel analysis** control, with a 120-second timeout. Sweep jobs report point progress; sampling checks report the active grid. Cancellation retains inputs and clears busy state for retry. Switching analysis workspaces hides the previous surface. Simulate identifies whether its frozen study matches the active bench; Measure identifies when frames belong to a different source layout.

Under **Projects → Local storage**, inspect approximate serialized data sizes, export individual backups, move records to recoverable Trash, or restore them. Trash retains its data and does not free space. Permanent removal is available only from Trash after an explicit confirmation. Independent copies inside project snapshots remain intact. Refresh storage sizes after other workspaces save records. Measurement deletion also moves its record to Trash.

**Simulate → Check sampling stability** compares 64², 128² and 256² independently sampled phase-frame reconstructions at fixed detector extent. The table shows visibility, valid fraction, PV and RMS plus successive differences. Masks and sampled intensity normalization vary with resolution; these are numerical sensitivity checks, not proof of convergence or physical accuracy.

## Requirements and acceptance reports

Open **Projects → Requirements & acceptance**. Name and save an immutable requirements revision, then select a saved sweep or alignment study and **Recompute & evaluate**. Set minimum visibility and valid detector fraction, maximum reconstruction error RMS, optional tolerance-trial fraction/minimum count, and optional maximum absolute successive sampling change. Limits are inclusive.

Each criterion receives **meets**, **fails**, or **insufficient evidence** with its observed value and reason. Known violations take precedence over missing evidence. Sweep records cannot supply tolerance trials. Alignment trials are assessed against the new requirements; failed trials count in the denominator. A regenerated alignment proposal must match its saved layout before it can be assessed. Sampling checks both 64²→128² and 128²→256² for every design case.

Save the report to Projects or export standalone HTML/JSON. Reports retain requirements, source revision, evaluated layouts, settings, fresh metrics and replay checks. Project backups include linked source and requirements records when available. Reopening a report requires a fresh evaluation; historical verdicts are not reused. These reports assess simulated evidence under the recorded model, not laboratory performance or certified yield.
