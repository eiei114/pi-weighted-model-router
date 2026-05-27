import { LEDGER_VERSION, type PoolLedger, type RouterLedger } from "./types.js";

export function emptyLedger(): RouterLedger {
  return {
    version: LEDGER_VERSION,
    days: {},
  };
}

export function validateLedgerShape(value: unknown): RouterLedger {
  if (!isRecord(value) || value.version !== LEDGER_VERSION || !isRecord(value.days)) return emptyLedger();

  const ledger = emptyLedger();
  for (const [day, dayValue] of Object.entries(value.days)) {
    if (!isRecord(dayValue) || !isRecord(dayValue.pools)) continue;
    ledger.days[day] = { pools: {} };
    for (const [pool, poolValue] of Object.entries(dayValue.pools)) {
      if (!isRecord(poolValue)) continue;
      ledger.days[day].pools[pool] = {
        success: readCounts(poolValue.success),
        failure: readCounts(poolValue.failure),
      };
    }
  }

  return ledger;
}

export function getPoolLedger(ledger: RouterLedger, date: string, pool: string): PoolLedger {
  ledger.days[date] ??= { pools: {} };
  ledger.days[date].pools[pool] ??= { success: {}, failure: {} };
  return ledger.days[date].pools[pool];
}

export function recordSuccess(ledger: RouterLedger, date: string, pool: string, key: string): RouterLedger {
  const next = structuredClone(ledger);
  const poolLedger = getPoolLedger(next, date, pool);
  poolLedger.success[key] = (poolLedger.success[key] ?? 0) + 1;
  return next;
}

export function successCounts(ledger: RouterLedger, date: string, pool: string): Record<string, number> {
  return { ...(ledger.days[date]?.pools[pool]?.success ?? {}) };
}

function readCounts(value: unknown): Record<string, number> {
  if (!isRecord(value)) return {};
  const counts: Record<string, number> = {};
  for (const [key, count] of Object.entries(value)) {
    if (typeof count === "number" && Number.isInteger(count) && count >= 0) counts[key] = count;
  }
  return counts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
