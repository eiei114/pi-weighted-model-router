import assert from "node:assert/strict";
import test from "node:test";
import { fallbackStatuses, validateConfigShape } from "../src/config.js";
import { emptyLedger, recordSuccess } from "../src/ledger.js";
import { modelKey } from "../src/keys.js";
import { selectDailyBalanced } from "../src/selector.js";
import type { ModelPoolEntry } from "../src/types.js";

const entries: ModelPoolEntry[] = [
  { provider: "openai-codex", model: "gpt-5.5", weight: 7 },
  { provider: "cursor", model: "gpt-5.5", weight: 2 },
  { provider: "fallback", model: "gpt-5.5", weight: 1 },
];

test("smooth daily selection converges to configured weights over ten sessions", () => {
  let ledger = emptyLedger();
  const date = "2026-05-28";
  const poolName = "main";

  for (let index = 0; index < 10; index += 1) {
    const result = selectDailyBalanced({ poolName, entries, ledger, date });
    ledger = recordSuccess(ledger, date, poolName, result.key);
  }

  assert.deepEqual(ledger.days[date].pools[poolName].success, {
    [modelKey(entries[0])]: 7,
    [modelKey(entries[1])]: 2,
    [modelKey(entries[2])]: 1,
  });
});

test("recording the first selection makes the next session prefer the next deficit", () => {
  let ledger = emptyLedger();
  const date = "2026-05-28";
  const poolName = "main";

  let result = selectDailyBalanced({ poolName, entries, ledger, date });
  assert.equal(result.key, modelKey(entries[0]));

  ledger = recordSuccess(ledger, date, poolName, result.key);
  result = selectDailyBalanced({ poolName, entries, ledger, date });

  assert.equal(result.key, modelKey(entries[1]));
});

test("config validation rejects duplicate models in the same pool", () => {
  assert.throws(
    () =>
      validateConfigShape({
        version: 1,
        defaultPool: "main",
        pools: {
          main: {
            entries: [
              { provider: "openai-codex", model: "gpt-5.5", weight: 7 },
              { provider: "openai-codex", model: "gpt-5.5", weight: 1 },
            ],
          },
        },
      }),
    /duplicate model/,
  );
});

test("config validation preserves named pools and fallback statuses", () => {
  const config = validateConfigShape({
    version: 1,
    defaultPool: "main",
    runtimeFallback: { enabled: true, statuses: [429, 503] },
    pools: {
      main: {
        entries: [{ provider: "openai-codex", model: "gpt-5.5", weight: 7 }],
      },
      research: {
        entries: [{ provider: "cursor", model: "gpt-5.5", weight: 1, label: "Cursor" }],
      },
    },
  });

  assert.equal(config.defaultPool, "main");
  assert.deepEqual(config.runtimeFallback?.statuses, [429, 503]);
  assert.equal(config.pools.research.entries[0].label, "Cursor");
});

test("default fallback statuses include provider model rejection", () => {
  const config = validateConfigShape({
    version: 1,
    defaultPool: "main",
    pools: {
      main: {
        entries: [{ provider: "openai-codex", model: "gpt-5.5", weight: 7 }],
      },
    },
  });

  assert.equal(fallbackStatuses(config).has(400), true);
});
