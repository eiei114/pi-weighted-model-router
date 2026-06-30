# Usage

Detailed configuration, session boundaries, and command behavior for `pi-weighted-model-router`.

## Config paths

When this repository is loaded through its project-local `.pi/settings.json`, config is stored at:

```text
.pi/weighted-model-router/config.json
```

When installed globally, config is stored at:

```text
~/.pi/agent/weighted-model-router/config.json
```

## Example config

Replace provider and model IDs with entries that exist in your Pi model registry:

```json
{
  "version": 1,
  "defaultPool": "main",
  "strategy": "smooth-weighted-daily",
  "runtimeFallback": {
    "enabled": true,
    "statuses": [400, 429, 500, 502, 503, 504]
  },
  "sessionBoundary": {
    "restoreOn": ["startup", "resume"],
    "reselectOn": ["new", "reload", "fork"]
  },
  "pools": {
    "main": {
      "entries": [
        {
          "provider": "openai-codex",
          "model": "gpt-5.5",
          "weight": 7,
          "label": "Primary GPT-5.5"
        },
        {
          "provider": "cursor",
          "model": "gpt-5.5",
          "weight": 2,
          "label": "Secondary GPT-5.5"
        },
        {
          "provider": "another-provider",
          "model": "gpt-5.5",
          "weight": 1,
          "label": "Tertiary GPT-5.5"
        }
      ]
    }
  }
}
```

Provider and model IDs must exist in Pi's model registry. If a model is registered but lacks credentials, the router skips it during selection. Some providers can also return `400` when a registered model is temporarily unavailable, disabled for the account, or unsupported by the upstream backend; by default that response is treated as a runtime fallback signal. The sample values are placeholders, not endorsements or guarantees that a provider exposes a specific model name.

`sessionBoundary` is optional. Defaults restore the saved model for `startup` and `resume`, but reselect on `new`, `reload`, and `fork` even when the previous session contains a saved router selection.

## Session boundary behavior

The router decides whether to restore or reselect based on the session start reason. Defaults are:

| Session start reason | Default action | Notes |
| --- | --- | --- |
| `startup` | Restore | Attempts to reuse the saved router selection from the prior session. |
| `resume` | Restore | Continues the last session with the same router-selected model. |
| `new` | Reselect | Chooses a fresh weighted entry and records reason `new`. |
| `reload` | Reselect | Reloading the extension picks a new weighted entry. |
| `fork` | Reselect | Forked sessions can diverge from the parent selection. |

Manual boundaries that trigger a reselect without starting a new session:

| Trigger | Action | Notes |
| --- | --- | --- |
| `/model-router:next` | Reselect | Keeps the same session, excludes the previous selection, reason `next`. |
| Config save | Reselect | `model_router_config` save (or `/model-router:configure`) uses reason `config`. |
| Manual `/model` or Ctrl+P | Outside router | Manual picks persist until the next router boundary (`new`, `reload`, `fork`, `next`, `config`). |

## Manual model changes

Manual model selection through Pi (for example `/model` or the Ctrl+P model picker) is outside the router's control. The manual choice remains active until the next router boundary that reselects a model, such as `new`, `reload`, `fork`, `/model-router:next`, or a confirmed config save.

## Commands

### Guided setup

```text
/model-router:configure
```

The command sends a normal agent prompt that asks you about model candidates and desired weights one question at a time, then saves through `model_router_config` after confirmation.

You can also ask the agent in normal language:

```text
Configure the model router so my primary GPT-5.5 provider has weight 7, my secondary GPT-5.5 provider has weight 2, and my tertiary GPT-5.5 provider has weight 1.
```

The agent should call `model_router_config`, show the change, and ask for confirmation before saving.

### Status

```text
/model-router:status
```

Status includes current pool, current model, today's success counts, and config path.

### Reselect in session

```text
/model-router:next
```

The conversation history stays in the same session; the router appends a new `weighted-model-router-selection` entry with reason `next` and commits ledger usage only after the first successful provider response.

Legacy `/model-router` with a selection menu and `/model-router next` remain available for one release; prefer the colon commands above.

## Privacy

The README and examples use placeholder provider and model IDs. Do not publish local config files, API keys, account identifiers, or provider-specific contract details.

## Concurrency

Selection, ledger commit, and session-boundary handlers share in-memory state inside one extension instance. Overlapping async handlers can interleave unless serialized. See [RACE_CONDITIONS.md](RACE_CONDITIONS.md) for risks, mitigations, and follow-up ideas.
