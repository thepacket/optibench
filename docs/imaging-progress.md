# Imaging expansion: eight iterations

Baseline: 9d354cd, 250 passing tests.

1. Power-weighted spot diagrams and covariance statistics.
2. Geometrical encircled energy with explicit collection denominator.
3. Virtual free-space focus scan and analytic least-RMS focus.
4. Explicit circular pupil and OPD wavefront model with obscuration.
5. Orthonormal Zernike synthesis and least-squares decomposition of imported maps.
6. Scalar monochromatic Fraunhofer PSF and sampled Strehl.
7. Incoherent MTF with spatial-frequency scale and sampling diagnostics.
8. Saved imaging studies, portable input imports/exports, and analytical validation.

The ray analysis uses recorded detected rays and cannot recover vignetted rays.
The diffraction model uses an explicitly supplied pupil, not inferred ray OPL.
No vector diffraction, high-NA correction, or measured hardware validation is implied.

Completed: all eight additions are implemented and exposed through Imaging / Ray optics → Imaging analysis. All 263 tests pass, including 13 new analytical and UI checks. JavaScript syntax checks, local import checks and diff whitespace checks pass.
