import assert from "node:assert/strict";
import test from "node:test";
import { validateConfigShape } from "../src/config.js";
import { resolveSessionBoundaryAction } from "../src/session-boundary.js";

test("session boundary defaults restore startup and resume", () => {
  assert.equal(resolveSessionBoundaryAction("startup"), "restore");
  assert.equal(resolveSessionBoundaryAction("resume"), "restore");
});

test("session boundary defaults reselect new reload and fork", () => {
  assert.equal(resolveSessionBoundaryAction("new"), "reselect");
  assert.equal(resolveSessionBoundaryAction("reload"), "reselect");
  assert.equal(resolveSessionBoundaryAction("fork"), "reselect");
});

test("session boundary config can move reload to restore", () => {
  const config = validateConfigShape({
    version: 1,
    defaultPool: "main",
    sessionBoundary: {
      restoreOn: ["startup", "resume", "reload"],
      reselectOn: ["new", "fork"],
    },
    pools: {
      main: {
        entries: [{ provider: "openai-codex", model: "gpt-5.5", weight: 1 }],
      },
    },
  });

  assert.equal(resolveSessionBoundaryAction("reload", config), "restore");
});

test("session boundary config can move resume to reselect", () => {
  const config = validateConfigShape({
    version: 1,
    defaultPool: "main",
    sessionBoundary: {
      restoreOn: ["startup"],
      reselectOn: ["resume", "new", "reload", "fork"],
    },
    pools: {
      main: {
        entries: [{ provider: "openai-codex", model: "gpt-5.5", weight: 1 }],
      },
    },
  });

  assert.equal(resolveSessionBoundaryAction("resume", config), "reselect");
});

test("session boundary config rejects restore/reselect overlap", () => {
  assert.throws(
    () =>
      validateConfigShape({
        version: 1,
        defaultPool: "main",
        sessionBoundary: {
          restoreOn: ["startup", "reload"],
          reselectOn: ["reload", "fork"],
        },
        pools: {
          main: {
            entries: [{ provider: "openai-codex", model: "gpt-5.5", weight: 1 }],
          },
        },
      }),
    /overlap: reload/,
  );
});
