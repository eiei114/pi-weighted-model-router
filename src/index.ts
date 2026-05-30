import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { defaultConfig, fallbackStatuses, runtimeFallbackEnabled, validateConfigShape } from "./config.js";
import { modelKey, todayKey } from "./keys.js";
import { recordSuccess, successCounts } from "./ledger.js";
import { formatUnknownModelMessage } from "./model-suggestions.js";
import { rankDailyBalanced, withoutAttempted } from "./selector.js";
import { isSessionStartReason, resolveSessionBoundaryAction } from "./session-boundary.js";
import { readConfig, readLedger, readState, routerPaths, writeConfig, writeLedger, writeState } from "./storage.js";
import type {
  ModelPoolEntry,
  RouterBoundaryReason,
  RouterConfig,
  RouterLedger,
  RouterPaths,
  SelectedModel,
  SessionStartReason,
  StatusSnapshot,
} from "./types.js";

const SELECTION_ENTRY = "weighted-model-router-selection";
const STATUS_KEY = "model-router";
const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export default function weightedModelRouter(pi: ExtensionAPI) {
  let paths = routerPaths(getAgentDir());
  let config: RouterConfig | undefined;
  let ledger: RouterLedger | undefined;
  let selected: SelectedModel | undefined;
  let previousModel: SelectedModel | undefined;
  let boundaryReason: RouterBoundaryReason | undefined;
  let requiredInputs: string[] = [];

  function syncPaths(ctx: ExtensionContext): void {
    paths = shouldUseProjectLocalState(ctx) ? routerPaths(join(ctx.cwd, ".pi")) : routerPaths(getAgentDir());
  }

  function shouldUseProjectLocalState(ctx: ExtensionContext): boolean {
    const projectSettingsPath = join(ctx.cwd, ".pi", "settings.json");
    return existsSync(projectSettingsPath) && projectSettingsIncludesThisPackage(projectSettingsPath);
  }

  function projectSettingsIncludesThisPackage(projectSettingsPath: string): boolean {
    try {
      const settings = JSON.parse(readFileSync(projectSettingsPath, "utf8")) as unknown;
      if (!isRecord(settings) || !Array.isArray(settings.packages)) return false;
      return settings.packages.some((entry) => packageEntryMatchesThisPackage(entry, dirname(projectSettingsPath)));
    } catch {
      return false;
    }
  }

  function packageEntryMatchesThisPackage(entry: unknown, settingsDir: string): boolean {
    const source = typeof entry === "string" ? entry : isRecord(entry) && typeof entry.source === "string" ? entry.source : undefined;
    if (!source) return false;
    if (source.includes("pi-weighted-model-router")) return true;
    return resolve(settingsDir, source) === resolve(PACKAGE_ROOT);
  }

  async function loadConfig(ctx: ExtensionContext): Promise<RouterConfig | undefined> {
    try {
      syncPaths(ctx);
      config = await readConfig(paths.config);
      if (!config) await maybeNotifyMissingConfig(ctx, paths);
      return config;
    } catch (error) {
      ctx.ui.notify(`Model router config error: ${errorMessage(error)}`, "warning");
      return undefined;
    }
  }

  async function loadLedger(): Promise<RouterLedger> {
    ledger = await readLedger(paths.ledger);
    return ledger;
  }

  async function ensureRuntime(ctx: ExtensionContext): Promise<boolean> {
    const loadedConfig = config ?? (await loadConfig(ctx));
    if (!loadedConfig) return false;
    ledger ??= await loadLedger();
    return true;
  }

  async function maybeNotifyMissingConfig(ctx: ExtensionContext, routerPathsValue: RouterPaths): Promise<void> {
    const state = await readState(routerPathsValue.state);
    if (state.configMissingNoticeShown) return;

    ctx.ui.notify(
      `pi-weighted-model-router is not configured. Ask the agent to configure model router. Config: ${routerPathsValue.config}`,
      "info",
    );
    await writeState(routerPathsValue.state, { ...state, configMissingNoticeShown: true });
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (!selected) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      return;
    }

    const reason = boundaryReason ?? selected.reason;
    ctx.ui.setStatus(STATUS_KEY, `router:${selected.pool} ${formatModelName(selected)} [${reason}]`);
  }

  async function chooseAndSetModel(
    ctx: ExtensionContext,
    reason: SelectedModel["reason"],
    options: {
      excludeKeys?: string[];
      preserveLedgerCommit?: boolean;
      inputs?: string[];
      previousModel?: SelectedModel;
      notifyReselect?: boolean;
    } = {},
  ): Promise<SelectedModel | undefined> {
    if (!(await ensureRuntime(ctx)) || !config || !ledger) return undefined;

    const poolName = config.defaultPool;
    const pool = config.pools[poolName];
    if (!pool) {
      ctx.ui.notify(`Model router pool "${poolName}" does not exist.`, "warning");
      return undefined;
    }

    const inputs = options.inputs ?? requiredInputs;
    const excludeKeys = options.excludeKeys ?? [];
    const priorSelection = options.previousModel ?? selected;
    const candidates = withoutAttempted(filterRegisteredAndCapable(ctx, pool.entries, inputs), excludeKeys);
    const ranked = rankDailyBalanced({
      poolName,
      entries: candidates,
      ledger,
      date: todayKey(),
    });

    for (const candidate of ranked) {
      const model = ctx.modelRegistry.find(candidate.entry.provider, candidate.entry.model);
      if (!model) continue;

      const success = await pi.setModel(model);
      if (!success) continue;

      const attemptedKeys = [...new Set([...excludeKeys, candidate.key])];
      const ledgerCommitted = options.preserveLedgerCommit ?? false;
      selected = {
        pool: poolName,
        provider: candidate.entry.provider,
        model: candidate.entry.model,
        key: candidate.key,
        reason,
        selectedAt: new Date().toISOString(),
        attemptedKeys,
        ledgerCommitted,
      };
      previousModel = priorSelection;
      boundaryReason = reason;
      pi.appendEntry(SELECTION_ENTRY, selected);
      updateStatus(ctx);
      if (options.notifyReselect) notifyReselect(ctx, reason, priorSelection, selected);
      return selected;
    }

    ctx.ui.notify("Model router found no usable model in the selected pool.", "warning");
    return undefined;
  }

  function filterRegisteredAndCapable(ctx: ExtensionContext, entries: ModelPoolEntry[], inputs: string[]): ModelPoolEntry[] {
    return entries.filter((entry) => {
      const model = ctx.modelRegistry.find(entry.provider, entry.model);
      if (!model) return false;
      return inputs.every((input) => modelSupportsInput(model, input));
    });
  }

  function modelSupportsInput(model: unknown, input: string): boolean {
    const modelInput = (model as { input?: unknown }).input;
    return Array.isArray(modelInput) && modelInput.includes(input);
  }

  async function commitLedgerIfPending(ctx: ExtensionContext): Promise<void> {
    if (!selected || selected.ledgerCommitted || !ledger) return;

    ledger = recordSuccess(ledger, todayKey(), selected.pool, selected.key);
    await writeLedger(paths.ledger, ledger);
    selected = { ...selected, ledgerCommitted: true };
    pi.appendEntry(SELECTION_ENTRY, selected);
    updateStatus(ctx);
  }

  function restoreSelection(ctx: ExtensionContext): SelectedModel | undefined {
    const entries = ctx.sessionManager.getEntries() as Array<{ type?: string; customType?: string; data?: unknown }>;
    for (const entry of [...entries].reverse()) {
      if (entry.type !== "custom" || entry.customType !== SELECTION_ENTRY) continue;
      const parsed = parseSelectedModel(entry.data);
      if (parsed) return parsed;
    }
    return undefined;
  }

  function createStatusSnapshot(): StatusSnapshot {
    const pool = selected?.pool ?? config?.defaultPool;
    return {
      configPath: paths.config,
      pool,
      selected,
      boundaryReason,
      previousModel,
      today: todayKey(),
      counts: ledger && pool ? successCounts(ledger, todayKey(), pool) : {},
    };
  }

  function formatStatus(snapshot: StatusSnapshot): string {
    const model = snapshot.selected ? formatModelName(snapshot.selected) : "(none)";
    const previous = snapshot.previousModel ? formatModelName(snapshot.previousModel) : "(none)";
    const counts = Object.entries(snapshot.counts)
      .map(([key, count]) => `${key}=${count}`)
      .join(", ");
    return [
      `pool: ${snapshot.pool ?? "(none)"}`,
      `model: ${model}`,
      `boundary: ${snapshot.boundaryReason ?? "(none)"}`,
      `previous: ${previous}`,
      `today: ${snapshot.today}`,
      `counts: ${counts || "(none)"}`,
      `config: ${snapshot.configPath}`,
    ].join("\n");
  }

  pi.on("session_start", async (event, ctx) => {
    await loadConfig(ctx);
    await loadLedger();

    const reason = readSessionStartReason(event);
    const action = resolveSessionBoundaryAction(reason, config);

    if (action === "reselect") {
      const previous = selected ?? restoreSelection(ctx);
      await chooseAndSetModel(ctx, sessionReasonToSelectionReason(reason), {
        previousModel: previous,
        notifyReselect: true,
      });
      return;
    }

    const restored = restoreSelection(ctx);
    if (restored) {
      const model = ctx.modelRegistry.find(restored.provider, restored.model);
      if (model && (await pi.setModel(model))) {
        selected = restored;
        boundaryReason = reason;
        updateStatus(ctx);
        return;
      }
    }

    await chooseAndSetModel(ctx, "initial");
  });

  pi.on("session_shutdown", (_event, ctx) => {
    selected = undefined;
    previousModel = undefined;
    boundaryReason = undefined;
    requiredInputs = [];
    updateStatus(ctx);
  });

  pi.on("before_agent_start", async (event, ctx) => {
    requiredInputs = event.images && event.images.length > 0 ? ["image"] : [];
    if (!(await ensureRuntime(ctx))) return;

    if (!selected) {
      await chooseAndSetModel(ctx, "initial", { inputs: requiredInputs });
      return;
    }

    const activeModel = ctx.modelRegistry.find(selected.provider, selected.model);
    const canHandlePrompt = requiredInputs.every((input) => activeModel && modelSupportsInput(activeModel, input));
    if (!canHandlePrompt) {
      await chooseAndSetModel(ctx, "capability", {
        inputs: requiredInputs,
        excludeKeys: selected.attemptedKeys,
        preserveLedgerCommit: selected.ledgerCommitted,
      });
    }
  });

  pi.on("after_provider_response", async (event, ctx) => {
    if (!selected || !config) return;

    if (event.status >= 200 && event.status < 300) {
      await commitLedgerIfPending(ctx);
      return;
    }

    if (!runtimeFallbackEnabled(config) || !fallbackStatuses(config).has(event.status)) return;

    await chooseAndSetModel(ctx, "fallback", {
      inputs: requiredInputs,
      excludeKeys: selected.attemptedKeys,
      preserveLedgerCommit: selected.ledgerCommitted,
    });
  });

  pi.registerCommand("model-router", {
    description: "Show weighted model router status or start guided weight setup",
    handler: async (_args, ctx) => {
      await ensureRuntime(ctx);
      const status = formatStatus(createStatusSnapshot());

      if (!ctx.hasUI) {
        ctx.ui.notify(status, "info");
        return;
      }

      const choice = await ctx.ui.select("Model Router", [
        "Show status",
        "Configure model weights",
      ]);

      if (choice === "Configure model weights") {
        pi.sendUserMessage(buildWeightSetupPrompt(config, status));
        return;
      }

      ctx.ui.notify(status, "info");
    },
  });

  pi.registerTool({
    name: "model_router_config",
    label: "Model Router Config",
    description: "Read, validate, or save pi-weighted-model-router global configuration.",
    promptSnippet: "Read, validate, or save weighted model router configuration after user asks.",
    promptGuidelines: [
      "Use model_router_config when the user asks to configure or inspect pi-weighted-model-router.",
      "Use model_router_config with action=save only after preparing the complete JSON config for the user; the tool asks for confirmation before writing.",
    ],
    parameters: Type.Object({
      action: StringEnum(["read", "status", "validate", "save"] as const),
      configJson: Type.Optional(Type.String({ description: "Full RouterConfig JSON for validate or save." })),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (params.action === "status") {
        await ensureRuntime(ctx);
        return textResult(formatStatus(createStatusSnapshot()));
      }

      if (params.action === "read") {
        const current = await readConfig(paths.config);
        const value = current ?? defaultConfig();
        return textResult(JSON.stringify(value, null, 2), { configPath: paths.config, configured: Boolean(current) });
      }

      if (!params.configJson) throw new Error("configJson is required for validate/save.");
      const nextConfig = validateConfigShape(JSON.parse(params.configJson));
      validateRegisteredModels(ctx, nextConfig);

      if (params.action === "validate") {
        return textResult("Config is valid.", { config: nextConfig });
      }

      if (!ctx.hasUI) {
        return textResult("Config not saved: confirmation UI is unavailable.", { configPath: paths.config });
      }

      const ok = await ctx.ui.confirm("Save model router config?", summarizeConfig(nextConfig));
      if (!ok) return textResult("Config not saved.", { configPath: paths.config });

      await writeConfig(paths.config, nextConfig);
      config = nextConfig;
      const previous = selected;
      await chooseAndSetModel(ctx, "config", { previousModel: previous, notifyReselect: Boolean(previous) });
      return textResult("Config saved.", { configPath: paths.config });
    },
  });
}

function notifyReselect(
  ctx: ExtensionContext,
  reason: SelectedModel["reason"],
  previous: SelectedModel | undefined,
  current: SelectedModel,
): void {
  const was = previous ? formatModelName(previous) : "(none)";
  ctx.ui.notify(`Model router: ${reason} \u2192 ${formatModelName(current)} (was ${was})`, "info");
}

function formatModelName(model: Pick<SelectedModel, "provider" | "model">): string {
  return `${model.provider}/${model.model}`;
}

function validateRegisteredModels(ctx: ExtensionContext, nextConfig: RouterConfig): void {
  const missing: ModelPoolEntry[] = [];
  for (const pool of Object.values(nextConfig.pools)) {
    for (const entry of pool.entries) {
      if (!ctx.modelRegistry.find(entry.provider, entry.model)) missing.push(entry);
    }
  }
  if (missing.length > 0) throw new Error(formatUnknownModelMessage(missing, ctx.modelRegistry.getAll()));
}

function summarizeConfig(nextConfig: RouterConfig): string {
  const lines = [`defaultPool: ${nextConfig.defaultPool}`];
  for (const [poolName, pool] of Object.entries(nextConfig.pools)) {
    const entries = pool.entries.map((entry) => `${modelKey(entry)}:${entry.weight}`).join(", ");
    lines.push(`${poolName}: ${entries}`);
  }
  return lines.join("\n");
}

function buildWeightSetupPrompt(currentConfig: RouterConfig | undefined, status: string): string {
  const configText = currentConfig ? JSON.stringify(currentConfig, null, 2) : "(not configured)";
  return [
    "Start pi-weighted-model-router weight setup.",
    "",
    "Use this command-initiated conversation to decide model candidates and weights with me.",
    "Ask one question at a time. First confirm which provider/model entries should be in the default pool, then ask for the intended ratio or weights.",
    "Recommend a balanced default if I am unsure. Do not require slash-command arguments.",
    "When the configuration is settled, call model_router_config with action=save and the full RouterConfig JSON. The tool must confirm before saving.",
    "",
    "Current status:",
    status,
    "",
    "Current config:",
    configText,
  ].join("\n");
}

function parseSelectedModel(value: unknown): SelectedModel | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.pool !== "string" ||
    typeof value.provider !== "string" ||
    typeof value.model !== "string" ||
    typeof value.key !== "string" ||
    typeof value.reason !== "string" ||
    typeof value.selectedAt !== "string"
  ) {
    return undefined;
  }

  return {
    pool: value.pool,
    provider: value.provider,
    model: value.model,
    key: value.key,
    reason: isSelectedReason(value.reason) ? value.reason : "resume",
    selectedAt: value.selectedAt,
    attemptedKeys: Array.isArray(value.attemptedKeys) ? value.attemptedKeys.filter((key) => typeof key === "string") : [value.key],
    ledgerCommitted: typeof value.ledgerCommitted === "boolean" ? value.ledgerCommitted : false,
  };
}

/** Reads a trusted session_start reason from an event, defaulting older runtimes to startup. */
function readSessionStartReason(event: { reason?: unknown }): SessionStartReason {
  return typeof event.reason === "string" && isSessionStartReason(event.reason) ? event.reason : "startup";
}

/** Converts pi session_start reasons into persisted selection reasons. */
function sessionReasonToSelectionReason(reason: SessionStartReason): SelectedModel["reason"] {
  return reason === "startup" ? "initial" : reason;
}

/** Returns true when a persisted selection reason is supported by this router version. */
function isSelectedReason(value: string): value is SelectedModel["reason"] {
  return (
    value === "initial" ||
    value === "resume" ||
    value === "fallback" ||
    value === "capability" ||
    value === "new" ||
    value === "reload" ||
    value === "fork" ||
    value === "config"
  );
}

function textResult(text: string, details: Record<string, unknown> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
