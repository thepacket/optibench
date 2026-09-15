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
