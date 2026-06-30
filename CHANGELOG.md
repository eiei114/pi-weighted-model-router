# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.4.1] - 2026-06-30

### Changed

- Align README with Pi OSS minimal-docs policy: add Quick start, Package contents, Release, Links, and License sections.
- Move detailed configuration and command docs to `docs/usage.md`.
- Add `docs/release.md` for maintainer release workflow.

## [0.4.0] - 2026-06-08

### Added

- Colon flat Pi commands for model-router actions (`/model-router:status`, `/model-router:next`, `/model-router:configure`) while keeping legacy `/model-router` space dispatch for one release.

## [0.3.2] - 2026-06-07

### Added

- Add `SECURITY.md` with vulnerability reporting instructions.
- Link Security section in README.

## [0.3.1] - 2026-06-06

### Fixed

- `ci.yml`: downgraded `actions/checkout@v6` / `actions/setup-node@v6` → `@v4` (v6 does not exist).
- `ci.yml`: added `branches: [main]` filter to `pull_request` trigger.
- `auto-release.yml`: replaced pinned SHA with `actions/checkout@v4`.
- `publish.yml`: replaced pinned SHAs with `@v4`, fixed concurrency key to include `inputs.ref`.

## 0.3.0 - 2026-05-31

- Define a session boundary policy that restores on `startup`/`resume` and reselects on `new`/`reload`/`fork` by default.
- Add `/model-router next` to reselect a weighted model without starting a new session.
- Record boundary reasons (for example `next` or `config`) in status output.
- Clarify manual model overrides: manual `/model` picks persist until the next router boundary.
