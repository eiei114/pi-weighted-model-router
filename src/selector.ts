import { modelKey, seededJitter } from "./keys.js";
import { successCounts } from "./ledger.js";
import type { ModelPoolEntry, RouterLedger, SelectionInput, SelectionResult } from "./types.js";

export function selectDailyBalanced(input: SelectionInput): SelectionResult {
  const ranked = rankDailyBalanced(input);
  const selected = ranked[0];
  if (!selected) throw new Error(`Pool "${input.poolName}" has no selectable entries.`);
  return selected;
}

export function rankDailyBalanced(input: SelectionInput): SelectionResult[] {
  const entries = input.entries.filter((entry) => entry.weight > 0);
  if (entries.length === 0) return [];

  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  const counts = successCounts(input.ledger, input.date, input.poolName);
  const totalSuccesses = entries.reduce((sum, entry) => sum + (counts[modelKey(entry)] ?? 0), 0);
  const nextTotal = totalSuccesses + 1;

  return entries
    .map((entry) => {
      const key = modelKey(entry);
      const targetAfterPick = (nextTotal * entry.weight) / totalWeight;
      const actual = counts[key] ?? 0;
      const deficit = targetAfterPick - actual;
      const jitter = seededJitter(`${input.date}:${input.poolName}:${key}`) / 1_000_000;
      return { entry, key, score: deficit + jitter };
    })
    .sort((left, right) => right.score - left.score || right.entry.weight - left.entry.weight || left.key.localeCompare(right.key));
}

export function withoutAttempted(entries: ModelPoolEntry[], attemptedKeys: string[]): ModelPoolEntry[] {
  const attempted = new Set(attemptedKeys);
  return entries.filter((entry) => !attempted.has(modelKey(entry)));
}
