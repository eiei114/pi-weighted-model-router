export const CONFIG_VERSION = 1;
export const LEDGER_VERSION = 1;

export interface ModelPoolEntry {
  provider: string;
  model: string;
  weight: number;
  label?: string;
}

export interface ModelPoolConfig {
  entries: ModelPoolEntry[];
}

export interface RouterConfig {
  version: typeof CONFIG_VERSION;
  defaultPool: string;
  pools: Record<string, ModelPoolConfig>;
  strategy?: "smooth-weighted-daily";
  sessionBoundary?: {
    restoreOn?: SessionStartReason[];
    reselectOn?: SessionStartReason[];
  };
  runtimeFallback?: {
    enabled?: boolean;
    statuses?: number[];
  };
}

export type SessionStartReason = "startup" | "resume" | "new" | "reload" | "fork";
export type SessionBoundaryAction = "restore" | "reselect";
export type SelectionReason = "initial" | "resume" | "fallback" | "capability" | "new" | "reload" | "fork" | "config";
export type RouterBoundaryReason = SessionStartReason | SelectionReason;

export interface PoolLedger {
  success: Record<string, number>;
  failure: Record<string, number>;
}

export interface DayLedger {
  pools: Record<string, PoolLedger>;
}

export interface RouterLedger {
  version: typeof LEDGER_VERSION;
  days: Record<string, DayLedger>;
}

export interface RouterState {
  version: 1;
  configMissingNoticeShown?: boolean;
}

export interface SelectedModel {
  pool: string;
  provider: string;
  model: string;
  key: string;
  reason: SelectionReason;
  selectedAt: string;
  attemptedKeys: string[];
  ledgerCommitted: boolean;
}

export interface SelectionInput {
  poolName: string;
  entries: ModelPoolEntry[];
  ledger: RouterLedger;
  date: string;
}

export interface SelectionResult {
  entry: ModelPoolEntry;
  key: string;
  score: number;
}

export interface RouterPaths {
  dir: string;
  config: string;
  ledger: string;
  state: string;
}

export interface StatusSnapshot {
  configPath: string;
  pool: string | undefined;
  selected: SelectedModel | undefined;
  boundaryReason?: RouterBoundaryReason;
  previousModel?: SelectedModel;
  today: string;
  counts: Record<string, number>;
}
