import type { ModelPoolEntry } from "./types.js";

export function modelKey(entry: Pick<ModelPoolEntry, "provider" | "model">): string {
  return `${entry.provider}/${entry.model}`;
}

export function todayKey(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function seededJitter(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
