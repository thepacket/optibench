# Contributing to OptiBench

OptiBench is a small, free experimental photonics lab. Focused bug fixes, clear documentation and reproducible physics checks are welcome. Maintenance and review depend on available time; there is no guaranteed support schedule.

## Reports and questions

Use [Issues](https://github.com/thepacket/optibench/issues) for reproducible bugs and [Discussions](https://github.com/thepacket/optibench/discussions) for questions, experiment ideas and proposed features. Search existing reports first.

Include the workspace, browser/device, steps, expected result and observed result. For numerical discrepancies, include units, wavelength, geometry, sampling settings and the analytical reference or expected equation. A small, non-confidential exported setup helps. Remove personal data and proprietary measurements before posting: issues and discussions are public.

The app can prepare a downloadable problem report from its About dialog. Paste that report into an issue; downloading it does not submit it automatically.

## Development

Use Node.js 22 or later, npm and Python 3. Run `npm ci`, then `npm start` to serve the app at http://localhost:5173. Source files in `dist/` are authored directly; no bundling step is required.

Before a pull request, run `npm run check` and `npm test`. Add targeted tests for changed behavior or physics, including model limits and conservation/convergence checks when relevant. Keep simulation assumptions and measurement provenance explicit. Avoid presenting simulated outputs as calibrated laboratory measurements.

Describe the problem, resulting behavior and checks performed. Discuss substantial new physics or architecture in Discussions before investing in a large change. Do not change the original Sites deployment identifier for a contribution; use your own hosting configuration for a fork.

Contributions are provided under the repository's [MIT License](LICENSE). Preserve source attribution and third-party notices. Never commit credentials, private experiment data or dependency directories.
