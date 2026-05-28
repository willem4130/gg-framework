import { describe, expect, it } from "vitest";
import {
  getNextThinkingLevel,
  getSupportedThinkingLevels,
  isThinkingLevelSupported,
} from "./thinking-level.js";

describe("getNextThinkingLevel", () => {
  it("cycles OpenAI GPT models through medium, high, xhigh, then off", () => {
    expect(getNextThinkingLevel("openai", "gpt-5.5", undefined)).toBe("medium");
    expect(getNextThinkingLevel("openai", "gpt-5.5", "medium")).toBe("high");
    expect(getNextThinkingLevel("openai", "gpt-5.5", "high")).toBe("xhigh");
    expect(getNextThinkingLevel("openai", "gpt-5.5", "xhigh")).toBeUndefined();
  });

  it("recognizes every OpenAI GPT cycle level as supported", () => {
    expect(getSupportedThinkingLevels("openai", "gpt-5.5")).toEqual(["medium", "high", "xhigh"]);
    expect(isThinkingLevelSupported("openai", "gpt-5.5", "medium")).toBe(true);
    expect(isThinkingLevelSupported("openai", "gpt-5.5", "high")).toBe(true);
    expect(isThinkingLevelSupported("openai", "gpt-5.5", "xhigh")).toBe(true);
  });

  it("cycles Anthropic adaptive models through low, medium, high, xhigh, max, then off", () => {
    expect(getNextThinkingLevel("anthropic", "claude-opus-4-8", undefined)).toBe("low");
    expect(getNextThinkingLevel("anthropic", "claude-opus-4-8", "low")).toBe("medium");
    expect(getNextThinkingLevel("anthropic", "claude-opus-4-8", "medium")).toBe("high");
    expect(getNextThinkingLevel("anthropic", "claude-opus-4-8", "high")).toBe("xhigh");
    expect(getNextThinkingLevel("anthropic", "claude-opus-4-8", "xhigh")).toBe("max");
    expect(getNextThinkingLevel("anthropic", "claude-opus-4-8", "max")).toBeUndefined();
  });

  it("recognizes Anthropic adaptive effort levels supported by each model", () => {
    expect(getSupportedThinkingLevels("anthropic", "claude-opus-4-8")).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(getSupportedThinkingLevels("anthropic", "claude-sonnet-4-6")).toEqual([
      "low",
      "medium",
      "high",
      "max",
    ]);
    expect(isThinkingLevelSupported("anthropic", "claude-opus-4-8", "max")).toBe(true);
  });

  it("keeps non-GPT OpenAI models as a binary max-thinking toggle", () => {
    expect(getNextThinkingLevel("openai", "o3", undefined)).toBe("high");
    expect(getNextThinkingLevel("openai", "o3", "high")).toBeUndefined();
  });
});
