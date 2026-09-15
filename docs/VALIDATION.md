# Model validation — OptiBench 0.2.0

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
