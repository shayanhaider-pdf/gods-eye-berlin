# Complete original engine

The GitHub repository includes the complete original engine as the pinned Git submodule `vendor/gods-eye-view`, at commit `3d25a284f9186dcc936c26e0c4f745337b402e37`. GitHub opens that exact source when you click the submodule. The upstream MIT notice and dataset exceptions are retained in `docs/licenses/gods-eye-view-LICENSE.txt`.

The public Berlin site uses the existing MapLibre / Worker application, extended with world data and mission tools. It does **not** claim the entire Cesium / Node engine is running on that site. See `UPSTREAM-PARITY.md` for exact coverage.

To run the complete engine on a computer with Node 24.14+ (below 25), or Node 26.x, as required by the pinned upstream package:

```sh
git clone --recurse-submodules https://github.com/shayanhaider-pdf/gods-eye-berlin.git
cd gods-eye-berlin/vendor/gods-eye-view
npm ci
npm run dev
```

For an existing clone, run `git submodule update --init --depth 1 vendor/gods-eye-view` first. The original starts locally without API keys. Configure optional providers in its own Provider Settings. Its persistent Node provider backend, WebSockets, media sessions, local hardware integrations and keys are separate requirements from the public Berlin Worker. Do not expose a locally configured key broker publicly without the upstream hosting protections.

The full engine includes the original source's features and supported providers, including its 96-entry Data Library, Cesium rendering, procedural model fleet, AI/voice integrations, advanced scenes and imports. Availability still depends on provider credentials, geography, terms and supported runtime. The public app's source and its deployed behavior are recorded separately.
