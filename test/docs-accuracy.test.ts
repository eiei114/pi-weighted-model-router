import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { defaultConfig } from "../src/config.js";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageVersion = JSON.parse(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
).version as string;
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const usageDoc = readFileSync(join(repoRoot, "docs/usage.md"), "utf8");
const changelog = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");

test("README version pin matches package.json", () => {
  const pin = `pi install npm:pi-weighted-model-router@${packageVersion}`;
  assert.match(
    readme,
    new RegExp(pin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    `README should document the current npm pin: ${pin}`,
  );
});

test("CHANGELOG documents the current package version", () => {
  assert.match(
    changelog,
    new RegExp(`^## \\[${packageVersion.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]`, "m"),
    `CHANGELOG should include a release section for ${packageVersion}`,
  );
});

test("usage example entries match default config placeholders", () => {
  const entries = defaultConfig().pools.main.entries;
  for (const entry of entries) {
    assert.match(
      usageDoc,
      new RegExp(`"provider": "${entry.provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
      `docs/usage.md should document the default placeholder provider "${entry.provider}"`,
    );
    if (entry.label) {
      assert.match(
        usageDoc,
        new RegExp(`"label": "${entry.label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`),
        `docs/usage.md should document the default placeholder label "${entry.label}"`,
      );
    }
  }
  assert.doesNotMatch(
    usageDoc,
    /another-provider/,
    "docs/usage.md should not reference stale provider id another-provider",
  );
  assert.doesNotMatch(
    usageDoc,
    /Primary GPT-5\.5|Secondary GPT-5\.5/,
    "docs/usage.md should not reference stale primary/secondary example labels",
  );
});

test("legacy command docs do not claim a one-release support window", () => {
  for (const [label, doc] of [
    ["README.md", readme],
    ["docs/usage.md", usageDoc],
    ["CHANGELOG.md", changelog],
  ] as const) {
    assert.doesNotMatch(
      doc,
      /for one release/i,
      `${label} should not describe legacy commands as limited to one release`,
    );
  }

  for (const [label, doc] of [
    ["README.md", readme],
    ["docs/usage.md", usageDoc],
  ] as const) {
    assert.match(
      doc,
      /Legacy `\/model-router`[\s\S]*?`\/model-router next`[\s\S]*?deprecated aliases/i,
      `${label} should identify both legacy commands as deprecated aliases`,
    );
  }
});

test("CHANGELOG keeps preamble above Unreleased", () => {
  const unreleasedIndex = changelog.indexOf("## Unreleased");
  assert.ok(unreleasedIndex >= 0, "CHANGELOG should include an Unreleased section");

  const preamble = changelog.slice(0, unreleasedIndex);
  assert.match(preamble, /Keep a Changelog/);
  assert.match(preamble, /Semantic Versioning/);

  const unreleasedBody = changelog
    .slice(unreleasedIndex)
    .replace(/^## Unreleased\s*/m, "")
    .split(/^## /m)[0]
    .trim();
  assert.equal(
    unreleasedBody,
    "",
    "Unreleased must stay empty until the next release notes land",
  );
});
