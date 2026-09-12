import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { isSessionStartReason, resolveSessionBoundaryAction } from "./session-boundary.js";
import type {
  DiagnosticsSnapshot,
  RouterBoundaryReason,
  RouterConfig,
  SelectedModel,
  SessionBoundaryAction,
  SessionStartReason,
} from "./types.js";

export type BoundaryPolicyIntent =
  | { kind: "session-boundary"; reason: SessionStartReason; policy: SessionBoundaryAction }
  | { kind: "non-boundary"; reason: RouterBoundaryReason }
  | { kind: "none" };

/** Resolves restore/reselect intent for a session boundary reason, if applicable. */
export function resolveBoundaryPolicyIntent(
  reason: RouterBoundaryReason | undefined,
  config?: RouterConfig,
): BoundaryPolicyIntent {
  if (!reason) return { kind: "none" };
  if (!isSessionStartReason(reason)) return { kind: "non-boundary", reason };
  return {
    kind: "session-boundary",
    reason,
    policy: resolveSessionBoundaryAction(reason, config),
  };
}

/** Collects read-only warnings about missing or stale persisted router state. */
export function buildDiagnosticsWarnings(
  ctx: ExtensionContext,
  options: {
    config?: RouterConfig;
    selected?: SelectedModel;
    persisted?: SelectedModel;
  },
): string[] {
  const warnings: string[] = [];
  const { config, selected, persisted } = options;

  if (!config) {
    warnings.push("config missing or unreadable");
  }

  if (!persisted) {
    warnings.push("no persisted selection entry in session");
    return warnings;
  }

  const registered = ctx.modelRegistry.find(persisted.provider, persisted.model);
  if (!registered) {
    warnings.push(`persisted model ${persisted.provider}/${persisted.model} is not in the model registry`);
  } else if (config) {
    const pool = config.pools[persisted.pool];
    const inPool = pool?.entries.some(
      (entry) => entry.provider === persisted.provider && entry.model === persisted.model,
    );
    if (!inPool) {
      warnings.push(`persisted model ${persisted.provider}/${persisted.model} is not in pool "${persisted.pool}"`);
    }
  }

  if (selected && persisted.key !== selected.key) {
    warnings.push(
      `persisted selection (${persisted.provider}/${persisted.model}) differs from active selection (${selected.provider}/${selected.model})`,
    );
  }

  return warnings;
}

/** Formats a compact diagnostics snapshot safe for logs; read-only, no model switching. */
export function formatDiagnostics(snapshot: DiagnosticsSnapshot): string {
  const lines: string[] = [];
  const intent = resolveBoundaryPolicyIntent(snapshot.boundaryReason, snapshot.config);

  if (intent.kind === "none") {
    lines.push("boundary reason: (none)");
    lines.push("policy intent: (none)");
  } else if (intent.kind === "session-boundary") {
    lines.push(`boundary reason: ${intent.reason}`);
    lines.push(`policy intent: ${intent.policy}`);
  } else {
    lines.push(`boundary reason: ${intent.reason}`);
    lines.push("policy intent: n/a (manual or runtime trigger)");
  }

  const active = snapshot.selected ? `${snapshot.selected.provider}/${snapshot.selected.model}` : "(none)";
  lines.push(`active selection: ${active}`);

  const persisted = snapshot.persisted ? `${snapshot.persisted.provider}/${snapshot.persisted.model}` : "(none)";
  lines.push(`persisted selection: ${persisted}`);

  if (snapshot.warnings.length === 0) {
    lines.push("warnings: (none)");
  } else {
    for (const warning of snapshot.warnings) {
      lines.push(`warning: ${warning}`);
    }
  }

  lines.push(`config: ${snapshot.configPath}`);
  return lines.join("\n");
}
