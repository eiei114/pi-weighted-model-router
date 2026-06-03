# Race conditions and concurrency

This document describes concurrency assumptions for `pi-weighted-model-router`, risks that were reviewed for [DOT-88](https://github.com/eiei114/pi-weighted-model-router/issues), and the minimal guard added in that work.

## Scope

| In scope | Out of scope |
| --- | --- |
| One Pi extension instance serving one active session | Multiple Pi processes sharing the same `ledger.json` |
| Overlapping async extension handlers in a single Node process | Distributed or multi-tab router coordination |
| In-memory `selected` / `ledger` / `config` updates | Provider network timeouts (handled as fallback, not data races) |

## Runtime model

The extension keeps mutable module-level state:

- `config`, `ledger`, `selected`, `previousModel`, `boundaryReason`, `requiredInputs`
- Session truth is also mirrored in custom session entries (`weighted-model-router-selection`)

Handlers that can touch selection state concurrently:

| Handler / entry point | Typical overlap |
| --- | --- |
| `session_start` | Runs while the first `before_agent_start` may already be queued |
| `before_agent_start` | Image capability fallback during prompt setup |
| `after_provider_response` | Ledger commit on success; fallback reselect on error status |
| `/model-router next` | Manual reselect while a response is in flight |
| `model_router_config` save | Config reload + reselect while other handlers run |

`selectDailyBalanced` and ledger helpers are pure functions; races come from unsynchronized read-modify-write on shared module state and non-atomic ledger file writes.

## Identified risks (before serialization)

1. **Lost or double ledger commits**  
   Two handlers could both see `ledgerCommitted === false`, both call `recordSuccess`, and both `writeLedger`, producing last-writer-wins counts.

2. **Stale `selected` after overlapping reselects**  
   `chooseAndSetModel` reads `ledger` and `selected` at start; a concurrent reselect could append a newer session entry while memory still pointed at an abandoned candidate.

3. **Inconsistent `attemptedKeys` on fallback**  
   Concurrent fallback paths could merge exclusions from different generations of `selected`.

4. **Session restore vs reselect**  
   `session_start` restore and `before_agent_start` initial selection could both call `pi.setModel` with different targets; the last completion won, not necessarily the intended boundary action.

5. **On-disk ledger (multi-process)**  
   `writeLedger` is read-modify-write without file locking. A second Pi agent using the same config directory could interleave writes. This extension does not address that; use one agent directory per process.

## Mitigation (DOT-88)

`src/selection-serializer.ts` exposes `runSerialized`, a promise-chain mutex that queues async work per extension instance.

Serialized entry points:

- `chooseAndSetModel`
- `commitLedgerIfPending`
- `session_start`, `before_agent_start`, `after_provider_response` handlers
- `/model-router` handler and `model_router_config` save path when reselecting

This preserves existing single-threaded semantics Pi expects without a larger state-machine refactor.

## Edge cases (documented behavior)

| Scenario | Expected behavior |
| --- | --- |
| Rapid `/model-router next` | Reselects run one at a time; each waits for the prior `pi.setModel` attempt to finish. |
| Session boundary + immediate prompt | `session_start` completes selection before `before_agent_start` capability check runs. |
| Success + fallback status racing | Commit and fallback reselect cannot interleave; commit runs first when both were triggered. |
| Network timeout on `pi.setModel` | Treated as failed candidate try inside `chooseAndSetModel`; no partial `selected` publish until success. |
| Uncommitted selection | Ledger count updates only after first successful provider response (`ledgerCommitted`). Documented in tests `reselect abandons uncommitted...`. |

## Follow-up issues (not in DOT-88)

Consider separate issues if requirements grow:

1. **Immutable session-scoped state object** — Replace module-level `let` bindings with a per-session store keyed by `ctx.sessionId` if Pi ever runs multiple sessions per extension instance.

2. **Atomic ledger persistence** — File lock or append-only event log if multiple processes must share one router directory.

3. **Explicit selection generation counter** — Reject stale async completions after a newer reselect starts (defense in depth beyond serialization).

4. **Provider timeout cancellation** — Abort in-flight `setModel` when a newer manual `next` is requested (UX, not ledger correctness).

## Verification

```bash
npm run check
```

Regression coverage includes session boundary, ledger commit deferral, and concurrent handler invocation tests in `test/session-start.test.ts`.
