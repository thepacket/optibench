# Non-sequential physics expansion — eight iterations

Baseline: 98ed85c, 237 passing tests. Keep existing solvers and scene imports compatible.

1. Custom tabulated material n(λ), attenuation α(λ), provenance — implemented.
2. Beer–Lambert bulk absorption, distance and power audit — implemented.
3. Polarized coherent dielectric multilayer boundary amplitudes — implemented.
4. Coating editor, reverse traversal, AR and reflector examples — implemented.
5. Seeded Lambertian diffuse reflection with explicit depolarization — implemented.
6. Scattered-path selection and stray-light power summaries — implemented.
7. Wavelength / object-angle sweep studies with exports — implemented.
8. Ray-count convergence studies and expanded analytical checks — implemented.

Scope: lossless real-index films (coherent within each film stack, incoherent between traced branches), phenomenological bulk attenuation, custom data interpolated only inside their supplied band, and an ideal Lambertian reflector. No vendor coating claims, metal films, measured BSDF, volume scattering, CAD or whole-bench interference. Cancellation must not present partial studies as complete.

Implementation complete. All 250 automated tests pass, including 31 non-sequential physics/UI checks. JavaScript syntax checks pass. The app exposes twelve analytical reference checks. Sources and explicit model limits are documented in README.
