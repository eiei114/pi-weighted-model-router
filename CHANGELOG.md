# Changelog

## 0.3.0 - 2026-05-31

- Define a session boundary policy that restores on `startup`/`resume` and reselects on `new`/`reload`/`fork` by default.
- Add `/model-router next` to reselect a weighted model without starting a new session.
- Record boundary reasons (for example `next` or `config`) in status output.
- Clarify manual model overrides: manual `/model` picks persist until the next router boundary.
