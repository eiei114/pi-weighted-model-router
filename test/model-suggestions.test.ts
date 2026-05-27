import assert from "node:assert/strict";
import test from "node:test";
import { formatUnknownModelMessage, suggestModels } from "../src/model-suggestions.js";

const registeredModels = [
  { provider: "openai-codex", id: "gpt-5.5", name: "GPT-5.5" },
  { provider: "cursor", id: "gpt-5.5@1m", name: "GPT-5.5" },
  { provider: "cursor", id: "gpt-5.5@272k", name: "GPT-5.5" },
  { provider: "github-copilot", id: "gpt-5.5", name: "GPT-5.5" },
];

test("model suggestions recover Cursor context variant punctuation", () => {
  const suggestions = suggestModels({ provider: "cursor", model: "gpt-5.5-1m", weight: 3 }, registeredModels);

  assert.equal(suggestions[0], "cursor/gpt-5.5@1m");
});

test("unknown model message includes suggested exact IDs and list-models tip", () => {
  const message = formatUnknownModelMessage(
    [{ provider: "cursor", model: "gpt-5.5-1m", weight: 3 }],
    registeredModels,
  );

  assert.match(message, /Unknown model\(s\): cursor\/gpt-5\.5-1m/);
  assert.match(message, /did you mean cursor\/gpt-5\.5@1m/);
  assert.match(message, /pi --list-models cursor/);
});

test("model suggestions prefer provider match before same model on another provider", () => {
  const suggestions = suggestModels({ provider: "github-copilot", model: "gpt-5-5", weight: 1 }, registeredModels);

  assert.equal(suggestions[0], "github-copilot/gpt-5.5");
});
