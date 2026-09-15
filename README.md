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
