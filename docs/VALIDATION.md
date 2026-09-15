# Model validation — OptiBench 0.5.0

## Units and conventions

Geometry and field-window sizes are millimetres, wavelengths are nanometres at UI boundaries, optical powers are milliwatts, and camera exposure is milliseconds. The wave solver converts wavelength to millimetres for propagation. The sensor model converts power, time, wavelength and pixel area to SI units for photoelectron calculation.

X increases to the right, Y downwards. Optical angles specify the surface normal in the table plane, clockwise from +X. Source angles specify propagation direction. The source plane is a Gaussian waist. Mirrors perform `d_out = d_in - 2 (d_in · n) n`. Rays interact with finite line-segment optical surfaces, not infinite planes. The table boundary terminates traces.

## Verified mathematical cases

The executable regression suite checks:

1. Free-space complex-q propagation against the analytical Rayleigh-range equation.
2. Preservation of Gaussian radius across the plane of an ideal thin lens.
3. A 50/200 mm afocal telescope producing a 4× radius in the collimated limit.
4. Reflection direction and unit-vector normalization.
5. Complementary power in a 90:10 transmitted/reflected pickoff.
6. A two-mirror folded path reaching its downstream detector.
7. Malus-law transmission through a rotated analyzer.
8. Disabling a mirror removes its interception.
9. Thirteen paraxial marginal rays meeting at the focal plane.
10. Explicit termination of lens paths beyond the supported 10° incidence bound.
11. Reproducible Monte Carlo samples, and zero-tolerance agreement with nominal results.
12. Reverse-design lens-pair magnification and separation.
13. Complex 1D FFT roundtrip preserving phase and amplitude.
14. Angular-spectrum propagation conserving field energy.
15. Numerically propagated Gaussian second moments agreeing with analytical propagation.
16. Numerical field power following neutral-density attenuation.
17. Explicit rejection of unsupported folded wave geometry, multiple coherent sources and M² > 1.
18. Diffraction of a double-slit source with field-power conservation.
19. Rejection of an empty source field.
20. Sensor exposure scaling, full-well saturation and ADC quantization.
21. Seeded shot/read noise, and a Poisson sample mean consistent with expected counts.
22. Full-well clipping occurring before fractional digital gain.
23. Numerical thin-lens focusing agreeing with the independent ABCD solver.

Application/schema tests cover precise edits, invalid input rejection, local persistence, undo, template switching, optical-plane positioning, component locking, catalog filters, reverse design, model errors, drawer state, pointer movement on both axes and actual hole-center snapping. All catalog entries and experiment templates validate against the project schema.

Emulated-DOM tests validate event and state behavior; they do not establish rendered visual quality or substitute for cross-browser/manual UX validation.

## Gaussian solver limits

- Scalar, rotationally symmetric beam parameters in air; M² uses the effective-wavelength second-moment approximation.
- Thin lenses and plane mirrors only. No glass dispersion, lens prescriptions, aberration or astigmatic tangential/sagittal solution.
- Centered Gaussian aperture-transmission estimates; decenter and truncation are flagged because the downstream Gaussian shape becomes approximate.
- Ray branches are independent. Multiple arrivals can be selected individually; they are not coherently recombined, and power is not silently summed into an interference result.
- Screen observations may be non-absorbing. Adding recorded detector powers is therefore not a general energy-balance test.
- Limits: 300 placed components, 64 interactions per traced branch, eight splitter generations, and approximately 4,000 recorded segments.

## Fourier solver limits

The field uses a periodic finite FFT grid. The angular-spectrum transfer function removes a common carrier phase for numerical stability; evanescent frequencies are discarded. There is no absorbing boundary. A warning reports more than 0.5% of energy in the outer 5% border. A lens-phase gradient warning examines occupied support above 0.1% of peak intensity. These warnings are diagnostics, not sufficient convergence proofs. Repeat with finer sampling and a wider field window when interpreting a numerical result.

Only a single coherent M² = 1 source and straight parallel optical planes are accepted. Lens phase, circular apertures, single slits, linear polarizers and scalar attenuation are supported. Uploaded grayscale intensity is interpreted as the squared amplitude of a zero-phase coherent source. An upstream terminating detector or dump extinguishes the field.

D4σ image widths are four times the standard deviation along X/Y. These equal 1/e² Gaussian diameters for a perfect Gaussian but need not be equivalent for general diffraction patterns.

## Camera model limits

The sensor model samples irradiance at representative native pixel positions. Native pixel area determines expected photon count; this is a decimated preview rather than integration over every physical pixel or a full-resolution camera file. Finite field windows may leave sensor regions outside the simulated area unilluminated.

QE is a scalar user input at the source wavelength. Photoelectron/dark counts use a Poisson sampler below 30 expected electrons and a rounded Gaussian approximation above 30. Read noise is additive Gaussian noise. Full-well clipping precedes digital gain and ADC quantization. Noise is reproducible with a fixed seed. No PRNU, DSNU, blooming, rolling shutter, charge diffusion, color filter array or wavelength-dependent QE curve is modeled.

## Data provenance

Catalog sources are recorded in `dist/catalog.js` and exposed in component inspectors. Specifications use manufacturer tables and nominal values, including explicit archived/legacy sources. Values such as clear aperture, mounting footprint, power transmission, reflectivity and sensor noise are editable model assumptions unless the UI identifies them as sourced. Prices and current inventory status are intentionally absent.

Primary references used include:

- [Edmund Optics achromatic lens kits](https://www.edmundoptics.com/f/achromatic-lens-kits/11702/)
- [Thorlabs mounted visible achromats](https://punchout.thorlabs.com/newgrouppage9.cfm?objectgroup_id=2696&pn=AC254-300-A-ML)
- [Newport spherical lens kits](https://www.newport.com/f/basic-spherical-lens-kits)
- [Thorlabs optical breadboard geometry](https://www.thorlabs.com/newgrouppage9.cfm?objectgroup_id=7154&pn=B1824F)
- [Brown University Gaussian propagation notes](https://www.brown.edu/research/labs/mittleman/sites/brown.edu.research.labs.mittleman/files/uploads/lecture21_2.pdf)

## Coherent two-arm interferometry (0.3.0)

The dedicated Interferometry mode adds Michelson and Mach–Zehnder templates. It supports up to two overlapping paths from one TEM00 source in air, with plane mirrors, ideal reciprocal splitters, scalar ND filters, and linear polarization projections. It rejects lenses, aperture elements, M² > 1, multiple independent incident sources, large detector incidence and potentially clipped mirror/splitter beams. This mode is separate from the straight-axis Fourier solver.

Fields include geometric optical path, paraxial Gaussian curvature, accumulated Gouy phase, mirror phase π, and a reciprocal splitter convention t=√T, r=i√R. Mirror piston is a phase-only, positive-path increment of 2d cos(incidence); nanometre translation of physical geometry is neglected. Polarization is a scalar linear-basis approximation; coating-specific s/p phase and vector basis transport are not modeled. Gaussian coherence is explicitly defined as |γ|=exp[−(OPD/Lc)²], with user-entered 1/e coherence length.

The camera uses the existing native-pixel response on a 256² decimated preview. Fringe fitting uses the illuminated central row, divides by the modeled incoherent envelope, and searches spatial frequency by least squares. It reports period, visibility, centre-referenced phase and RMS residual. This is a model-assisted measurement from **simulated data**, not a laboratory acquisition or independent camera calibration. It cannot infer absolute OPD from one wrapped phase. Predicted period includes the local Gaussian curvature gradient at sensor centre. The fit is withheld for clipping, poor residual, low contrast, insufficient cycles or insufficient sampling; a valid fit is not an uncertainty certificate.

A phase scan evaluates 65 equally spaced mirror-piston settings over 2λ of displacement. It records predicted central irradiance and the simulated camera central-pixel signal, with independent reproducible noise per position. The scan does not modify the saved mirror position. CSV exports include the fitted metadata, normalized row, raw row and current scan.

Regression checks establish:

- Michelson bright/dark/bright response at piston 0, λ/4 and λ/2.
- Energy conservation across both ideal output ports for Michelson and Mach–Zehnder across several piston settings (relative tolerance 2×10⁻⁶).
- Noiseless sampled-camera fringe-frequency agreement with the independently calculated local phase gradient within 0.3% for both templates.
- Reproducible camera noise; rejection of saturated, single-arm and unresolved-carrier measurements.
- The defined 1/e coherence decay, preservation and validation of piston/coherence settings, and explicit failure of unsupported coherent configurations.
- Application workflow from template selection through piston adjustment, phase scan, undo, solver persistence and switching.

Physical phase and visibility relationships: [UCSB Michelson demonstration](https://web.physics.ucsb.edu/~lecturedemonstrations/Composer/Pages/84%5B1%5D.30a.html). These checks validate the stated ideal model; they do not establish agreement with a calibrated physical instrument.


## Image-based measurement workspace (0.4.0; metrology engine 1.0.0)

### Input and reconstruction

- Opaque PNG, JPEG and WebP files are decoded by the browser into 8-bit luminance without resizing. Native frame dimensions are limited to 64–2048 pixels per side; each input file is limited to 32 MB. A square, native-pixel ROI may be 64, 128, 256 or 512 pixels across. Camera RAW, TIFF, higher-bit-depth preservation, radiometric linearization and frame registration are not supplied. Use aligned, linear monochrome camera exports.
- Four-step frames must follow increasing phase 0°, 90°, 180°, 270°, with constant exposure. Filename order initializes the sequence; arrow controls allow reordering. The estimator is atan2(I270−I90, I0−I180), with modulation amplitude hypot(I0−I180,I270−I90)/2. Opposing-pair intensity sums provide a consistency diagnostic, not a complete phase-step calibration.
- Optional corrections use (signal−dark)/(flat−dark); without a flat the denominator is one. Calibration frames must match the signals' dimensions. Clipped signal samples, invalid flat responses and insufficient visibility are excluded.
- Single-image reconstruction uses a two-dimensional Hann window, a selected Fourier sideband and a circular filter with a flat inner 70% and cosine-tapered outer 30%. Automatic selection searches the positive half-plane; manual signed frequency bins can select the conjugate. Filtering changes spatial bandwidth, so repeat with different ROI/filter choices. Visibility is approximate for this method. The outer 10% and low window/amplitude support are excluded. A separated spatial carrier and slowly varying phase are required.
- Quality-guided connected-region unwrapping retains the region containing the strongest modulation sample. Disconnected regions have no established common fringe order and are excluded. Inconsistent unwrap edges generate diagnostics. Neighbouring true phase increments must remain below π; the algorithm cannot prove this from wrapped data.
- The retained phase has either its mean or its best-fit plane removed. OPD is λφ/(2π); reflecting-surface height is λφ/(4π cos θ). Sample-plane pixel scale controls lateral coordinates. Absolute distance, absolute fringe order, sample registration and physical sign for a single conjugate sideband are not established. PV/RMS describe the masked relative map and are not confidence intervals.

### Reproducibility and storage

Named experiments retain decoded full-frame samples, calibration frames, ROI and conversion settings, notes, associated bench snapshot, engine version, maps and statistics. Browser IndexedDB stores independent records; new saves do not mutate earlier runs. JSON export includes these data, with invalid map samples represented as null. Loading a saved run recomputes from retained inputs using the current engine; the source JSON keeps its original results. Two-run summary comparison flags different settings. No claim of aligned map subtraction is made.

The simulation capture creates normalized ideal irradiance at known phase offsets, with a disclosed positive offset and common scale; it is not an acquired camera signal. Imported data and synthetic data have distinct visible provenance. Standalone HTML reports contain the currently selected map, units, settings, statistics, diagnostics, frame names and notes. CSV contains per-pixel coordinates, masks, phase, relative nm and visibility.

### Verification

Numerical regressions recover a known multi-wrap four-step wavefront to 10⁻⁸ rad, recover its visibility, verify the two-dimensional Fourier carrier and recover a smooth synthetic phase to <0.03 rad RMS over the retained region. Tests also establish conjugate phase-sign reversal, dark/flat correction, reflection/incidence conversion, native ROI coordinates, clipping masks, phase-step inconsistency warnings, disconnected-region exclusion and reproducibility after JSON serialization.

Emulated application tests cover image decoding/import order, reconstruction, calibration edits invalidating results, immutable saved runs, run restoration/comparison, simulated bench capture, keyboard isolation and CSV/JSON/report contents. They do not replace physical instrument validation or browser rendering tests. IndexedDB uses the browser transaction API and surfaces storage failures rather than claiming a save succeeded.

References: [Takeda, Ina and Kobayashi, Fourier-transform method of fringe-pattern analysis (1982)](https://opg.optica.org/josa/abstract.cfm?uri=josa-72-1-156); [GRAVITY metrology: four-step phase-shifting concept and calibration (2015)](https://arxiv.org/abs/1501.04738).


## Optomechanics and alignment (0.5.0)

Each component has an axis height Z; sources, mirrors and splitters also accept elevation/pitch within ±1°. Existing projects without Z inherit the table reference height on validation. Plan-view intersections remain two-dimensional. The elevation extension propagates z += L·slope; source slope is tan(pitch). A plane mirror changes the vertical slope by −2(d_xy·n_xy)·pitch in radians, which is the first-order vertical component of vector reflection. A thin lens adds −vertical_decenter/f. Splitter transmission retains the slope and reflection applies the mirror update. The horizontal path length remains the Gaussian propagation distance, so this is not a full three-dimensional wave solution.

A centroid outside an optic's combined transverse/vertical circular envelope is recorded as a missed optic and continues along the incident direction. A centroid outside an iris/lens clear aperture stops. A descending ray stops at Z=0. Gaussian power clipping remains a centered approximation; the Alignment edge-margin diagnostic separately subtracts the 1/e² beam radius. Gaussian detector previews account for the vertical centroid shift. Folded coherent and Fourier calculations explicitly reject noncoplanar/elevation-tilted configurations.

The instrument tray projects all current branches onto X–Z or Y–Z, including posts, holder extensions and stage bases. Multiple optics may overlap in either projection; switch axes or use the simultaneous top view. Target cards expose horizontal/vertical centroid offsets and a 0.05 mm centring tolerance. Camera target clearance uses an inscribed circle of the active sensor. Dual-iris slope is reported only for the first two parallel irises on one unambiguous branch with no intervening optic, using changes in offset divided by path separation. This is a relative alignment diagnostic, not an uncertainty bound.

Mount assemblies are parametric assumptions, not catalog-verified products: post plus adjustable holder; a kinematic mirror mount with 6–50.8 mm optic capacity; and an XYZ stage with a 15 mm base. Holder extension is modeled from 0–50 mm. Stages retain X/Y/Z zero references and a configurable symmetric travel. Fine controls reject out-of-travel moves and locked-component moves; direct edits may create an invalid design state that is flagged in Design checks. Relocating the stage base resets its references. Thread checks refer to the base/table interface only. Footprints and clearances remain approximate; no screws, stress, stiffness, vibration or tolerance stack certification is modeled.

Tests check source elevation rise, projected mirror double-angle response, splitter-branch elevation, lens vertical focusing, missed mirrors, blocked irises, exact table interception, dual-iris pointing/centring, stage limits, thread/holder diagnostics, project round trips and explicit wave-solver limits. Application tests cover synchronized side projections, stage nudges, selection, undo, persistent height changes and diagnostics.

Alignment reference: [Newport two-mirror alignment application note](https://www.newport.com/medias/sys_master/images/images/h4b/h31/8797093363742/Fast-Steering-Mirror-Technology-App-Note-2.pdf).

## Scientific image input and reference subtraction

The TIFF decoder is verified sample-by-sample against four independently generated Pillow `I;16` files (uncompressed, LZW, PackBits and Adobe Deflate). Each contains 64×64 samples `(i × 127 + 32701) mod 65536`; test fixtures preserve low bits. A constructed big-endian fixture verifies horizontal prediction and white-is-zero inversion. Truncated offsets and invalid numerical intensity samples fail explicitly.

Reference tests verify a known residual and mean removal, a half-pixel shift with invalid interpolation neighbors, calibration mismatch rejection, operator-verification gating and a known correlation translation. Profiles preserve mask gaps and calibrated pixel-center coordinates. An emulated-DOM workflow verifies saving and reopening an attached reference, zero self-difference and invalidation after registration edits. These checks validate the implemented algorithms; they do not establish instrument uncertainty or resolve fringe-registration ambiguity.

## Repeatability study and quality screening

Three independently generated four-step datasets encode cosine wavefronts with amplitudes 1, 2 and 3 radians at λ = 200π nm. With mean-only removal, the verified PV mean/SD are 400/200 nm, RMS mean/SD are 100√2/100√½ nm, and spatial RMS of pixel temporal SD is 100√½ nm. One-minute acquisition spacing yields PV drift 200 nm/min. Tests also verify shared-mask clipping exclusion, missing-time drift suppression, duplicate-acquisition rejection, settings compatibility and operator-verification gating. The workflow test covers selection, analysis, simulated-data labeling and stale-result invalidation. Batch reconstruction runs in a worker in browsers.

Quality thresholds are explicit heuristics rather than pass/fail tolerances. A no-flags result cannot establish camera linearity, physical phase sign, registration correctness, independence or an uncertainty bound. Sample standard deviation uses N−1, and drift is descriptive least-squares slope, not a prediction or confidence interval. See the NIST measurement-process characterization reference linked in README.

## Bounded four-step uncertainty model

For ideal Ij = A+B cos(φ+δj), independent small spatially uniform step offsets have dφ/dδj = sin²φ/2 for j=0,2 and cos²φ/2 for j=1,3. Tests compare propagated PV/RMS changes against independently reconstructed intensity frames perturbed at each step. The derivative maps undergo the same mean/plane removal as the sample. Central finite differences assess local PV/RMS sensitivity, and >20% asymmetry in ±u responses disables a tolerance verdict. The reflection-angle curvature check likewise rejects reliance on a vanishing first-order derivative near normal incidence.

Tests verify quadrature combination, expansion by k, fixed-ROI width uncertainty, guard-band boundary rules, missing-calibration and mismatched-mask rejection, small-error bounds, simulated-data verdict suppression, calibration persistence and stale-budget invalidation. Contributions labeled standard uncertainties are local independent-input approximations; a flagged nonlinear budget requires a higher-order evaluation before interpretation. The app makes no 95% coverage claim and does not estimate effective degrees of freedom. Additional errors and correlations require external evaluation documented in the record.

## Interactive validation suite 1.0.0

`validation.js` generates sinusoidal truth directly from φ=a cos(2πx/N)+b sin(2πy/N), independent of the reconstruction code. The grid spans a complete period so its analytic mean is zero, PV=2(a+b) and RMS=√(a²+b²)/√2 before conversion to nanometres. Error calculations subtract truth's mean over the reconstructed mask, aligning the same relative-piston convention without fitting away residual shape error.

The ideal and reflection cases allow 10⁻⁷ nm numerical error, and the seeded-noise case allows 1 nm. Uniform noise σ=0.003 produces approximately 0.5345 nm error RMS for the fixed fixture. The +0.4 rad phase-step fault, ×1.25 single-frame exposure drift and 8-pixel single-frame shift must produce a consistency residual >5%. Saturation uses intensity 0.6+0.45 cosφ, clips to [0,1], and must flag clipped samples. None of these synthetic checks establishes coverage probability or physical-instrument uncertainty.

Automated tests execute all eight declared criteria, independently verify discrete truth statistics against analytic PV/RMS, verify seeded determinism and baseline validation, and exercise run-all and bench-return flows in an emulated DOM. They run in GitHub Actions with the existing numerical suite.

## Experiment archive restoration

Archive schema 1 stores original measurement inputs, selected repeat acquisitions, reference inputs, bench configuration and saved results. Restoration validates the bench and reconstructs all current and repeat inputs before applying state. Reference, repeat-study and uncertainty failures are reported as unavailable instead of reusing cached values. Saved and regenerated sample height, repeat mean and temporal SD maps are compared pixelwise; scalar PV/RMS and expanded uncertainty and tolerance decisions are also checked.

Tests round-trip the guided experiment through JSON, reproduce its eleven comparisons, verify immutable revision identity and parent links, detect altered sample/SD maps and expanded uncertainty, reject invalid normalized samples, and exercise guided loading, revision saving, bench restoration and restored-budget labeling. IndexedDB schema version 2 adds an archives store without deleting the existing runs store; immutable archive writes use add rather than put. Reconstruction comparison tolerances and historical-assertion reuse are displayed in the archive panel.

## Controlled simulation sweep validation

Tests verify that a Michelson arm piston completes an intensity cycle after λ/2 and changes intensity at λ/4, that sweeping does not mutate the base bench, and that each acquisition retains its exact modified mirror position and common normalization. Separate tests verify deterministic seeded frame noise, a 2× exposure response after subtracting the fixed 0.02 offset, rejection of different sweep conditions as repeat acquisitions, and transfer from the simulation UI into the measurement workflow. These exercise the supported normalized readout and ideal two-arm model; they do not validate a physical camera.

## Entire-sweep archive checks

Simulation-study and sweep-archive schemas validate row counts, point ordering, unique successful acquisition IDs, bench schemas and 128² four-frame source samples before reconstruction. Reopening regenerates all cases from the stored base bench/configuration and compares frames, retained masks, height maps, scalar summaries, bench snapshots and failure status. It uses the fresh results in the workspace while retaining saved revision data unchanged.

Tests round-trip complete studies, reproduce their values, preserve acquisition identities and parent revision links, identify modified frames/maps and historical failure transitions, reject incomplete studies, and reopen a Michelson archive while the active bench remains an expander. UI tests also save a new revision, retain controls across closing/reopening, and explicitly reset to the active bench. All tests run in the GitHub workflow.

## Saved sweep comparison

Tests reproduce identical saved revisions with zero metric deltas, verify source immutability and revision identity, suppress overlays/deltas for mismatched grids, retain unmatched points from the longer study, identify component edits/additions/removals, escape report labels, and exercise revision selection and stale-export invalidation in an emulated DOM. Comparison uses freshly regenerated results with the sweep archive's existing replay checks. Compatibility checks are explicit constraints on model comparison, not evidence of physical equivalence.

## Alignment search and tolerance studies

Tests exercise a known analytic objective with an optimum at +0.01 degrees, verify search bounds and deterministic uniform trial offsets, retain failed trials in the denominator, reject duplicate axes and locked mirrors, enforce stage travel, and run the real Michelson reconstruction and optimizer. UI tests restore archived inputs without applying a cached proposal. These establish implementation behavior under declared models; they do not validate a physical tolerance distribution, global convergence or manufacturing yield.

## Project navigation and backups

Tests verify transitive parent inclusion, immutable project snapshots and revision links, full source-frame retention, unique sweep provenance resolution, missing-parent reporting, idempotent import planning, conflict/duplicate rejection, and component/date/notes search. An emulated navigator test selects records, saves a project revision and dispatches restoration. Imports validate record inputs before a single cross-store IndexedDB transaction; reconstruction remains an explicit action in the corresponding analysis workspace. No physical validation is inferred from successful backup or restore.

## Browser reliability audit (2026-09-15)

Using the actual in-app browser on localhost, exercised Michelson setup loading, worker sweep execution, named revision saving and replay, comparison of two saved revisions, comparison persistence, three-grid sampling checks, alignment cancellation/retry, proposal application and Undo, project selection/saving, backup export action, fixture import and conflicting-identity rejection, and capture/reconstruction/saving of measurement frames. The navigator was also inspected visually at the available narrow viewport. Live-site experiment storage was not used for these tests.

The audit found and fixed detached file inputs in project/sweep imports, lingering completed-job progress, and overlapping workspace transitions. Keyboard entry was used for form tests because the browser automation's fill operation did not consistently dispatch the app's change handlers. The downloaded project file itself was not independently inspected; import was verified with a generated schema-valid fixture. No destructive browser purge was performed.

Automated regression tests verify transaction rollback across IndexedDB stores, exact Trash restoration, purge restrictions, three-grid numerical output, cancellation and terminal-response cleanup, workspace isolation and file-input identity retention. These complement the existing numerical and emulated interaction suite; they are not full browser coverage across every platform or all experimental configurations.
