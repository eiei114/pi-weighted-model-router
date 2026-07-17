# pi-weighted-model-router

[![CI](https://github.com/eiei114/pi-weighted-model-router/actions/workflows/ci.yml/badge.svg)](https://github.com/eiei114/pi-weighted-model-router/actions/workflows/ci.yml)
[![Publish](https://github.com/eiei114/pi-weighted-model-router/actions/workflows/publish.yml/badge.svg)](https://github.com/eiei114/pi-weighted-model-router/actions/workflows/publish.yml)
[![npm version](https://img.shields.io/npm/v/pi-weighted-model-router)](https://www.npmjs.com/package/pi-weighted-model-router)
[![npm downloads](https://img.shields.io/npm/dw/pi-weighted-model-router)](https://www.npmjs.com/package/pi-weighted-model-router)
[![License: MIT](https://img.shields.io/github/license/eiei114/pi-weighted-model-router)](https://github.com/eiei114/pi-weighted-model-router/blob/main/LICENSE)
![Pi Package](https://img.shields.io/badge/Pi-Package-blue)
[![Trusted Publishing](https://img.shields.io/badge/npm-Trusted%20Publishing-blue.svg)](docs/release.md)
<a href="https://buymeacoffee.com/ekawano114m"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" width="217" height="60"></a>

> Pi extension that selects a model from weighted pools at session start, then keeps the session on that model unless a provider error or input capability requires fallback.

## What this is

`pi-weighted-model-router` balances model and provider usage across weighted pools in Pi. It picks one entry when a session starts, restores that choice on resume when configured, and falls back to another pool candidate on provider errors or unsupported image input.

## Features

- Daily balanced weighted selection so weights such as `7 / 2 / 1` stay close to the configured ratio across sessions in the same day.
- Session boundary policy: restore on `startup` and `resume`, reselect on `new`, `reload`, and `fork` by default.
- Runtime fallback on provider failure statuses such as `400`, `429`, `500`, `502`, `503`, and `504`.
- Image capability fallback before prompts when the selected model does not support image input.
- Tool `model_router_config` for agent-guided config updates after confirmation.
- Colon flat commands: `/model-router:status`, `/model-router:next`, and `/model-router:configure`.

## Install

From npm:

```bash
pi install npm:pi-weighted-model-router
```

Project-local install:

```bash
pi install -l npm:pi-weighted-model-router
```

Pin a specific version:

```bash
pi install npm:pi-weighted-model-router@0.4.2
```

From a local checkout:

```bash
pi install /absolute/path/to/pi-weighted-model-router
```

For temporary testing:

```bash
pi -e npm:pi-weighted-model-router
pi -e /absolute/path/to/pi-weighted-model-router
```

## Quick start

1. Install the package with one of the commands above.
2. Start Pi and run `/model-router:configure` for guided weight setup, or edit config directly (see [docs/usage.md](docs/usage.md)).
3. Check status with `/model-router:status`.

Config paths:

- Project-local (`.pi/settings.json`): `.pi/weighted-model-router/config.json`
- Global install: `~/.pi/agent/weighted-model-router/config.json`

For local development in this repository, `.pi/settings.json` loads the package from `../`. Start `pi` from the repo root and run `/reload` if a session is already open.

## Usage summary

| Command | Purpose |
| --- | --- |
| `/model-router:configure` | Guided setup through the agent and `model_router_config` |
| `/model-router:status` | Current pool, model, today's success counts, and config path |
| `/model-router:next` | Reselect within the same session without reload |

Legacy `/model-router` with a selection menu and `/model-router next` remain available for one release; prefer the colon commands above.

Configuration, session boundary tables, manual model overrides, and privacy notes are in [docs/usage.md](docs/usage.md). Concurrency assumptions and mitigations are in [docs/RACE_CONDITIONS.md](docs/RACE_CONDITIONS.md).

## Package contents

| Path | Purpose |
| --- | --- |
| `src/` | Extension entrypoint and routing logic |
| `docs/` | Usage, release, and concurrency decision docs |
| `README.md` | Public entrypoint (this file) |
| `SECURITY.md` | Vulnerability reporting |
| `LICENSE` | MIT license |
| `CHANGELOG.md` | Version history |

## Development

```bash
npm install
npm run check
```

The core selection, ledger, and config logic is testable without starting Pi.

## Release

This package uses npm Trusted Publishing with GitHub Actions OIDC — no `NPM_TOKEN` is required.

```bash
npm version patch
git push
```

On `main`, `.github/workflows/auto-release.yml` creates the `v<version>` tag and GitHub Release, then dispatches `.github/workflows/publish.yml` to publish to npm.

See [docs/release.md](docs/release.md) for setup details.

## Security

Pi packages can execute code with your local permissions. Review extensions before installing third-party packages.

For vulnerability reporting, see [`SECURITY.md`](SECURITY.md).

## Links

- npm: https://www.npmjs.com/package/pi-weighted-model-router
- GitHub: https://github.com/eiei114/pi-weighted-model-router
- Issues: https://github.com/eiei114/pi-weighted-model-router/issues

## License

MIT
