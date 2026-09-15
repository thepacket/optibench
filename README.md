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
