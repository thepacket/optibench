# Non-sequential physics foundation — eight iterations

## Scope and decisions
A separate geometrical-optics workspace, integrated with bench snapshots. True 3D rays, finite surfaces, dielectric volumes and repeated nearest encounters. Polarization transported in global complex transverse vectors. Branch powers add incoherently; this solver does not predict fringes. Preserve existing Gaussian and wave solvers.

1. 3D surface/ray geometry — implemented.
2. Nearest intersections and repeated encounters — implemented.
3. Reflected/transmitted branches — implemented.
4. Dispersive material index — implemented.
5. Fresnel polarization and total internal reflection — implemented.
6. Detector irradiance and terminal power accounting — implemented.
7. Path filtering and ghost inspection — implemented.
8. App/bench integration and analytical benchmarks — implemented.

## Model boundaries
- Closed, non-overlapping dielectric spheres, rectangular plates and symmetric biconvex lenses in unit-index ambient.
- Planar ideal mirrors, splitters, absorbers and detectors.
- No CAD, scattering, interference, thin-film stacks, absorption within glass, or vendor surface prescriptions inferred from focal length.
- Explicit user-controlled parametric model for bench lenses; unsupported optics block tracing until resolved or explicitly removed.
- Finite branching budgets retain untraced power as a separate unresolved category.

## Next action
All eight foundation iterations are implemented in ray3-geometry/fresnel/materials and nonsequential core/UI/worker/view/benchmarks modules. Bench access is **Ray optics**. Baseline: main 0c5df17, 219 tests.

- 18 focused tests passed; the full suite passed all 237 tests. Eight in-app analytical reference checks passed. Syntax, whitespace and static module-reference checks passed.
- Added explicit rejection for coincident nearest encounters and malformed notes during review.
- Implementation and validation are complete. Release sequence: commit/push the exact source and publish using Sites to the existing public audience.
- No browser interaction/visual QA was requested; the local preview was served and opened.
- Existing Gaussian/interference solvers are preserved; this work does not claim CAD, scattering, vendor prescriptions or coherent interference.
