import type { Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";
import { getMaxThinkingLevel } from "../core/model-registry.js";

const OPENAI_GPT_THINKING_LEVELS: readonly ThinkingLevel[] = ["medium", "high", "xhigh"];

function isOpenAIGptModel(provider: Provider, model: string): boolean {
  return provider === "openai" && model.startsWith("gpt-");
}

export function getSupportedThinkingLevels(
  provider: Provider,
  model: string,
): readonly ThinkingLevel[] {
  const maxLevel = getMaxThinkingLevel(model);
  if (!isOpenAIGptModel(provider, model)) return [maxLevel];

  const maxIndex = OPENAI_GPT_THINKING_LEVELS.indexOf(maxLevel);
  if (maxIndex === -1) return ["medium"];
  return OPENAI_GPT_THINKING_LEVELS.slice(0, maxIndex + 1);
}

export function isThinkingLevelSupported(
  provider: Provider,
  model: string,
  level: ThinkingLevel,
): boolean {
  return getSupportedThinkingLevels(provider, model).includes(level);
}

export function getNextThinkingLevel(
  provider: Provider,
  model: string,
  current: ThinkingLevel | undefined,
): ThinkingLevel | undefined {
  const supportedLevels = getSupportedThinkingLevels(provider, model);
  if (!isOpenAIGptModel(provider, model)) {
    return current ? undefined : supportedLevels[0];
  }

  if (!current) return supportedLevels[0];
  const index = supportedLevels.indexOf(current);
  if (index === -1) return supportedLevels[0];
  return supportedLevels[index + 1];
}
