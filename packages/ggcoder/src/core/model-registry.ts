import type { Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";

export interface ModelInfo {
  id: string;
  name: string;
  provider: Provider;
  contextWindow: number;
  maxOutputTokens: number;
  supportsThinking: boolean;
  supportsImages: boolean;
  costTier: "low" | "medium" | "high";
  /**
   * The top reasoning tier this model genuinely uses. Used when thinking is
   * enabled to pick the strongest setting per model:
   *   - OpenAI GPT-5.5-era: `xhigh`
   *   - OpenAI Pro/Codex/old: clamped to what the model accepts
   *   - Claude Opus 4.7: `xhigh` (mapped to Anthropic's `max` for Opus)
   *   - Claude Sonnet 4.6 / Haiku 4.5: `high` (no `max` tier)
   *   - GLM / Moonshot / Xiaomi / MiniMax / Qwen: `high` — binary-thinking
   *     providers ignore the level on the wire, so the value is cosmetic
   *   - DeepSeek V4: `xhigh` (DeepSeek maps `xhigh` → its internal `max`)
   */
  maxThinkingLevel: ThinkingLevel;
}

// Provider display order — mirrors `PROVIDERS` in ui/login.tsx so the
// /model selector and login selector sort models identically.
export const MODELS: ModelInfo[] = [
  // ── Anthropic ──────────────────────────────────────────
  {
    id: "claude-opus-4-7",
    name: "Claude Opus 4.7",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "claude-sonnet-4-6",
    name: "Claude Sonnet 4.6",
    provider: "anthropic",
    contextWindow: 1_000_000,
    maxOutputTokens: 64_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  {
    id: "claude-haiku-4-5-20251001",
    name: "Claude Haiku 4.5",
    provider: "anthropic",
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  // ── OpenAI (Codex) ─────────────────────────────────────
  {
    id: "gpt-5.5",
    name: "GPT-5.5",
    provider: "openai",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.5-pro",
    name: "GPT-5.5 Pro",
    provider: "openai",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.4",
    name: "GPT-5.4",
    provider: "openai",
    contextWindow: 1_050_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.4-mini",
    name: "GPT-5.4 Mini",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "medium",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "gpt-5.3-codex",
    name: "GPT-5.3 Codex",
    provider: "openai",
    contextWindow: 400_000,
    maxOutputTokens: 128_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "high",
    maxThinkingLevel: "xhigh",
  },
  {
    id: "codex-mini-latest",
    name: "Codex Mini",
    provider: "openai",
    contextWindow: 200_000,
    maxOutputTokens: 100_000,
    supportsThinking: true,
    supportsImages: true,
    costTier: "low",
    // Codex Mini snapshots historically cap at medium reasoning effort.
    maxThinkingLevel: "medium",
  },
  // ── Moonshot (Kimi) ────────────────────────────────────
  {
    id: "kimi-k2.6",
    name: "Kimi K2.6",
    provider: "moonshot",
    contextWindow: 262_144,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: true,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  // ── Z.AI (GLM) ─────────────────────────────────────────
  {
    id: "glm-5.1",
    name: "GLM-5.1",
    provider: "glm",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-4.7",
    name: "GLM-4.7",
    provider: "glm",
    contextWindow: 200_000,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  {
    id: "glm-4.7-flash",
    name: "GLM-4.7 Flash",
    provider: "glm",
    contextWindow: 200_000,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    costTier: "low",
    maxThinkingLevel: "high",
  },
  // ── MiniMax ────────────────────────────────────────────
  {
    id: "MiniMax-M2.7",
    name: "MiniMax M2.7",
    provider: "minimax",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  {
    id: "MiniMax-M2.7-highspeed",
    name: "MiniMax M2.7 Highspeed",
    provider: "minimax",
    contextWindow: 204_800,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  // ── Xiaomi (MiMo) ──────────────────────────────────────
  {
    id: "mimo-v2-pro",
    name: "MiMo-V2-Pro",
    provider: "xiaomi",
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    supportsThinking: true,
    supportsImages: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
  // ── DeepSeek ───────────────────────────────────────────
  {
    id: "deepseek-v4-pro",
    name: "DeepSeek V4 Pro",
    provider: "deepseek",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: false,
    costTier: "high",
    // DeepSeek V4 maps `xhigh` → its internal `max` tier.
    maxThinkingLevel: "xhigh",
  },
  {
    id: "deepseek-v4-flash",
    name: "DeepSeek V4 Flash",
    provider: "deepseek",
    contextWindow: 1_048_576,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: false,
    costTier: "low",
    maxThinkingLevel: "xhigh",
  },
  // ── OpenRouter ─────────────────────────────────────────
  {
    id: "qwen/qwen3.6-plus",
    name: "Qwen3.6-Plus",
    provider: "openrouter",
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsThinking: true,
    supportsImages: false,
    costTier: "medium",
    maxThinkingLevel: "high",
  },
];

export function getModel(id: string): ModelInfo | undefined {
  return MODELS.find((m) => m.id === id);
}

export function getModelsForProvider(provider: Provider): ModelInfo[] {
  return MODELS.filter((m) => m.provider === provider);
}

export function getDefaultModel(provider: Provider): ModelInfo {
  if (provider === "xiaomi") return MODELS.find((m) => m.id === "mimo-v2-pro")!;
  if (provider === "openai") return MODELS.find((m) => m.id === "gpt-5.5")!;
  if (provider === "glm") return MODELS.find((m) => m.id === "glm-5.1")!;
  if (provider === "moonshot") return MODELS.find((m) => m.id === "kimi-k2.6")!;
  if (provider === "minimax") return MODELS.find((m) => m.id === "MiniMax-M2.7")!;
  if (provider === "deepseek") return MODELS.find((m) => m.id === "deepseek-v4-pro")!;
  if (provider === "openrouter") return MODELS.find((m) => m.id === "qwen/qwen3.6-plus")!;
  return MODELS.find((m) => m.id === "claude-sonnet-4-6")!;
}

export function getContextWindow(modelId: string): number {
  const model = getModel(modelId);
  return model?.contextWindow ?? 200_000;
}

/**
 * The strongest thinking level the given model genuinely uses. Falls back to
 * `"high"` for unknown models since every provider we ship accepts it.
 */
export function getMaxThinkingLevel(modelId: string): ThinkingLevel {
  return getModel(modelId)?.maxThinkingLevel ?? "high";
}

/**
 * Get the model to use for compaction summarization.
 * - Anthropic: always Sonnet 4.6
 * - OpenAI: cheapest (Codex Mini)
 * - GLM: GLM-4.7 Flash (cheap alternative)
 * - Moonshot: use the current model (no cheap alternative)
 */
export function getSummaryModel(provider: Provider, currentModelId: string): ModelInfo {
  if (provider === "anthropic") {
    return MODELS.find((m) => m.id === "claude-sonnet-4-6")!;
  }
  if (provider === "openai" || provider === "glm" || provider === "deepseek") {
    const low = getModelsForProvider(provider).find((m) => m.costTier === "low");
    if (low) return low;
  }
  // Moonshot or fallback: use current model
  return getModel(currentModelId) ?? getDefaultModel(provider);
}
