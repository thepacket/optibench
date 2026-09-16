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

- 293 inventory entries: 154 sourced manufacturer references and 139 parametric design entries. Manufacturer families include Thorlabs, Edmund Optics and Newport. Source links, lookup date, legacy status and assumptions travel with the catalog.
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

## Guided first experiment

Choose **First lab** on the bench rail. The guided Michelson workflow uses a fixed prepared bench, generates a detector preview, sweeps optical piston through one intensity cycle (0–316.5 nm, 9 points), displays four-phase reconstruction results, and recomputes instructional acceptance criteria including sampling sensitivity. Load the prepared bench explicitly to inspect its geometry; loading is undoable. Main-bench edits do not change the fixed guided experiment. Reopen First lab to resume its current in-memory step.

Save the complete project to Projects, export its JSON backup, or export the HTML report. Saved records include the layout, nine acquisitions, sweep, requirements and acceptance report. Backup import uses the existing Projects workflow. The guide includes recovery advice for low visibility, clipping, lost paths, cancellation and storage failures. Results are synthetic; these instructional limits do not certify an instrument. Unsaved guide progress is lost on page reload.

## Interactive alignment practice

Open **Practice** on the bench rail. Start with a Michelson mirror yaw offset of +0.08° and adjust either mirror with numeric offsets or ± step controls (0.005°, 0.001°, 0.0001°). Changes recompute the detector frame and phase reconstruction in a cancellable worker. Undo reverses an adjustment; Restart restores the challenge offsets. Main-bench edits do not change this isolated practice setup. Load the current practice bench explicitly to inspect it on the table; this is undoable.

The live comparison tracks visibility, usable area and beam-center separation against the initial result. Center separation is a geometric overlap proxy, not an overlap integral. Instructional targets are visibility ≥0.5, usable area ≥0.75, separation ≤0.5 mm; meeting them is not instrument certification. Per-layout normalization means image brightness is not an absolute power comparison. Hints respond to lost paths, increased separation or reduced usable area.

Save the comparison project or export a Projects-compatible backup with both bench layouts and source acquisitions. Export HTML for a compact metric comparison with exact layouts and settings. Results must be valid before saving, but need not meet the practice targets. Unsaved practice state is lost on reload.

## Collapsible side panels

Use the adjacent **Inventory** and **Inspector** toggle buttons beside the bench controls to open or fully close each panel. Their highlighted state indicates which panels are open. These are the only panel visibility controls; selecting components does not automatically open the inspector. Expanded panel widths remain adjustable with the inner-edge dividers and are restored when reopened. Collapse state and widths are remembered in this browser. Narrow screens retain the existing drawer behavior.

The workspace profile/maximize toolbar has been removed to recover bench space. The workbench/detector divider remains available.

## Scientific validation dashboard

In **Validate → Run all benchmarks**, the dashboard now combines phase reconstruction/fault benchmarks with optical checks for free-space Gaussian radius, ideal thin-lens ray focusing and Malus-law transmission. Each optical case reports its analytical expectation, computed value, absolute error, tolerance and exact fixture. A fixed Michelson setup is separately sampled at 64², 128² and 256²; successive differences show numerical sensitivity without claiming convergence.

The summary distinguishes failed checks from incomplete evidence. Solver support and limitations, analytical/synthetic provenance, and the lack of qualified laboratory data are visible in the dashboard and HTML report. JSON export also retains scientific results, layouts and summary. Imported frames or historical baselines do not become qualified experimental validation merely by importing them. Optical checks test named ideal cases, not all possible configurations.

## Michelson instrument experiment

Open **Experiment** in the bench rail. This workspace uses the active optical bench and selected enabled camera. Select a camera in Experiment or the detector tray; unsupported coherent geometry is reported explicitly. Adjust mirror yaw and optical piston, laser power, exposure, digital gain and camera assumptions, then **Acquire 4 phase frames**. Instrument edits update the main bench with undo support. Returning from the bench refreshes the live controls, and each acquisition freezes the current layout. Existing captures remain unchanged and are marked when their settings differ from the live bench.

Acquisitions use the same `cameraResponse` model as the bench detector: irradiance in mW/mm² becomes photoelectrons using physical pixel area, exposure, wavelength and QE; photon/dark shot noise and read noise precede full-well clipping, digital gain and ADC quantization. The 256² central ROI is unbinned: one simulated sample per native physical pixel. Irradiance is evaluated at each pixel centre; pixel-area integration is not modeled. Images use a fixed ADC display scale with no per-frame brightness normalization.

Four ideal calibrated reference-arm phase steps (0°, 90°, 180°, 270°) are applied while the scene remains fixed. They do not model a real phase actuator, drift, backlash or motion during exposure. Optical piston changes phase without moving the mount. Camera settings are editable assumptions, not measured vendor response curves. The reported relative OPD removes piston and tilt; it cannot recover absolute mirror position.

**Acquire 3 repeats** creates distinct acquisition IDs and independent per-frame noise seeds at identical settings. The workspace reports descriptive sample standard deviations; changed bench/camera/ROI settings and overlapping noise seeds are rejected by repeat analysis. Clipped or unreconstructable acquisitions retain their raw frames and diagnostics. **Show simulator truth** is off initially and after restoring a run; ordinary readouts and reports use measured data. Run JSON includes simulator provenance and truth for reproducibility, so this is not a secure assessment mode.

**Save all acquisitions** stores frames, camera settings, exact bench snapshots, timestamps and seeds locally. Open historical frames from the saved-run selector without replacing the active bench. **Apply recorded layout to bench** explicitly restores its layout and camera selection with undo support. Alternatively, open a run in **Measure** for full phase maps, repeat studies and reports. Export selected run JSON for portable backup; it opens through **Measure → Open run JSON**. Measurement reports omit simulator truth unless explicitly enabled. Unsaved acquisitions remain in memory while switching workspaces but are lost on page reload; a session permits up to 20 new acquisitions.

The earlier **First lab**, **Simulate**, and alignment-study workflows retain their documented ideal/normalized readouts for reproducible historical studies. This release adds a consistent physical-camera experiment path; it does not silently change those historical models or add a calibrated power meter, general optimizer, 3D optics or hardware acquisition.

## Power-meter instrument

Open **Power** in the bench rail and select an enabled power head. The selected head's physical aperture and current bench layout determine admitted optical power. Set wavelength (400–1100 nm), manual range (0.0001–100 mW) and averaging (1–256 independent samples). The illustrative silicon responsivity curve is not a vendor calibration. A wavelength mismatch changes the indicated power. Dark offset and Gaussian current noise are adjustable assumptions; resolution is range/100000. Raw overload is checked before zero correction; overloaded readings have no reported power value.

Close the modeled internal shutter and choose **Zero with shutter closed**, then reopen it to measure. Zero records retain their timestamp, seed, sample count and scatter. Changing head, wavelength, range or noise/offset assumptions clears zero. Shutter closure measures electronics noise/offset without needing a supported illuminated optical path. Zero is a session setting; saving a reading embeds its applied zero record.

**Acquire reading** freezes the current layout, head, settings, noise seed and raw samples. **Save reading** stores it locally; saved readings reopen without changing live settings. JSON preserves the complete record and bench snapshot; CSV exports raw samples and applied zero. Simulator truth is hidden until explicitly requested, but included in JSON for reproducibility. Unsaved readings and configuration are lost on reload.

Independent Gaussian beams are integrated over the circular head aperture on a 256² grid; two paths from one source use the supported coherent field model, including interference. Other multiple-coherent-path combinations fail explicitly. Single-path head incidence is limited to 5°. As in the underlying bench trace, geometrical beam-axis interception determines which beams reach the head; off-axis Gaussian tails alone do not create a traced hit. Sampling, first-order geometry and coherent-model limitations apply. This model does not qualify physical instrument accuracy, responsivity, drift, timing, thermal response or uncertainty. Averaging is a fixed-scene statistical sample count, not a timed hardware acquisition.

## Polarization and waveplate experiments

Choose **Setups → Waveplates & analyzer** for power readings, or **Waveplates & camera** for detector images. Select the waveplate and adjust **Fast-axis rotation** in the Inspector. Retardance 180° models a half-wave plate; 90° models a quarter-wave plate. With a linear source and fixed analyzer, rotating a half-wave plate produces the expected cos²(2θ−α) transmission. A quarter-wave plate at 45° to a linear source produces circular polarization and equal transmission through all ideal analyzer angles.

Source controls now include polarization azimuth and ellipticity angle: 0° is linear, ±45° circular, intermediate values elliptical. Jones components use the in-table transverse and vertical axes with exp(−iωt). No ambiguous left/right handedness labels are used. Polarizers expose pass-axis transmission and blocked/pass power ratio (0 ideal; 0.0001 means 10,000:1 extinction). The inventory includes ideal half-wave and quarter-wave plates; their fixed retardance is a user-specified operating-wavelength model, not a vendor prescription or dispersive material model.

Uniform Jones states propagate through straight Gaussian/ray paths and the straight scalar Fourier pipeline, affecting camera response and the Power instrument. Waveplates are spatially uniform retarders; there is no spatially varying polarization, birefringent walk-off, depolarization or polarization-dependent coating model. Polarization-optic incidence must be within 5° in the bench tracer; Fourier planes retain their stricter alignment requirement. Finite optic-edge diffraction for waveplates/polarizers is not modeled.

Advanced polarization (elliptical sources, waveplates, nonideal polarizers) is explicitly unsupported at mirrors/splitters and in the coherent interferometry workspace. Existing ideal linear-polarizer interferometry retains its prior scalar model. The Experiment workspace remains a four-phase interferometry instrument; use the main detector tray for straight-path camera images and Power for measured transmission.

Background: [Thorlabs waveplate tutorial](https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=7234&tabname=Tutorial). Analytical tests check lossless-retarder power conservation, half-wave rotation, quarter-wave circularity, ellipticity, finite extinction, camera/power response and explicit folded-path rejection. These tests establish the stated ideal model, not commercial waveplate performance.

### Polarization angle measurements

Load **Waveplates & analyzer**, open **Power**, and use **Polarization angle scan**.
Choose the half-wave plate or analyzer, angle range and reading count. Scans use
frozen copies of the active bench and current meter settings. Close the internal
shutter and acquire a zero, then reopen it before scanning to enable an extinction
ratio estimate when the minimum is resolved. Scans run in a cancellable worker.

The measured curve is fitted to a constant plus cosine/sine at four times the
half-wave plate angle or twice the analyzer angle. Reported axis is the angle of
maximum transmission modulo 90° or 180°, respectively. Fits use quantized acquired
readings, never simulator truth. Extinction is a whole-system estimate and is
suppressed without zero calibration, a resolved minimum, or acceptable residuals.
Saved local scans and JSON exports retain per-angle bench snapshots, raw meter
samples, seeds, settings, zero calibration and fit diagnostics; CSV exports retain
angles, measured powers, overload flags and seeds. This initial workflow supports
one source and one analyzer on a straight path; HWP scans require one 180° plate.

### Camera beam profiling

Open **Profile** and choose a bench camera, or use **Load focused-beam example**.
Acquire a native-pixel central ROI with shot, dark and read noise, full-well clipping
and ADC quantization. Exposure is local to the acquisition; the camera's other
instrument parameters come from its bench settings. An averaged shutter-closed
background is recorded automatically at matching settings. The measured border
provides residual offset correction, and signed pixel values are retained for
second moments to avoid positive bias from clipping negative noise.

The profiler reports centroid, horizontal/vertical D4σ diameters, principal-axis
diameters, minor/major ellipticity and orientation (withheld for nearly circular
beams). Integrated X/Y Gaussian fits and residual plots are diagnostic. Saturation,
ROI truncation, poor sampling, large fit residuals and inconsistent widths make a
frame ineligible for propagation fitting. This is not an ISO-certified instrument.
Beam-radius definitions: https://www.rp-photonics.com/beam_radius.html

A detector-position scan moves a frozen camera along its normal in one free-space
segment, acquiring independent frames at 7–21 positions. It fits measured radius
squared versus travel to estimate waist radius, waist location and divergence
half-angle. Fits require at least seven valid profiles, a bracketed waist, enough
width variation and acceptable residuals. No M² certification is claimed. Current
acquisition models circular Gaussian beams through straight-path lenses, filters
and polarization optics; it does not propagate aperture diffraction or coherent
multi-path fields. Scan ROIs are limited to 256 pixels; single frames support 512.

Saved browser-local records retain signal frames, averaged dark frames, background
seeds, camera settings, per-position bench snapshots and diagnostics. Complete JSON
and profile/scan CSV exports are available. Opening saved records does not modify
the live bench. Measurements are distinct from the autoscaled image display.

### Camera laboratory workflow (eight follow-up iterations)

1. **Automatic exposure:** Find exposure & acquire uses observed camera peak and
   saturation indicators, targets 60% of the usable ADC/full-well range, and retains
   all trials. Eight trials and 0.001–10000 ms bounds prevent unbounded searches.
   It does not use the simulator's ideal irradiance to select exposure.
2. **Movable ROI:** X/Y offsets select integer-pixel regions within the physical
   sensor. Center ROI on recorded beam uses the measured centroid; ROI-relative
   and sensor-relative centroids are displayed separately. The bench stays fixed.
3. **Repeatability:** Acquire 3, 5 or 10 independent signal/background pairs at
   fixed conditions. Valid frames yield sample means, sample SDs and standard
   errors; flagged frames remain in the record but are excluded from statistics.
4. **Fit uncertainty:** Propagation fits include approximate 95% t intervals from
   residual coefficient covariance and first-order propagation. They assume
   independent equal-variance errors in radius squared; calibration, drift,
   alignment and model bias are not included. These are not accuracy guarantees.
   Method references: [NIST least squares](https://www.itl.nist.gov/div898/handbook/pmd/section4/pmd431.htm)
   and [uncertainty propagation](https://www.nist.gov/pml/nist-technical-note-1297/nist-tn-1297-appendix-law-propagation-uncertainty).
5. **Validated JSON import:** Accepts profiler frames, scans and repeatability
   records up to 64 MB. Checks pixels, dimensions, instrument metadata, scan travel
   and snapshot consistency. Recomputes measurements from recorded pixels and
   discards supplied fits. Imports receive new IDs and retain a source ID; they do
   not overwrite existing records or authenticate a file's physical provenance.
6. **Saved-run comparison:** Compare the selected saved baseline with the current
   record of the same kind. Shows absolute/relative differences and changed
   acquisition conditions. Waist positions are not compared across different
   reference camera origins. Differences are not statistical significance tests.
7. **Printable reports:** Export a standalone HTML report with recorded conditions,
   bench components, selected image, measured profiles, diagnostics, repeatability
   or propagation results, approximate intervals and optional comparison. Open the
   report in a browser to print/save as PDF; retain complete JSON for raw pixels.
8. **Record management:** Add names and notes, view approximate serialized storage
   sizes, move saved records to reversible Trash, restore, export backups, or
   permanently delete a selected trashed record with explicit confirmation.
   Keeping a record open in memory does not keep its saved copy after deletion.

All data remains browser-local until the user exports a file. Single-frame ROIs
can be 512 pixels; repeatability and propagation scans are capped at 256 pixels.

### Experiment Runbook (next eight iterations)

Open **Runbook** in the app rail. Start with **Camera procedure example** or
**Power procedure example**, or capture the current bench as a procedure snapshot.
The live optical bench is never modified by execution.

1. **Saved procedures:** Name and annotate ordered camera/power steps, set repeats,
   select detector settings, and save immutable procedure revisions. Restore a
   recorded run's own procedure for reproduction. Explicit seeds make noise
   reproducible; New noise seed creates a separate realization.
2. **Preflight:** Checks supported detector paths, camera geometry, ROI bounds,
   source/model compatibility, every planned sweep value and browser resource
   limits. Failed preflight blocks execution. There are at most 12 steps, 40
   acquisitions and two million stored camera signal/background pixel values.
3. **Cancellable execution:** Runs in a worker with a 120-second deadline. Records
   every completed acquisition and an execution log. Cancellation retains completed
   data and discards the interrupted acquisition; late worker results cannot
   overwrite the retained partial run. Individual readings open in Power/Profile.
4. **Parameter sweeps:** Sweep supported lens/camera/power-head positions,
   waveplate/analyzer axes, source power or the selected camera exposure. Repeats
   occur at each point. Every point starts from an independent bench copy.
5. **Measured acceptance:** Inclusive limits apply to camera diameter, sensor
   centroid, ellipticity or indicated optical power. Decisions never use simulator
   truth. Invalid profiles/overloads are inconclusive, acquisition failures remain
   errors, and missing limits are measured but not passed. Stop-on-failure also
   stops on inconclusive/error outcomes, preserving the triggering measurement.
6. **Run comparison:** Matches acquisition positions/repeats only when bench,
   procedure settings and limits agree. Shows numerical differences and decision
   changes. Identical seeds are explicitly identified as non-independent data;
   incomplete runs compare only their common retained acquisitions.
7. **Validated portable backups:** JSON exports retain procedure snapshots, seeds,
   frames, averaged backgrounds, raw meter samples and zero acquisitions. Imports
   up to 64 MB verify planned order, geometry, conditions and seeds, then recompute
   camera fits, meter indications, zero corrections and acceptance decisions.
   Imported logs are reconstructed, IDs are new, and physical provenance is not
   authenticated. Imports do not overwrite existing saved records.
8. **Reports:** Measured sweep plots, CSV result tables and standalone printable
   HTML reports include limits, outcomes, diagnostics, settings, acquisition
   provenance, execution logs and optional comparisons. CSV text fields are
   protected against formula interpretation. Keep complete JSON for raw data.

Runbook execution inherits the existing instrument-model limits. It models fixed
snapshots and independent seeded instrument noise, not hardware automation,
mechanical hysteresis or temporal drift. A passing procedure is a statement about
its simulated measured values and specified limits, not hardware certification.


## Measured alignment and optimization

Open **Optimize**, or **Runbook → Alignment procedures**, to run bounded local optimization on frozen bench snapshots:

- Center a beam on the camera, reach a target D4σ diameter on both axes, or maximize indicated power.
- Select up to three unlocked component parameters (supported translations, source/mirror angles or polarization axes). Set absolute travel bounds and a search resolution. Bounds must include the starting value and respect table/stage geometry.
- Choose fixed camera exposure, native ROI and background averaging, or meter wavelength/range/averaging. Every meter reading receives a fresh shutter-closed zero. Scores use noisy measured values; invalid profiles, saturation, overload and unsupported optical paths are rejected.
- The coordinate search tests positive and negative steps, reducing steps when no improvement is found. It stops at resolution, evaluation budget or cancellation. It does not guarantee a global optimum.
- Fresh interleaved baseline/candidate readings report mean, sample SD and SEM. Apply is enabled only when measured loss improves by more than twice the combined SEM. This screening rule is not a confidence interval or a hardware accuracy claim. Target tolerance is reported separately from improvement.
- **Apply verified alignment** changes only the selected parameters, checks that the live bench still matches the recorded snapshot, and uses the existing Undo history. Examples run on copies; **Load procedure bench** explicitly loads an example before applying its result.
- Save/replay alignment procedures and runs in the existing local Runbook database. Export/import procedure JSON; export complete raw-data run JSON and a printable HTML report. Run JSON is an audit export, not an importable trusted measurement record.
- **Create Runbook verification procedure** turns the verified candidate into fresh measured acceptance steps. Camera axes are checked separately (centering uses a conservative per-axis tolerance); power must exceed the fresh baseline mean. The live bench is not changed by this handoff.

Limits: 3–48 search evaluations, 1–3 readings per search evaluation, 3–8 verification readings per condition, at most 60 readings plus meter zeros, two million stored camera pixel values, and a 120-second UI execution deadline. Cancellation retains finished evaluations and cannot enable Apply. Camera optimization inherits the single-source straight Gaussian-path profiler model. Instrument noise is simulated and does not include hardware drift or calibration uncertainty. The examples demonstrate centering, diameter and power optimization without lab equipment.


## Non-sequential geometrical optics

Open **Ray optics → Plate ghosts → Trace rays**. **Run physics checks** runs eight numerical reference checks inside the app.

The new solver is separate from Gaussian propagation and coherent interferometry. It implements true XYZ rays, nearest positive surface intersections, arbitrary repeated encounters, reflected/transmitted branching, and explicit medium tracking. Finite rectangular dielectric plates have all six faces; spheres have exact spherical boundaries; symmetric biconvex lenses use two spherical caps and a refracting cylindrical rim. Ideal planar mirrors, splitters, opaque stops and absorbing detectors complete the initial surface library.

Polarization uses global complex transverse field vectors with flux-normalized Fresnel amplitudes. The two orthogonal incoherent modes of an unpolarized source are transported separately. Total internal reflection retains the different complex s/p phases. Optical path lengths accumulate refractive index times geometric distance. Detector branches add **power**, not coherent amplitude: this solver does not produce interference fringes.

The material list includes nominal SCHOTT N-BK7 Sellmeier dispersion, a nondispersive n=1.5 reference, and unit-index ambient, with a supported 400–1100 nm band. Sources sample a collimated spatial Gaussian distribution, normalized after a 3-waist truncation; they do not include diffraction or angular divergence. A zero spatial waist is a pencil ray. Add sources at different wavelengths for independent spectral ray bundles.

### Results and persistence

- Oblique, top and front projections show the actual XYZ intersections. Select a path sequence to highlight it; reflected paths use a distinct color.
- Detector bins contain incident power and irradiance in mW/mm². The map uses a square-root display scale; detector CSV is linear. Detectors are ideal two-sided absorbers, without camera electronics, exposure or measurement noise.
- Terminal accounting separates detected, absorbed, escaped, below-threshold, encounter-limited, segment-limited and cancelled power. Unresolved power is never called physical absorption. The residual exposes numerical closure error. Per-object accounting includes every encounter and can therefore exceed launched power in reflecting paths.
- Filter detected paths by detector, visited component and exact reflection count. Sequence selection distinguishes direct transmission and internal-reflection ghost candidates. Intentional mirror paths also have reflections; a reflection count alone does not establish an unwanted ghost image.
- Save scenes/runs locally, export/import scene JSON, export full ray-audit JSON, and export detector/path CSV. Full run JSON is an audit export; restore its scene and recompute rather than trusting imported derived power totals.

### Bench integration and current limits

**Capture bench** creates a separate scene snapshot. It maps sources, ideal mirrors/splitters, stops and detectors. Mechanical bodies are explicitly excluded. Catalog lenses and unsupported optics are marked **Needs explicit surface model** and block tracing until the user specifies a supported prescription or removes them from the study. Selecting a parametric lens does not infer a manufacturer's radii, thickness, glass or coatings from focal length. The main bench and existing solvers are unchanged.

Dielectric bounding boxes must be disjoint; nested, touching or overlapping media are rejected. Coincident nearest surfaces are rejected as ambiguous. Glass is lossless and isotropic; no melt/temperature corrections, bulk absorption, thin-film stacks, scattering, CAD, anisotropic refraction, diffraction or interference is modeled. Sources must begin outside glass. Defaults and ceilings bound the ray tree: at most eight sources, 64 objects, 2048 rays/source, 64 encounters and 100,000 segments. The UI deadline is 120 seconds. Cancellation retains the previous completed run, not a partial result with a misleading power balance. The view shows at most 3000 segments; accounting and exports use all retained rays. Increase ray density and vary detector binning before interpreting fine irradiance structure.

### Reference checks

The automated checks cover Snell refraction, Brewster suppression, TIR magnitude and phase, transverse field transport, unpolarized averaging, SCHOTT reference indices, the plate's geometric reflection series and first forward ghost, tilted-plate lateral displacement, thick-lens/ball-lens paraxial focus, 3D rotational invariance, optical path length, finite rims/edges, energy budgets, malformed scenes, path filtering and UI persistence/cancellation.

Material coefficients and reference indices: [SCHOTT Optical Glass Datasheets, N-BK7](https://media.schott.com/api/public/content/820eba3413cc4e788433a3751f8edba9?download=true&v=97b3ea2b), page 13. Interface equations: [RP Photonics Encyclopedia — Fresnel Equations, Rüdiger Paschotta](https://www.rp-photonics.com/fresnel_equations.html). Nominal refractive indices are used against unit-index ambient; this is not a calibrated environmental-index model.
