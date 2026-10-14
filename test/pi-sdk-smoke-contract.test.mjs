import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  behaviorAssertions, parseJsonLines, rpcStdoutAssertion, stdinWriteAssertion, writeStdin,
} from "../scripts/pi-sdk-smoke-contract.mjs";

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

test("JSONL parser rejects malformed records and defers an incomplete stdout tail", () => {
  assert.throws(() => parseJsonLines('{"type":"response"}\nnot-json\n'), /Invalid JSONL record/);
  assert.equal(rpcStdoutAssertion("Invalid JSONL record: not-json").passed, false);
  assert.deepEqual(parseJsonLines('{"type":"response"}\nnot-', { allowIncompleteTail: true }),
    [{ type: "response" }]);
  assert.throws(() => parseJsonLines('{"type":"response"}\nnot-json\n', { allowIncompleteTail: true }),
    /Invalid JSONL record/);
});

test("early child close records a stdin stream failure in its case assertion", async () => {
  const child = spawn(process.execPath, ["-e",
    'process.stdin.destroy(); process.stdout.write("ready\\n"); setTimeout(() => process.exit(0), 250)'], {
    stdio: ["pipe", "pipe", "ignore"],
    windowsHide: true,
  });
  const closed = new Promise((resolve, reject) => {
    child.once("close", (code, signal) => resolve({ code, signal }));
    child.once("error", reject);
  });
  let deadline;
  const ready = new Promise((resolve, reject) => {
    child.stdout.once("data", (chunk) => resolve(chunk.toString("utf8")));
    child.once("error", reject);
  });
  const output = await Promise.race([
    ready,
    new Promise((resolve) => { deadline = setTimeout(() => resolve(null), 1_000); }),
  ]);
  clearTimeout(deadline);
  if (!output) {
    child.kill();
    let cleanupDeadline;
    const cleanedUp = await Promise.race([
      closed,
      new Promise((resolve) => { cleanupDeadline = setTimeout(() => resolve(null), 1_000); }),
    ]);
    clearTimeout(cleanupDeadline);
    assert.ok(cleanedUp, "early-exit child must close within the one-second cleanup grace");
    assert.fail("child did not close stdin and report readiness within one second");
  }
  assert.match(output, /ready/);

  let errorDeadline;
  const streamError = await new Promise((resolve) => {
    const getWriteError = writeStdin(child.stdin, "x".repeat(1_000_000));
    const currentError = getWriteError();
    if (currentError) {
      resolve(currentError);
      return;
    }
    child.stdin.once("error", () => resolve(getWriteError()));
    errorDeadline = setTimeout(() => resolve(undefined), 1_000);
  });
  clearTimeout(errorDeadline);
  assert.match(streamError ?? "", /EPIPE|EOF|ERR_STREAM_(?:DESTROYED|WRITE_AFTER_END)/);
  let closeDeadline;
  const cleanExit = await Promise.race([
    closed,
    new Promise((resolve) => { closeDeadline = setTimeout(() => resolve(null), 1_000); }),
  ]);
  clearTimeout(closeDeadline);
  if (!cleanExit) {
    child.kill();
    await Promise.race([closed, new Promise((resolve) => setTimeout(resolve, 1_000))]);
    assert.fail("early-exit child did not close within one second");
  }
  assert.deepEqual(cleanExit, { code: 0, signal: null });
  const assertion = stdinWriteAssertion(streamError);
  assert.equal(assertion.id, "stdin_write");
  assert.equal(assertion.passed, false);
});


test("host_shell must not report RPC transport assertions it never ran", () => {
  const source = readFileSync(new URL("../scripts/pi-sdk-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /if \(name !== "host_shell"\) \{/, "RPC assertions must be limited to RPC cases");
  const report = JSON.parse(readFileSync(new URL("../docs/verification/pi-sdk-smoke.json", import.meta.url), "utf8"));
  const hostShell = report.cases.find((entry) => entry.name === "host_shell");
  const ids = hostShell.assertions.map((entry) => entry.id);
  assert.deepEqual(ids, ["native_shell_boundary", "process_exit"]);
  assert.ok(!ids.includes("rpc_stdout_jsonl") && !ids.includes("stdin_write"));
});
