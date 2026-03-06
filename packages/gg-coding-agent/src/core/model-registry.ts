import type { Provider } from "@kenkaiiii/gg-ai";

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  costTier: "low" | "medium" | "high";
}

export const MODELS: ModelInfo[] = [
  // ── Anthropic ──────────────────────────────────────────
  {
    id: "claude-opus-4-6",
    name: "Claude Opus 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    costTier: "high",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsThinking: true,
    costTier: "medium",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsThinking: true,
    costTier: "low",
  },
  // ── OpenAI ─────────────────────────────────────────────
  {
    id: "gpt-4.1",
    name: "GPT-4.1",
    provider: "openai",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsThinking: false,
    costTier: "medium",
  },
  {
    id: "gpt-4.1-mini",
    name: "GPT-4.1 Mini",
    provider: "openai",
    contextWindow: 1_000_000,
    maxOutputTokens: 32_768,
    supportsThinking: false,
    costTier: "low",
  },
  {
    id: "o3",
    name: "o3",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    costTier: "high",
  },
  {
    id: "o4-mini",
    name: "o4-mini",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    costTier: "low",
  },
];

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelsForProvider(provider: Provider): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

export function getDefaultModel(provider: Provider): ModelInfo {
  if (provider === "openai") return MODELS.find((m) => m.id === "gpt-4.1")!;
  return MODELS.find((m) => m.id === "claude-sonnet-4-6")!;
}

export function getContextWindow(modelId: string): number {
  const model = getModel(modelId);
  return model?.contextWindow ?? 200_000;
}
