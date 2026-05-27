import { modelKey } from "./keys.js";
import type { ModelPoolEntry } from "./types.js";

export interface RegisteredModelLike {
  provider: string;
  id: string;
  name?: string;
}

interface CandidateScore {
  key: string;
  score: number;
}

const MAX_SUGGESTIONS_PER_MODEL = 5;

export function formatUnknownModelMessage(missing: ModelPoolEntry[], registeredModels: RegisteredModelLike[]): string {
  const missingKeys = missing.map(modelKey);
  const lines = [`Unknown model(s): ${missingKeys.join(", ")}`];

  const suggestionLines = missing
    .map((entry) => formatSuggestionsForEntry(entry, registeredModels))
    .filter((line): line is string => Boolean(line));

  if (suggestionLines.length > 0) {
    lines.push("", "Suggestions:", ...suggestionLines);
  }

  const providers = [...new Set(missing.map((entry) => entry.provider))].filter((provider) =>
    registeredModels.some((model) => model.provider === provider),
  );
  if (providers.length > 0) {
    lines.push("", `Tip: run \`pi --list-models ${providers.join(" ")}\` to inspect exact model IDs.`);
  } else {
    lines.push("", "Tip: run `pi --list-models` to inspect exact provider/model IDs.");
  }

  return lines.join("\n");
}

function formatSuggestionsForEntry(entry: ModelPoolEntry, registeredModels: RegisteredModelLike[]): string | undefined {
  const suggestions = suggestModels(entry, registeredModels, MAX_SUGGESTIONS_PER_MODEL);
  if (suggestions.length === 0) return undefined;
  return `- ${modelKey(entry)}: did you mean ${suggestions.join(", ")}?`;
}

export function suggestModels(
  entry: ModelPoolEntry,
  registeredModels: RegisteredModelLike[],
  limit = MAX_SUGGESTIONS_PER_MODEL,
): string[] {
  return registeredModels
    .map((model) => scoreCandidate(entry, model))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score || left.key.localeCompare(right.key))
    .slice(0, limit)
    .map((candidate) => candidate.key);
}

function scoreCandidate(entry: ModelPoolEntry, model: RegisteredModelLike): CandidateScore {
  const wantedProvider = normalize(entry.provider);
  const candidateProvider = normalize(model.provider);
  const wantedModel = normalize(entry.model);
  const candidateModel = normalize(model.id);
  const candidateName = normalize(model.name ?? "");

  let score = 0;
  if (candidateProvider === wantedProvider) score += 100;
  else if (candidateProvider.includes(wantedProvider) || wantedProvider.includes(candidateProvider)) score += 25;

  if (candidateModel === wantedModel) score += 100;
  else if (candidateModel.includes(wantedModel) || wantedModel.includes(candidateModel)) score += 50;
  else if (candidateName && (candidateName.includes(wantedModel) || wantedModel.includes(candidateName))) score += 25;

  const modelDistance = levenshteinDistance(wantedModel, candidateModel);
  const maxLength = Math.max(wantedModel.length, candidateModel.length, 1);
  const closeness = 1 - modelDistance / maxLength;
  if (closeness >= 0.45) score += Math.round(closeness * 40);

  return { key: `${model.provider}/${model.id}`, score };
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function levenshteinDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (left.length === 0) return right.length;
  if (right.length === 0) return left.length;

  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  const current = Array.from({ length: right.length + 1 }, () => 0);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    current[0] = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost,
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[right.length];
}
