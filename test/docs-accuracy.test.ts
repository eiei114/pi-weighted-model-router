import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
).version as string;
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");

test("README version pin matches package.json", () => {
  const pin = `pi install npm:pi-weighted-model-router@${packageVersion}`;
  assert.match(
    readme,
    new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `README should document the current npm pin: ${pin}`,
  );
});
