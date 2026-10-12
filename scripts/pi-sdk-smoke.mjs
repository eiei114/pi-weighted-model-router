import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import {
  behaviorAssertions, EXTENSION_LOAD_ERROR_PATTERN, parseJsonLines, SDK_NAMES,
  UNHANDLED_ERROR_PATTERN, VERIFICATION_CONTRACT,
} from "./pi-sdk-smoke-contract.mjs";

const root = resolve(import.meta.dirname, "..");
const reportPath = resolve(root, "docs/verification/pi-sdk-smoke.json");
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const sdkVersions = Object.fromEntries(SDK_NAMES.map((name) => {
  const installed = JSON.parse(readFileSync(resolve(root, "node_modules", name, "package.json"), "utf8")).version;
  if (manifest.devDependencies?.[name] !== installed || installed !== "1.1.0") {
    throw new Error(`Smoke requires the frozen exact SDK pin for ${name}; manifest=${manifest.devDependencies?.[name]}, installed=${installed}`);
  }
  return [name, installed];
}));
const piManifest = JSON.parse(readFileSync(resolve(root, "node_modules/@earendil-works/pi-coding-agent/package.json"), "utf8"));
const piCli = resolve(root, "node_modules/@earendil-works/pi-coding-agent", piManifest.bin.pi);
const providerPath = resolve(root, "scripts/pi-sdk-smoke-provider.mjs");
const rpcArgs = [piCli, "--offline", "--no-session", "--no-tools", "--no-extensions", "--no-skills",
  "--no-context-files", "--no-prompt-templates", "--no-mcp", "-e", providerPath, "-e", root, "--mode", "rpc"];
const MAX_OUTPUT_BYTES = 64_000;
const EVIDENCE_BYTES = 6_000;
const config = {
  version: 1,
  defaultPool: "main",
  pools: { main: { entries: [{ provider: "pi-sdk-smoke", model: "router-model", weight: 1 }] } },
};

function rpcInput(type, message) {
  return `${JSON.stringify(message === undefined ? { type } : { type, message })}\n`;
}

function makeFixture(invalid = false) {
  const agentDir = mkdtempSync(resolve(tmpdir(), "pi-router-sdk-smoke-"));
  const configDir = resolve(agentDir, "weighted-model-router");
  mkdirSync(configDir, { recursive: true });
  const fixtureConfig = invalid ? {
    ...config,
    pools: { main: { entries: [{ provider: "pi-sdk-smoke", model: "router-model", weight: 0 }] } },
  } : config;
  writeFileSync(resolve(configDir, "config.json"), `${JSON.stringify(fixtureConfig, null, 2)}\n`, "utf8");
  return agentDir;
}

function runPi(agentDir, input, isComplete) {
  return new Promise((resolveResult) => {
    const child = spawn(process.execPath, rpcArgs, {
      cwd: agentDir,
      env: { ...process.env, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: "1" },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let outputTooLarge = false;
    let inputEnded = false;
    let deadlineExpired = false;
    let completionTimer;
    const responses = [];
    const stop = setTimeout(() => {
      deadlineExpired = true;
      child.kill();
    }, 15_000);
    const evaluate = () => {
      const fullOutput = `${stdout}${stderr}`;
      if (Buffer.byteLength(fullOutput, "utf8") > MAX_OUTPUT_BYTES) {
        outputTooLarge = true;
        child.kill();
        return;
      }
      responses.splice(0, responses.length, ...parseJsonLines(stdout), ...parseJsonLines(stderr));
      if (!inputEnded && isComplete(responses)) {
        inputEnded = true;
        child.stdin.end();
        completionTimer = setTimeout(() => {
          deadlineExpired = true;
          child.kill();
        }, 1_000);
      }
    };
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stdout += text;
      evaluate();
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      evaluate();
    });
    child.on("error", (error) => {
      clearTimeout(stop);
      clearTimeout(completionTimer);
      resolveResult({ exitCode: 1, signal: null, fullOutput: `${stdout}${stderr}`, responses, agentDir,
        spawnError: error.message });
    });
    child.on("close", (code, signal) => {
      clearTimeout(stop);
      clearTimeout(completionTimer);
      const fullOutput = `${stdout}${stderr}`;
      responses.splice(0, responses.length, ...parseJsonLines(stdout), ...parseJsonLines(stderr));
      resolveResult({ exitCode: code ?? 1, signal, fullOutput, responses, agentDir,
        spawnError: outputTooLarge ? "output exceeded bounded 64 KB limit"
          : deadlineExpired ? "Pi process exceeded the 15 second response or 1 second cleanup deadline" : undefined });
    });
    child.stdin.write(input);
  });
}

function caseResult(name, execution, expectedVersion) {
  const assertions = behaviorAssertions(name, {
    responses: execution.responses,
    fullOutput: execution.fullOutput,
    exitCode: execution.exitCode,
    expectedVersion,
  });
  if (execution.spawnError) {
    assertions.push({ id: "process_started", expected: "Pi host starts and exits before the 15 second deadline",
      observed: JSON.stringify(execution.spawnError), passed: false });
  }
  assertions.push({ id: "process_exit", expected: "The bounded child process exits with code 0 and no signal",
    observed: JSON.stringify({ exitCode: execution.exitCode, signal: execution.signal ?? null }),
    passed: execution.exitCode === 0 && !execution.signal });
  const unhandled = UNHANDLED_ERROR_PATTERN.test(execution.fullOutput);
  const loadError = EXTENSION_LOAD_ERROR_PATTERN.test(execution.fullOutput);
  const redact = (text) => {
    for (const [path, replacement] of [[root, "<checkout>"], [execution.agentDir, "<isolated-pi-dir>"]]) {
      if (!path) continue;
      text = text.replaceAll(path, replacement).replaceAll(JSON.stringify(path).slice(1, -1), replacement);
    }
    return text.replace(/("id"\s*:\s*")[0-9a-f-]{36}("|)/gi, "$1<opaque-id>$2")
      .replace(/("sessionId"\s*:\s*")[0-9a-f-]{36}("|)/gi, "$1<session-id>$2");
  };
  const evidence = redact(execution.fullOutput).slice(-EVIDENCE_BYTES) || execution.spawnError || "No output captured";
  const safeAssertions = assertions.map((item) => ({ ...item, observed: redact(item.observed) }));
  return {
    name,
    command: "npm run smoke:pi",
    exit_code: execution.exitCode,
    passed: execution.exitCode === 0 && !execution.signal && !execution.spawnError && !unhandled && !loadError
      && safeAssertions.every((assertion) => assertion.passed),
    evidence,
    assertions: safeAssertions,
    unhandled,
    loadError,
  };
}

function runHostShell(expectedVersion) {
  if (process.platform === "win32") {
    const shell = resolve(process.env.SystemRoot ?? "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    const command = `& ${quote(process.execPath)} ${quote(piCli)} --no-extensions --version; exit $LASTEXITCODE`;
    const result = spawnSync(shell, ["-NoProfile", "-NonInteractive", "-Command", command], {
      cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true,
    });
    return caseResult("host_shell", { exitCode: result.status ?? 1,
      fullOutput: `${result.stdout ?? ""}${result.stderr ?? ""}`, responses: [], signal: result.signal,
      spawnError: result.error?.message }, expectedVersion);
  }
  const result = spawnSync("/bin/sh", ["-c", '"$1" "$2" --no-extensions --version', "pi-host-shell", process.execPath, piCli], {
    cwd: root, encoding: "utf8", timeout: 15_000, windowsHide: true,
  });
  return caseResult("host_shell", { exitCode: result.status ?? 1,
    fullOutput: `${result.stdout ?? ""}${result.stderr ?? ""}`, responses: [], signal: result.signal,
    spawnError: result.error?.message }, expectedVersion);
}

const agentDir = makeFixture();
try {
  const extensionLoad = caseResult("extension_load", await runPi(agentDir,
    rpcInput("get_commands"), (responses) => responses.some((row) => row?.command === "get_commands")
      && !!responses.find((row) => row?.type === "extension_ui_request" && row.method === "setStatus"
        && typeof row.statusText === "string" && row.statusText.includes("pi-sdk-smoke/router-model"))), "1.1.0");
  const isFeatureComplete = (responses) => responses.some((row) => row?.type === "response"
    && row.command === "prompt" && row.success === true && row.data?.disposition === "handled")
    && responses.some((row) => row?.type === "extension_ui_request" && row.method === "notify"
      && typeof row.message === "string" && row.message.includes("active selection: pi-sdk-smoke/router-model"));
  const happyPath = caseResult("happy_path", await runPi(agentDir,
    rpcInput("prompt", "?router-diagnostics-smoke"), isFeatureComplete), "1.1.0");
  const errorDir = makeFixture(true);
  let errorPath;
  try {
    errorPath = caseResult("error_path", await runPi(errorDir, rpcInput("get_state"), (responses) =>
      responses.some((row) => row?.command === "get_state") && responses.some((row) => row?.type === "extension_ui_request"
        && row.method === "notify" && typeof row.message === "string" && row.message.includes("Model router config error:"))), "1.1.0");
  } finally {
    rmSync(errorDir, { recursive: true, force: true });
  }
  // A second actual Pi process against the same isolated state exercises reload/restart cleanup.
  const reloadOutput = await runPi(agentDir, rpcInput("prompt", "?router-diagnostics-smoke"), isFeatureComplete);
  const reloadCleanup = caseResult("reload_cleanup", reloadOutput, "1.1.0");
  const cases = [extensionLoad, happyPath, errorPath, reloadCleanup, runHostShell("1.1.0")];
  const report = {
    schema_version: 1,
    verification_contract: VERIFICATION_CONTRACT,
    sdk_versions: sdkVersions,
    platform: process.platform,
    model_inference: "none; actual Pi host, router extension, local deterministic provider registration, and RPC feature command",
    unhandled_errors: cases.filter((item) => item.unhandled).length,
    extension_load_errors: cases.filter((item) => item.loadError
      || (item.name === "extension_load" && !item.passed)).length,
    cases: cases.map(({ unhandled, loadError, ...item }) => item),
  };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(JSON.stringify({ verification_contract: VERIFICATION_CONTRACT, platform: process.platform,
    cases: cases.map(({ name, passed, exit_code }) => ({ name, passed, exit_code })) }));
  if (cases.some((item) => !item.passed)) process.exitCode = 1;
} finally {
  rmSync(agentDir, { recursive: true, force: true });
}
