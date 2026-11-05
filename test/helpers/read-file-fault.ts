import type * as FsPromises from "node:fs/promises";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { resolve } from "node:path";

const fsPromises = createRequire(import.meta.url)("node:fs/promises") as typeof FsPromises;

/**
 * Injects a filesystem read error for exactly one path while the file stays intact.
 *
 * A genuine `EACCES`/`EIO`/`EMFILE` cannot be produced portably from a test: Windows
 * ignores `chmod`, and pointing the path at a directory also breaks the following write,
 * which is the behaviour under test. So the fault is installed on `fs/promises.readFile`
 * for the target path only, and restored in `finally`.
 *
 * `src/storage.ts` imports `readFile` as an ESM named binding, so `syncBuiltinESMExports()`
 * is required for the injection to be visible to it. The injected path is also visible to
 * the caller's own helper calls, which keeps the "is the read really failing?" sanity
 * assertion honest.
 */
export async function withReadFileFault<T>(path: string, code: string, run: () => Promise<T>): Promise<T> {
  const target = resolve(path);
  const original = fsPromises.readFile;
  fsPromises.readFile = (async (file: unknown, ...rest: unknown[]) => {
    if (typeof file === "string" && resolve(file) === target) throw createReadFault(code, file);
    return (original as unknown as (...args: unknown[]) => Promise<unknown>)(file, ...rest);
  }) as unknown as typeof FsPromises.readFile;
  syncBuiltinESMExports();
  try {
    // Prove the injection reaches the same module instance `readLedger` imports from, so a
    // silently unpatched readFile cannot make the assertions below pass for the wrong reason.
    try {
      await fsPromises.readFile(target, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === code) return await run();
      throw error;
    }
    throw new Error(`readFile fault injection for ${target} did not take effect (expected ${code})`);
  } finally {
    fsPromises.readFile = original;
    syncBuiltinESMExports();
  }
}

/** Builds a Node-shaped errno error, so callers can assert on `error.code` like real fs failures. */
export function createReadFault(code: string, path: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: injected read failure, open '${path}'`) as NodeJS.ErrnoException;
  error.code = code;
  error.errno = -1;
  error.syscall = "open";
  error.path = path;
  return error;
}
