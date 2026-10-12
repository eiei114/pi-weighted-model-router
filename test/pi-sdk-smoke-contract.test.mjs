import assert from "node:assert/strict";
import test from "node:test";
import { behaviorAssertions, parseJsonLines } from "../scripts/pi-sdk-smoke-contract.mjs";

function rows(...values) { return values; }

test("smoke contract accepts actual positive feature and extension observations", () => {
  const passed = behaviorAssertions("happy_path", {
    responses: rows(
      { type: "response", command: "prompt", success: true, data: { disposition: "handled" } },
      { type: "extension_ui_request", method: "notify", message: "policy intent: n/a (manual or runtime trigger)\nactive selection: pi-sdk-smoke/router-model\nwarnings: (none)" },
    ),
    fullOutput: "",
    exitCode: 0,
  });
  assert.equal(passed[0].passed, true);
});

test("smoke contract rejects missing positive responses and malformed negative fixtures", () => {
  const missingPositive = behaviorAssertions("happy_path", { responses: [], fullOutput: "", exitCode: 0 });
  const missingNegative = behaviorAssertions("error_path", { responses: [], fullOutput: "", exitCode: 0 });
  assert.equal(missingPositive[0].passed, false);
  assert.equal(missingNegative[0].passed, false);
});

test("extension registration assertion fails closed when either the status or command is absent", () => {
  const status = { type: "extension_ui_request", method: "setStatus", statusKey: "model-router",
    statusText: "router:main pi-sdk-smoke/router-model [startup]" };
  const commands = { type: "response", command: "get_commands", data: { commands: [{ name: "model-router:diagnostics" }] } };
  assert.equal(behaviorAssertions("extension_load", { responses: [status, commands], fullOutput: "", exitCode: 0 })[0].passed, true);
  assert.equal(behaviorAssertions("extension_load", { responses: [commands], fullOutput: "", exitCode: 0 })[0].passed, false);
  assert.equal(behaviorAssertions("extension_load", { responses: [status], fullOutput: "", exitCode: 0 })[0].passed, false);
});

test("reload assertions require the second-host feature response and a clean process exit", () => {
  const responses = [
    { type: "extension_ui_request", method: "setStatus", statusKey: "model-router",
      statusText: "router:main pi-sdk-smoke/router-model [startup]" },
    { type: "response", command: "prompt", success: true, data: { disposition: "handled" } },
    { type: "extension_ui_request", method: "notify", message: "active selection: pi-sdk-smoke/router-model" },
  ];
  assert.deepEqual(behaviorAssertions("reload_cleanup", { responses, fullOutput: "", exitCode: 0 }).map((a) => a.passed), [true, true, true]);
  assert.equal(behaviorAssertions("reload_cleanup", { responses: responses.slice(0, 1), fullOutput: "", exitCode: 0 })[1].passed, false);
  assert.equal(behaviorAssertions("reload_cleanup", { responses, fullOutput: "shutdown error", exitCode: 1 })[2].passed, false);
});

test("host-shell assertion compares the actual complete version rather than command success alone", () => {
  const assertions = behaviorAssertions("host_shell", { responses: [], fullOutput: "1.1.0\n", expectedVersion: "1.1.0", exitCode: 0 });
  assert.equal(assertions[0].passed, true);
  assert.equal(behaviorAssertions("host_shell", { responses: [], fullOutput: "1.1.1\n", expectedVersion: "1.1.0", exitCode: 0 })[0].passed, false);
});

test("JSONL parser ignores non-JSON output without replacing semantic assertions", () => {
  assert.deepEqual(parseJsonLines('{"type":"response"}\nnot-json\n'), [{ type: "response" }]);
});
