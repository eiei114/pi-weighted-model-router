import { CONFIG_VERSION, type ModelPoolEntry, type RouterConfig } from "./types.js";
import { modelKey } from "./keys.js";

export const DEFAULT_FALLBACK_STATUSES = [429, 500, 502, 503, 504] as const;

export function defaultConfig(): RouterConfig {
  return {
    version: CONFIG_VERSION,
    defaultPool: "main",
    strategy: "smooth-weighted-daily",
    runtimeFallback: {
      enabled: true,
      statuses: [...DEFAULT_FALLBACK_STATUSES],
    },
    pools: {
      main: {
        entries: [
          { provider: "openai-codex", model: "gpt-5.5", weight: 7, label: "OpenAI Codex GPT-5.5" },
          { provider: "cursor", model: "gpt-5.5", weight: 2, label: "Cursor GPT-5.5" },
          { provider: "example-provider", model: "gpt-5.5", weight: 1, label: "Fallback GPT-5.5" },
        ],
      },
    },
  };
}

export function fallbackStatuses(config: RouterConfig): Set<number> {
  const configured = config.runtimeFallback?.statuses;
  return new Set(configured && configured.length > 0 ? configured : DEFAULT_FALLBACK_STATUSES);
}

export function runtimeFallbackEnabled(config: RouterConfig): boolean {
  return config.runtimeFallback?.enabled ?? true;
}

export function validateConfigShape(value: unknown): RouterConfig {
  if (!isRecord(value)) throw new Error("Config must be an object.");
  if (value.version !== CONFIG_VERSION) {
    throw new Error(`Unsupported config version: ${String(value.version)}.`);
  }
  if (typeof value.defaultPool !== "string" || value.defaultPool.trim() === "") {
    throw new Error("defaultPool must be a non-empty string.");
  }
  if (!isRecord(value.pools)) throw new Error("pools must be an object.");
  if (!Object.hasOwn(value.pools, value.defaultPool)) {
    throw new Error(`defaultPool "${value.defaultPool}" is not defined in pools.`);
  }

  const pools: RouterConfig["pools"] = {};
  for (const [poolName, poolValue] of Object.entries(value.pools)) {
    if (!isRecord(poolValue)) throw new Error(`Pool "${poolName}" must be an object.`);
    if (!Array.isArray(poolValue.entries)) throw new Error(`Pool "${poolName}" entries must be an array.`);
    if (poolValue.entries.length === 0) throw new Error(`Pool "${poolName}" must include at least one entry.`);

    const seen = new Set<string>();
    const entries: ModelPoolEntry[] = poolValue.entries.map((entryValue, index) => {
      if (!isRecord(entryValue)) throw new Error(`Pool "${poolName}" entry ${index} must be an object.`);
      const provider = readNonEmptyString(entryValue.provider, `Pool "${poolName}" entry ${index} provider`);
      const model = readNonEmptyString(entryValue.model, `Pool "${poolName}" entry ${index} model`);
      const weight = readPositiveNumber(entryValue.weight, `Pool "${poolName}" entry ${index} weight`);
      const entry: ModelPoolEntry = { provider, model, weight };
      if (typeof entryValue.label === "string" && entryValue.label.trim() !== "") entry.label = entryValue.label;

      const key = modelKey(entry);
      if (seen.has(key)) throw new Error(`Pool "${poolName}" contains duplicate model "${key}".`);
      seen.add(key);
      return entry;
    });

    pools[poolName] = { entries };
  }

  const config: RouterConfig = {
    version: CONFIG_VERSION,
    defaultPool: value.defaultPool,
    pools,
    strategy: value.strategy === "smooth-weighted-daily" ? value.strategy : "smooth-weighted-daily",
  };

  if (isRecord(value.runtimeFallback)) {
    config.runtimeFallback = {
      enabled: typeof value.runtimeFallback.enabled === "boolean" ? value.runtimeFallback.enabled : true,
      statuses: Array.isArray(value.runtimeFallback.statuses)
        ? value.runtimeFallback.statuses.map((status, index) =>
            readIntegerStatus(status, `runtimeFallback.statuses[${index}]`),
          )
        : [...DEFAULT_FALLBACK_STATUSES],
    };
  }

  return config;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} must be a non-empty string.`);
  return value;
}

function readPositiveNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive number.`);
  }
  return value;
}

function readIntegerStatus(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 100 || value > 599) {
    throw new Error(`${label} must be an HTTP status code.`);
  }
  return value;
}
