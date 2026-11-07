import assert from "node:assert/strict";
import type * as FsPromises from "node:fs/promises";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import test from "node:test";
import { emptyLedger } from "../src/ledger.js";
import { readLedger, readState, writeLedger, writeState } from "../src/storage.js";
import { withReadFileFault } from "./helpers/read-file-fault.js";

const fsPromises = createRequire(import.meta.url)("node:fs/promises") as typeof FsPromises;
type FaultableOperation = "writeFile" | "rename";
type LooseAsyncFunction = (...args: unknown[]) => Promise<unknown>;

/**
 * Runs a storage assertion against a fresh temporary directory, then removes it.
 * Malformed router state files are user-editable, so reads must never leave files behind.
 */
async function withTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pi-router-storage-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readLedger honours a well-formed ledger file instead of resetting counts", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.json");
    const ledger = emptyLedger();
    ledger.days["2026-05-28"] = { pools: { main: { success: { "openai-codex/gpt-5.5": 7 }, failure: {} } } };
    await writeLedger(path, ledger);

    const loaded = await readLedger(path);

    assert.deepEqual(loaded.days["2026-05-28"].pools.main.success, { "openai-codex/gpt-5.5": 7 });
  });
});

test("readLedger degrades a truncated ledger file to an empty ledger instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.json");
    await writeFile(path, '{"version":1,"days":{"2026-05-28":{"pools":', "utf8");

    const loaded = await readLedger(path);

    assert.deepEqual(loaded, emptyLedger());
  });
});

test("readLedger degrades a non-JSON ledger file to an empty ledger instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.json");
    await writeFile(path, "not json at all", "utf8");

    const loaded = await readLedger(path);

    assert.deepEqual(loaded, emptyLedger());
  });
});

/**
 * Pins the other half of the degraded-read contract: valid JSON reaches
 * `validateLedgerShape` outside the parse catch, so shape rejection has to return the
 * empty ledger rather than throw. Widening the catch would hide a throwing validator.
 */
test("readLedger degrades a parseable but invalid ledger file to an empty ledger", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.json");
    await writeFile(path, '{"version":1,"days":null}', "utf8");

    const loaded = await readLedger(path);

    assert.deepEqual(loaded, emptyLedger());
  });
});

test("readLedger returns an empty ledger when the ledger file does not exist yet", async () => {
  await withTempDir(async (dir) => {
    const loaded = await readLedger(join(dir, "ledger.json"));

    assert.deepEqual(loaded, emptyLedger());
  });
});

test("writeLedger leaves the previous ledger readable when a temporary write is interrupted", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "ledger.json");
    const previous = emptyLedger();
    previous.days["2026-05-28"] = { pools: { main: { success: { model: 7 }, failure: {} } } };
    const next = emptyLedger();
    next.days["2026-05-28"] = { pools: { main: { success: { model: 8 }, failure: {} } } };
    await writeLedger(path, previous);

    let interrupted = false;
    await withPatchedFsOperation("writeFile", (original) => async (...args) => {
      const file = args[0];
      if (typeof file === "string" && dirname(file) === dir && basename(file).startsWith(".ledger.json.")) {
        interrupted = true;
        await original(file, '{"version":1,"days":', "utf8");
        throw createFsFault("EIO", file, "writeFile");
      }
      return original(...args);
    }, async () => {
      await assert.rejects(writeLedger(path, next), (error: NodeJS.ErrnoException) => error.code === "EIO");
    });

    assert.equal(interrupted, true, "the temporary-file write fault should be injected");
    assert.deepEqual(await readLedger(path), previous);
  });
});

for (const code of ["EPERM", "EBUSY"]) {
  test(`writeLedger preserves the existing file when rename keeps failing with ${code}`, async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "ledger.json");
      const previous = emptyLedger();
      previous.days["2026-05-28"] = { pools: { main: { success: { model: 7 }, failure: {} } } };
      const next = emptyLedger();
      next.days["2026-05-28"] = { pools: { main: { success: { model: 8 }, failure: {} } } };
      await writeLedger(path, previous);

      let renameAttempts = 0;
      await withPatchedFsOperation("rename", (original) => async (...args) => {
        if (args[1] === path) {
          renameAttempts += 1;
          throw createFsFault(code, String(args[0]), "rename");
        }
        return original(...args);
      }, async () => {
        await assert.rejects(writeLedger(path, next), (error: NodeJS.ErrnoException) => error.code === code);
      });

      assert.equal(renameAttempts, 4, "rename should make one initial attempt and three bounded retries");
      assert.deepEqual(await readLedger(path), previous);
    });
  });
}

/**
 * Guards the finder-visible data-loss path: an intact ledger whose read fails must not be
 * reported as an empty ledger, because the next successful commit would then rewrite the
 * file from that empty baseline and drop every recorded count.
 */
for (const code of ["EACCES", "EIO", "EMFILE"]) {
  test(`readLedger propagates ${code} instead of reporting an intact ledger as empty`, async () => {
    await withTempDir(async (dir) => {
      const path = join(dir, "ledger.json");
      const ledger = emptyLedger();
      ledger.days["2026-05-28"] = { pools: { main: { success: { "openai-codex/gpt-5.5": 7 }, failure: {} } } };
      await writeLedger(path, ledger);

      await assert.rejects(
        withReadFileFault(path, code, () => readLedger(path)),
        (error: NodeJS.ErrnoException) => error.code === code,
      );
    });
  });
}

test("readState propagates an I/O read error instead of reporting default state", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "state.json");
    await writeState(path, { version: 1, configMissingNoticeShown: true });

    await assert.rejects(
      withReadFileFault(path, "EACCES", () => readState(path)),
      (error: NodeJS.ErrnoException) => error.code === "EACCES",
    );
  });
});

test("readState honours a written state file", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "state.json");
    await writeState(path, { version: 1, configMissingNoticeShown: true });

    assert.deepEqual(await readState(path), { version: 1, configMissingNoticeShown: true });
  });
});

test("readState degrades a malformed state file to the default state instead of throwing", async () => {
  await withTempDir(async (dir) => {
    const path = join(dir, "state.json");
    await writeFile(path, '{"version":1,', "utf8");

    assert.deepEqual(await readState(path), { version: 1 });
  });
});

async function withPatchedFsOperation<T>(
  operation: FaultableOperation,
  patch: (original: LooseAsyncFunction) => LooseAsyncFunction,
  run: () => Promise<T>,
): Promise<T> {
  const operations = fsPromises as unknown as Record<FaultableOperation, LooseAsyncFunction>;
  const original = operations[operation];
  operations[operation] = patch(original);
  syncBuiltinESMExports();
  try {
    return await run();
  } finally {
    operations[operation] = original;
    syncBuiltinESMExports();
  }
}

function createFsFault(code: string, path: string, syscall: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: injected ${syscall} failure for '${path}'`) as NodeJS.ErrnoException;
  error.code = code;
  error.syscall = syscall;
  error.path = path;
  return error;
}
