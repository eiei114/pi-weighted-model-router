export const VERIFICATION_CONTRACT = "pi-sdk-behavior-v2";
export const SDK_NAMES = [
  "@earendil-works/pi-agent-core",
  "@earendil-works/pi-ai",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-tui",
];
export const UNHANDLED_ERROR_PATTERN = /UnhandledPromiseRejection|uncaught exception|shutdown error/i;
export const EXTENSION_LOAD_ERROR_PATTERN = /Failed to load extension|Error loading extension|extension_error/i;

export function parseJsonLines(output, { allowIncompleteTail = false } = {}) {
  const lines = output.split(/\r?\n/);
  if (allowIncompleteTail && !output.endsWith("\n")) lines.pop();
  return lines.flatMap((line) => {
    if (!line.trim()) return [];
    try {
      return [JSON.parse(line)];
    } catch (error) {
      throw new Error(`Invalid JSONL record: ${line}`, { cause: error });
    }
  });
}

export function writeStdin(stream, input) {
  let writeError;
  stream.on("error", (error) => { writeError ??= error; });
  try {
    stream.write(input);
  } catch (error) {
    writeError ??= error;
  }
  return () => {
    if (!writeError) return undefined;
    const code = writeError.code ? `${writeError.code}: ` : "";
    return `${code}${writeError.message ?? String(writeError)}`;
  };
}

function assertion(id, expected, observed, passed) {
  return { id, expected, observed: JSON.stringify(observed), passed: passed === true };
}

export function stdinWriteAssertion(error) {
  return assertion("stdin_write", "Pi accepts the smoke RPC input without a stream error",
    error ?? null, !error);
}

export function rpcStdoutAssertion(error) {
  return assertion("rpc_stdout_jsonl", "Every nonempty Pi RPC stdout line is valid JSON",
    error ?? null, !error);
}

function statusFor(responses) {
  return responses.find((row) => row?.type === "extension_ui_request"
    && row.method === "setStatus" && row.statusKey === "model-router"
    && typeof row.statusText === "string" && row.statusText.includes("pi-sdk-smoke/router-model"));
}

function featureFor(responses) {
  const prompt = responses.find((row) => row?.type === "response" && row.command === "prompt");
  const notification = responses.find((row) => row?.type === "extension_ui_request" && row.method === "notify"
    && typeof row.message === "string" && row.message.includes("active selection: pi-sdk-smoke/router-model"));
  return { prompt, notification, passed: prompt?.success === true
    && prompt.data?.disposition === "handled" && !!notification };
}

export function behaviorAssertions(name, { responses, fullOutput, exitCode, expectedVersion }) {
  if (name === "extension_load") {
    const commandResponse = responses.find((row) => row?.type === "response" && row.command === "get_commands");
    const commands = commandResponse?.data?.commands;
    const status = statusFor(responses);
    const registered = Array.isArray(commands) && commands.some((command) => command.name === "model-router:diagnostics");
    return [assertion("extension_registered", "Pi 1.1.0 loaded the router, registered its command, and selected the configured model",
      { status: status ?? null, registered }, !!status && registered)];
  }
  if (name === "happy_path") {
    const feature = featureFor(responses);
    const observedMessage = feature.notification?.message ?? "";
    return [assertion("feature_response", "The real diagnostics command returns handled output for the selected model",
      { prompt: feature.prompt ?? null, message: observedMessage }, feature.passed
      && observedMessage.includes("policy intent: n/a (manual or runtime trigger)")
      && observedMessage.includes("warnings: (none)"))];
  }
  if (name === "error_path") {
    const warning = responses.find((row) => row?.type === "extension_ui_request" && row.method === "notify"
      && row.notifyType === "warning" && typeof row.message === "string"
      && row.message.includes("Model router config error:") && row.message.includes("weight"));
    return [assertion("handled_error", "An invalid pool weight is reported as a handled router config warning",
      warning?.message ?? null, !!warning)];
  }
  if (name === "reload_cleanup") {
    const status = statusFor(responses);
    const feature = featureFor(responses);
    return [
      assertion("reloaded_extension_registered", "A second isolated Pi host loads the router and selects the configured model",
        status ?? null, !!status),
      assertion("reloaded_feature_response", "The second host handles diagnostics and reports the selected model",
        { prompt: feature.prompt ?? null, message: feature.notification?.message ?? null }, feature.passed),
      assertion("clean_shutdown", "The actual second Pi process exits cleanly without unhandled or shutdown errors",
        { exitCode, errors: UNHANDLED_ERROR_PATTERN.test(fullOutput) }, exitCode === 0
          && !UNHANDLED_ERROR_PATTERN.test(fullOutput)),
    ];
  }
  if (name === "host_shell") {
    return [assertion("native_shell_boundary", "Native host shell launches the checkout's pinned Pi CLI",
      { exitCode, output: fullOutput.trim(), expectedVersion }, exitCode === 0
        && fullOutput.trim() === expectedVersion)];
  }
  throw new Error(`Unknown smoke case: ${name}`);
}
