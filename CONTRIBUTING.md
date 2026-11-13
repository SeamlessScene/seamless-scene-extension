# Contributing

Thanks for looking. This repository is **source-available, not open source** (see [LICENSE.md](LICENSE.md)), and it is published from a private repository at each release. That shapes how contributions work.

## Issues

Issues are the most useful contribution. Good ones say:

- the extension version (shown in the popup and on the settings page) and your Chrome version and OS;
- the streaming page you were on, and what you expected against what happened;
- if playback went wrong, the report from **Copy diagnostics** on the settings page's Advanced tab. It carries the build, the error state and the IDs of the title and edit involved, not your files or account.

Security problems go through [SECURITY.md](SECURITY.md), never a public issue.

## Pull requests

- Pull requests are welcome for small, focused fixes. Say in the description that you agree Open Creative Labs may use your contribution under the terms in [LICENSE.md](LICENSE.md); without that we cannot take it.
- An accepted change is applied to the private repository and reaches this one with the next release, so your pull request will be closed rather than merged, with a note naming the release that carries it.
- Run `npm test` and `npm run test:packet` first. A change to any file listed in `packages/browser-extension/vendor/protected/PROVENANCE.json` also needs `npm run build:protected` with esbuild 0.28.2; see [docs/building.md](docs/building.md). Never edit the generated bundle by hand.

## Style

- Plain ES modules for Chrome's Manifest V3, no framework and no transpiler.
- LF line endings and 2-space indentation (`.editorconfig`).
- Tests use `node:test`. A bug fix comes with a test that fails without it.
