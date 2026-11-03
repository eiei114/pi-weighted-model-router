import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { emptyLedger } from "../src/ledger.js";
import { readLedger, readState, writeLedger, writeState } from "../src/storage.js";
import { withReadFileFault } from "./helpers/read-file-fault.js";

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

test("readLedger returns an empty ledger when the ledger file does not exist yet", async () => {
  await withTempDir(async (dir) => {
    const loaded = await readLedger(join(dir, "ledger.json"));

    assert.deepEqual(loaded, emptyLedger());
  });
});

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
