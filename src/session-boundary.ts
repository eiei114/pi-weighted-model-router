import type { RouterConfig, SessionBoundaryAction, SessionStartReason } from "./types.js";

export const SESSION_START_REASONS = ["startup", "resume", "new", "reload", "fork"] as const;
export const DEFAULT_RESTORE_ON: SessionStartReason[] = ["startup", "resume"];
export const DEFAULT_RESELECT_ON: SessionStartReason[] = ["new", "reload", "fork"];

export function resolveSessionBoundaryAction(
  reason: SessionStartReason,
  config?: Pick<RouterConfig, "sessionBoundary">,
): SessionBoundaryAction {
  const restoreOn = config?.sessionBoundary?.restoreOn ?? DEFAULT_RESTORE_ON;
  const reselectOn = config?.sessionBoundary?.reselectOn ?? DEFAULT_RESELECT_ON;

  if (restoreOn.includes(reason)) return "restore";
  if (reselectOn.includes(reason)) return "reselect";

  return DEFAULT_RESTORE_ON.includes(reason) ? "restore" : "reselect";
}

export function isSessionStartReason(value: string): value is SessionStartReason {
  return (SESSION_START_REASONS as readonly string[]).includes(value);
}
