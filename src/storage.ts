import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { validateConfigShape } from "./config.js";
import { isRecord } from "./guards.js";
import { emptyLedger, validateLedgerShape } from "./ledger.js";
import { CONFIG_VERSION, LEDGER_VERSION, type RouterConfig, type RouterLedger, type RouterPaths, type RouterState } from "./types.js";

export function routerPaths(agentDir: string): RouterPaths {
  const dir = join(agentDir, "weighted-model-router");
  return {
    dir,
    config: join(dir, "config.json"),
    ledger: join(dir, "ledger.json"),
    state: join(dir, "state.json"),
  };
}

export async function readConfig(path: string): Promise<RouterConfig | undefined> {
  const json = await readJsonIfExists(path);
  if (json === undefined) return undefined;
  return validateConfigShape(json);
}

export async function writeConfig(path: string, config: RouterConfig): Promise<void> {
  await writeJson(path, validateConfigShape(config));
}

export async function readLedger(path: string): Promise<RouterLedger> {
  const json = await readResilientJson(path);
  return json === undefined ? emptyLedger() : validateLedgerShape(json);
}

export async function writeLedger(path: string, ledger: RouterLedger): Promise<void> {
  await writeJson(path, { ...ledger, version: LEDGER_VERSION });
}

export async function readState(path: string): Promise<RouterState> {
  const json = await readResilientJson(path);
  if (!isRecord(json) || json.version !== 1) return { version: CONFIG_VERSION };
  return {
    version: 1,
    configMissingNoticeShown: typeof json.configMissingNoticeShown === "boolean" ? json.configMissingNoticeShown : undefined,
  };
}

export async function writeState(path: string, state: RouterState): Promise<void> {
  await writeJson(path, state);
}

async function readJsonIfExists(path: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") return undefined;
    throw error;
  }
}

/**
 * Reads derived router state that must survive a damaged file, but not a failing disk.
 *
 * `config.json` is user-authored, so a parse failure there is surfaced as a config warning.
 * `ledger.json` and `state.json` are router-written counters: a truncated or hand-edited
 * file (a JSON `SyntaxError`) degrades to the caller's default and is rewritten on the next
 * save, so one damaged file cannot abort session start or a provider fallback.
 *
 * Filesystem errors are deliberately rethrown. Reporting an intact ledger as empty because
 * its read failed would let the next successful commit rewrite the file from that empty
 * baseline, silently deleting every recorded count. `ENOENT` is not seen here: the
 * lower-level helper already maps a missing file to `undefined`.
 */
async function readResilientJson(path: string): Promise<unknown | undefined> {
  try {
    return await readJsonIfExists(path);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
