import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import weightedModelRouter from "../src/index.js";
import { todayKey } from "../src/keys.js";
import { successCounts } from "../src/ledger.js";
import { readLedger, routerPaths, writeConfig } from "../src/storage.js";
import type { ModelPoolEntry, RouterConfig, SelectedModel, SessionStartReason } from "../src/types.js";

const SELECTION_ENTRY = "weighted-model-router-selection";

test("session_start reload ignores stored entry and reselects", async () => {
  await withHarness(async ({ handlers, ctx, setModels, appended, notifications, statuses }) => {
    await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);

    assert.deepEqual(setModels, ["openai-codex/gpt-5.5"]);
    assert.equal(appended.length, 1);
    assert.equal(appended[0].customType, SELECTION_ENTRY);
    assert.equal(appended[0].data.reason, "reload");
    assert.equal(appended[0].data.ledgerCommitted, false);
    assert.deepEqual(notifications, ["Model router: reload \u2192 openai-codex/gpt-5.5 (was stored/model)"]);
    assert.deepEqual(statuses.at(-1), { key: "model-router", value: "router:main openai-codex/gpt-5.5 [reload]" });
  });
});

test("status includes boundary reason and previous model", async () => {
  await withHarness(async ({ handlers, tools, ctx }) => {
    await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);

    const result = await tools.model_router_config.execute("tool-call", { action: "status" }, undefined, undefined, ctx);
    const status = result.content[0].text;

    assert.match(status, /^boundary: reload$/m);
    assert.match(status, /^previous: stored\/model$/m);
  });
});

test("session_start resume restores stored entry", async () => {
  await withHarness(async ({ handlers, ctx, setModels, appended, statuses }) => {
    await handlers.session_start({ type: "session_start", reason: "resume" }, ctx);

    assert.deepEqual(setModels, ["stored/model"]);
    assert.equal(appended.length, 0);
    assert.deepEqual(statuses.at(-1), { key: "model-router", value: "router:main stored/model [resume]" });
  });
});

test("reselect failure preserves current selection and status", async () => {
  await withHarness(async ({ handlers, tools, ctx, controls, statuses }) => {
    await handlers.session_start({ type: "session_start", reason: "resume" }, ctx);
    controls.setModelSuccess = false;

    await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);

    assert.deepEqual(statuses.at(-1), { key: "model-router", value: "router:main stored/model [resume]" });

    const result = await tools.model_router_config.execute("tool-call", { action: "status" }, undefined, undefined, ctx);
    const status = result.content[0].text;
    assert.match(status, /^model: stored\/model$/m);
    assert.match(status, /^boundary: resume$/m);
  });
});

test("reselect abandons uncommitted old selection and commits only after first success", async () => {
  await withHarness(async ({ handlers, ctx, paths, appended }) => {
    await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);

    let ledger = await readLedger(paths.ledger);
    assert.deepEqual(successCounts(ledger, todayKey(), "main"), {});
    assert.equal(appended[0].data.ledgerCommitted, false);

    await handlers.after_provider_response({ type: "after_provider_response", status: 200, headers: {} }, ctx);

    ledger = await readLedger(paths.ledger);
    assert.deepEqual(successCounts(ledger, todayKey(), "main"), { "openai-codex/gpt-5.5": 1 });
    assert.equal(appended.length, 2);
    assert.equal(appended[1].data.ledgerCommitted, true);

    await handlers.after_provider_response({ type: "after_provider_response", status: 200, headers: {} }, ctx);
    ledger = await readLedger(paths.ledger);
    assert.deepEqual(successCounts(ledger, todayKey(), "main"), { "openai-codex/gpt-5.5": 1 });
  });
});

test("session_shutdown clears selected model and session-scoped status", async () => {
  await withHarness(async ({ handlers, tools, ctx, statuses }) => {
    await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    await handlers.session_shutdown({ type: "session_shutdown" }, ctx);

    assert.deepEqual(statuses.at(-1), { key: "model-router", value: undefined });

    const result = await tools.model_router_config.execute("tool-call", { action: "status" }, undefined, undefined, ctx);
    const status = result.content[0].text;
    assert.match(status, /^model: \(none\)$/m);
    assert.match(status, /^boundary: \(none\)$/m);
    assert.match(status, /^previous: \(none\)$/m);
  });
});

test("config save reselects with config reason", async () => {
  await withHarness(async ({ handlers, tools, ctx, appended, notifications, statuses, config }) => {
    ctx.hasUI = true;

    await handlers.session_start({ type: "session_start", reason: "reload" }, ctx);
    const result = await tools.model_router_config.execute(
      "tool-call",
      { action: "save", configJson: JSON.stringify(config) },
      undefined,
      undefined,
      ctx,
    );

    assert.equal(result.content[0].text, "Config saved.");
    assert.equal(appended.at(-1)?.data.reason, "config");
    assert.deepEqual(statuses.at(-1), { key: "model-router", value: "router:main openai-codex/gpt-5.5 [config]" });
    assert.equal(notifications.at(-1), "Model router: config \u2192 openai-codex/gpt-5.5 (was openai-codex/gpt-5.5)");
  });
});

async function withHarness(
  run: (harness: Awaited<ReturnType<typeof createHarness>>) => Promise<void>,
): Promise<void> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-router-test-"));
  try {
    const harness = await createHarness(cwd);
    await run(harness);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function createHarness(cwd: string) {
  await mkdir(join(cwd, ".pi"), { recursive: true });
  await writeJson(join(cwd, ".pi", "settings.json"), { packages: ["pi-weighted-model-router"] });

  const paths = routerPaths(join(cwd, ".pi"));
  const entry: ModelPoolEntry = { provider: "openai-codex", model: "gpt-5.5", weight: 1 };
  const config: RouterConfig = {
    version: 1,
    defaultPool: "main",
    pools: { main: { entries: [entry] } },
  };
  await writeConfig(paths.config, config);

  const storedSelection: SelectedModel = {
    pool: "main",
    provider: "stored",
    model: "model",
    key: "stored/model",
    reason: "initial",
    selectedAt: "2026-05-29T00:00:00.000Z",
    attemptedKeys: ["stored/model"],
    ledgerCommitted: false,
  };

  const sessionEntries: Array<{ type: string; customType: string; data: unknown }> = [
    { type: "custom", customType: SELECTION_ENTRY, data: storedSelection },
  ];
  const setModels: string[] = [];
  const appended: Array<{ customType: string; data: SelectedModel }> = [];
  const handlers: Partial<Record<string, (event: any, ctx: any) => Promise<void> | void>> = {};
  const tools: Record<string, any> = {};
  const notifications: string[] = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
  const controls = { setModelSuccess: true };

  const models = [
    { provider: "stored", id: "model", input: [] },
    { provider: "openai-codex", id: "gpt-5.5", input: [] },
  ];

  const pi = {
    on(event: string, handler: (event: any, ctx: any) => Promise<void> | void) {
      handlers[event] = handler;
    },
    async setModel(model: { provider: string; id: string }) {
      setModels.push(`${model.provider}/${model.id}`);
      return controls.setModelSuccess;
    },
    appendEntry(customType: string, data: SelectedModel) {
      appended.push({ customType, data });
      sessionEntries.push({ type: "custom", customType, data });
    },
    registerCommand() {},
    registerTool(tool: { name: string }) {
      tools[tool.name] = tool;
    },
    sendUserMessage() {},
  };

  const ctx = {
    cwd,
    hasUI: false,
    ui: {
      notify(message: string) {
        notifications.push(message);
      },
      setStatus(key: string, value: string | undefined) {
        statuses.push({ key, value });
      },
      async select() {
        return undefined;
      },
      async confirm() {
        return true;
      },
    },
    sessionManager: {
      getEntries() {
        return [...sessionEntries];
      },
    },
    modelRegistry: {
      find(provider: string, model: string) {
        return models.find((registered) => registered.provider === provider && registered.id === model);
      },
      getAll() {
        return models;
      },
    },
    model: undefined,
    isIdle() {
      return true;
    },
    signal: undefined,
    abort() {},
    hasPendingMessages() {
      return false;
    },
    shutdown() {},
    getContextUsage() {
      return undefined;
    },
    compact() {},
    getSystemPrompt() {
      return "";
    },
  };

  weightedModelRouter(pi as never);

  return {
    handlers: handlers as {
      session_start: (event: { type: "session_start"; reason: SessionStartReason }, ctx: any) => Promise<void>;
      session_shutdown: (event: { type: "session_shutdown" }, ctx: any) => Promise<void> | void;
      after_provider_response: (event: { type: "after_provider_response"; status: number; headers: Record<string, string> }, ctx: any) => Promise<void>;
    },
    ctx,
    paths,
    config,
    setModels,
    appended,
    tools,
    notifications,
    statuses,
    controls,
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const { writeFile } = await import("node:fs/promises");
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
