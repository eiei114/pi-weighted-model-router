import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_FALLBACK_STATUSES,
  defaultConfig,
  fallbackStatuses,
  runtimeFallbackEnabled,
  validateConfigShape,
} from "../src/config.js";
import { DEFAULT_RESELECT_ON } from "../src/session-boundary.js";

/** Deeply mutable config used only to derive invalid fixtures from the valid default. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MutableConfig = any;

/** Fresh deep clone of the one valid fixture every rejection case is derived from. */
function freshConfig(): MutableConfig {
  return structuredClone(defaultConfig());
}

/** Asserts the exact error message produced by validateConfigShape, with no throw as a failure. */
function assertValidationError(value: unknown, expectedMessage: string): void {
  let actualMessage: string | undefined;
  try {
    validateConfigShape(value);
  } catch (error) {
    actualMessage = error instanceof Error ? error.message : String(error);
  }
  assert.equal(actualMessage, expectedMessage, `expected exact validation error: ${expectedMessage}`);
}

interface RejectionCase {
  name: string;
  make: () => unknown;
  message: string;
}

const rejectionCases: RejectionCase[] = [
  {
    name: "a null config is not an object",
    make: () => null,
    message: "Config must be an object.",
  },
  {
    name: "an array config is not an object",
    make: () => [],
    message: "Config must be an object.",
  },
  {
    name: "an unsupported version",
    make: () => {
      const config = freshConfig();
      config.version = 2;
      return config;
    },
    message: "Unsupported config version: 2.",
  },
  {
    name: "a missing version",
    make: () => {
      const config = freshConfig();
      delete config.version;
      return config;
    },
    message: "Unsupported config version: undefined.",
  },
  {
    name: "an empty defaultPool",
    make: () => {
      const config = freshConfig();
      config.defaultPool = "";
      return config;
    },
    message: "defaultPool must be a non-empty string.",
  },
  {
    name: "a whitespace-only defaultPool",
    make: () => {
      const config = freshConfig();
      config.defaultPool = "   ";
      return config;
    },
    message: "defaultPool must be a non-empty string.",
  },
  {
    name: "a non-string defaultPool",
    make: () => {
      const config = freshConfig();
      config.defaultPool = 42;
      return config;
    },
    message: "defaultPool must be a non-empty string.",
  },
  {
    name: "a defaultPool missing from pools",
    make: () => {
      const config = freshConfig();
      config.defaultPool = "ghost";
      return config;
    },
    message: 'defaultPool "ghost" is not defined in pools.',
  },
  {
    name: "pools that are not an object",
    make: () => {
      const config = freshConfig();
      config.pools = [];
      return config;
    },
    message: "pools must be an object.",
  },
  {
    name: "a pool that is not an object",
    make: () => {
      const config = freshConfig();
      config.pools.main = null;
      return config;
    },
    message: 'Pool "main" must be an object.',
  },
  {
    name: "pool entries that are not an array",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries = {};
      return config;
    },
    message: 'Pool "main" entries must be an array.',
  },
  {
    name: "an empty pool",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries = [];
      return config;
    },
    message: 'Pool "main" must include at least one entry.',
  },
  {
    name: "an entry that is not an object",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0] = "not-an-entry";
      return config;
    },
    message: 'Pool "main" entry 0 must be an object.',
  },
  {
    name: "an empty provider",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].provider = "";
      return config;
    },
    message: 'Pool "main" entry 0 provider must be a non-empty string.',
  },
  {
    name: "a non-string provider",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].provider = 7;
      return config;
    },
    message: 'Pool "main" entry 0 provider must be a non-empty string.',
  },
  {
    name: "an empty model",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].model = "   ";
      return config;
    },
    message: 'Pool "main" entry 0 model must be a non-empty string.',
  },
  {
    name: "a zero weight",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].weight = 0;
      return config;
    },
    message: 'Pool "main" entry 0 weight must be a positive number.',
  },
  {
    name: "a negative weight",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].weight = -1;
      return config;
    },
    message: 'Pool "main" entry 0 weight must be a positive number.',
  },
  {
    name: "a non-finite weight",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].weight = Number.POSITIVE_INFINITY;
      return config;
    },
    message: 'Pool "main" entry 0 weight must be a positive number.',
  },
  {
    name: "a non-numeric weight",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[0].weight = "7";
      return config;
    },
    message: 'Pool "main" entry 0 weight must be a positive number.',
  },
  {
    name: "a duplicate model in one pool",
    make: () => {
      const config = freshConfig();
      config.pools.main.entries[1].provider = config.pools.main.entries[0].provider;
      return config;
    },
    message: 'Pool "main" contains duplicate model "openai-codex/gpt-5.5".',
  },
  {
    name: "a restoreOn list that is not an array",
    make: () => {
      const config = freshConfig();
      config.sessionBoundary.restoreOn = "startup";
      return config;
    },
    message: "sessionBoundary.restoreOn must be an array.",
  },
  {
    name: "a reselectOn list that is not an array",
    make: () => {
      const config = freshConfig();
      config.sessionBoundary.reselectOn = null;
      return config;
    },
    message: "sessionBoundary.reselectOn must be an array.",
  },
  {
    name: "an unsupported session reason",
    make: () => {
      const config = freshConfig();
      config.sessionBoundary.restoreOn = ["startup", "bogus"];
      return config;
    },
    message: "sessionBoundary.restoreOn[1] must be one of startup, resume, new, reload, fork.",
  },
  {
    name: "an overlapping session reason",
    make: () => {
      const config = freshConfig();
      config.sessionBoundary.restoreOn = ["startup", "reload"];
      config.sessionBoundary.reselectOn = ["reload", "fork"];
      return config;
    },
    message: "sessionBoundary restoreOn/reselectOn overlap: reload.",
  },
  {
    name: "a fallback status above the HTTP range",
    make: () => {
      const config = freshConfig();
      config.runtimeFallback.statuses = [429, 600];
      return config;
    },
    message: "runtimeFallback.statuses[1] must be an HTTP status code.",
  },
  {
    name: "a fractional fallback status",
    make: () => {
      const config = freshConfig();
      config.runtimeFallback.statuses = [429.5];
      return config;
    },
    message: "runtimeFallback.statuses[0] must be an HTTP status code.",
  },
  {
    name: "a non-numeric fallback status",
    make: () => {
      const config = freshConfig();
      config.runtimeFallback.statuses = ["429"];
      return config;
    },
    message: "runtimeFallback.statuses[0] must be an HTTP status code.",
  },
  {
    name: "an unknown strategy string",
    make: () => {
      const config = freshConfig();
      config.strategy = "round-robin";
      return config;
    },
    message: 'strategy must be "smooth-weighted-daily".',
  },
  {
    name: "a non-string strategy value",
    make: () => {
      const config = freshConfig();
      config.strategy = 42;
      return config;
    },
    message: 'strategy must be "smooth-weighted-daily".',
  },
  {
    name: "a null strategy value",
    make: () => {
      const config = freshConfig();
      config.strategy = null;
      return config;
    },
    message: 'strategy must be "smooth-weighted-daily".',
  },
];

for (const rejectionCase of rejectionCases) {
  test(`rejects ${rejectionCase.name} with the exact message`, () => {
    assertValidationError(rejectionCase.make(), rejectionCase.message);
  });
}

test("defaultConfig round-trips through validateConfigShape", () => {
  const config = defaultConfig();
  assert.deepEqual(validateConfigShape(config), config);
});

test("an omitted strategy defaults to smooth-weighted-daily", () => {
  const config = freshConfig();
  Reflect.deleteProperty(config, "strategy");
  assert.equal(validateConfigShape(config).strategy, "smooth-weighted-daily");
});

test("duplicate session reasons are de-duplicated", () => {
  const value = freshConfig();
  value.sessionBoundary.restoreOn = ["startup", "resume", "startup", "resume"];
  const config = validateConfigShape(value);
  assert.deepEqual(config.sessionBoundary?.restoreOn, ["startup", "resume"]);
  assert.deepEqual(config.sessionBoundary?.reselectOn, DEFAULT_RESELECT_ON);
});

test("an empty runtimeFallback applies enabled and default statuses", () => {
  const value = freshConfig();
  value.runtimeFallback = {};
  const config = validateConfigShape(value);
  assert.equal(config.runtimeFallback?.enabled, true);
  assert.deepEqual(config.runtimeFallback?.statuses, [...DEFAULT_FALLBACK_STATUSES]);
});

test("a partial runtimeFallback defaults only the missing field", () => {
  const disabled = freshConfig();
  disabled.runtimeFallback = { enabled: false };
  const disabledConfig = validateConfigShape(disabled);
  assert.equal(disabledConfig.runtimeFallback?.enabled, false);
  assert.deepEqual(disabledConfig.runtimeFallback?.statuses, [...DEFAULT_FALLBACK_STATUSES]);

  const custom = freshConfig();
  custom.runtimeFallback = { statuses: [429] };
  const customConfig = validateConfigShape(custom);
  assert.equal(customConfig.runtimeFallback?.enabled, true);
  assert.deepEqual(customConfig.runtimeFallback?.statuses, [429]);
});

test("a missing runtimeFallback section still resolves to fallback defaults", () => {
  const value = freshConfig();
  delete value.runtimeFallback;
  const config = validateConfigShape(value);
  assert.equal(config.runtimeFallback, undefined);
  assert.equal(runtimeFallbackEnabled(config), true);
  assert.deepEqual([...fallbackStatuses(config)], [...DEFAULT_FALLBACK_STATUSES]);
});

test("a blank label is dropped while a real label is preserved", () => {
  const blank = freshConfig();
  blank.pools.main.entries[0].label = "   ";
  const blankConfig = validateConfigShape(blank);
  assert.equal(Object.hasOwn(blankConfig.pools.main.entries[0], "label"), false);

  const labelled = freshConfig();
  labelled.pools.main.entries[0].label = "Primary model";
  const labelledConfig = validateConfigShape(labelled);
  assert.equal(labelledConfig.pools.main.entries[0].label, "Primary model");
});
