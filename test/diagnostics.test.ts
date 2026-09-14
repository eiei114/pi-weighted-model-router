import assert from "node:assert/strict";
import test from "node:test";
import { buildDiagnosticsWarnings, formatDiagnostics, resolveBoundaryPolicyIntent } from "../src/diagnostics.js";
import type { DiagnosticsSnapshot } from "../src/types.js";

test("resolveBoundaryPolicyIntent maps session start reasons to restore or reselect", () => {
  assert.deepEqual(resolveBoundaryPolicyIntent("startup"), {
    kind: "session-boundary",
    reason: "startup",
    policy: "restore",
  });
  assert.deepEqual(resolveBoundaryPolicyIntent("resume"), {
    kind: "session-boundary",
    reason: "resume",
    policy: "restore",
  });
  assert.deepEqual(resolveBoundaryPolicyIntent("reload"), {
    kind: "session-boundary",
    reason: "reload",
    policy: "reselect",
  });
});

test("resolveBoundaryPolicyIntent treats manual reasons as non-boundary", () => {
  assert.deepEqual(resolveBoundaryPolicyIntent("next"), { kind: "non-boundary", reason: "next" });
  assert.deepEqual(resolveBoundaryPolicyIntent(undefined), { kind: "none" });
});

test("formatDiagnostics renders compact restore output", () => {
  const snapshot: DiagnosticsSnapshot = {
    configPath: "/tmp/config.json",
    config: {
      version: 1,
      defaultPool: "main",
      pools: { main: { entries: [{ provider: "stored", model: "model", weight: 1 }] } },
    },
    selected: {
      pool: "main",
      provider: "stored",
      model: "model",
      key: "stored/model",
      reason: "initial",
      selectedAt: "2026-05-29T00:00:00.000Z",
      attemptedKeys: ["stored/model"],
      ledgerCommitted: false,
    },
    persisted: {
      pool: "main",
      provider: "stored",
      model: "model",
      key: "stored/model",
      reason: "initial",
      selectedAt: "2026-05-29T00:00:00.000Z",
      attemptedKeys: ["stored/model"],
      ledgerCommitted: false,
    },
    boundaryReason: "startup",
    warnings: [],
  };

  const output = formatDiagnostics(snapshot);
  assert.match(output, /^boundary reason: startup$/m);
  assert.match(output, /^policy intent: restore$/m);
  assert.match(output, /^active selection: stored\/model$/m);
  assert.match(output, /^persisted selection: stored\/model$/m);
  assert.match(output, /^warnings: \(none\)$/m);
});

test("formatDiagnostics renders missing-state warnings", () => {
  const snapshot: DiagnosticsSnapshot = {
    configPath: "/tmp/config.json",
    boundaryReason: "new",
    warnings: ["no persisted selection entry in session"],
  };

  const output = formatDiagnostics(snapshot);
  assert.match(output, /^policy intent: reselect$/m);
  assert.match(output, /^persisted selection: \(none\)$/m);
  assert.match(output, /^warning: no persisted selection entry in session$/m);
});

test("buildDiagnosticsWarnings flags missing config and persisted selection", () => {
  const ctx = {
    modelRegistry: {
      find() {
        return undefined;
      },
    },
  };

  const warnings = buildDiagnosticsWarnings(ctx as never, {});
  assert.deepEqual(warnings, ["config missing or unreadable", "no persisted selection entry in session"]);
});

test("buildDiagnosticsWarnings flags active and persisted mismatch", () => {
  const ctx = {
    modelRegistry: {
      find(provider: string, model: string) {
        return { provider, model, input: ["text"] };
      },
    },
  };
  const config = {
    version: 1 as const,
    defaultPool: "main",
    pools: {
      main: { entries: [{ provider: "openai-codex", model: "gpt-5.5", weight: 1 }] },
    },
  };
  const persisted = {
    pool: "main",
    provider: "openai-codex",
    model: "gpt-5.5",
    key: "openai-codex/gpt-5.5",
    reason: "reload" as const,
    selectedAt: "2026-05-29T00:00:00.000Z",
    attemptedKeys: ["openai-codex/gpt-5.5"],
    ledgerCommitted: false,
  };
  const selected = {
    ...persisted,
    provider: "cursor",
    model: "gpt-5.5",
    key: "cursor/gpt-5.5",
    reason: "next" as const,
  };

  const warnings = buildDiagnosticsWarnings(ctx as never, { config, selected, persisted });
  assert.deepEqual(warnings, [
    "persisted selection (openai-codex/gpt-5.5) differs from active selection (cursor/gpt-5.5)",
  ]);
});
