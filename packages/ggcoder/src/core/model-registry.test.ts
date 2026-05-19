import { describe, expect, it } from "vitest";
import { getContextWindow, usesOpenAICodexTransport } from "./model-registry.js";

describe("model registry context windows", () => {
  it("uses the public API context window for OpenAI API-key requests", () => {
    expect(getContextWindow("gpt-5.5", { provider: "openai" })).toBe(1_050_000);
    expect(getContextWindow("gpt-5.4", { provider: "openai" })).toBe(1_050_000);
  });

  it("uses the Codex product context window for OpenAI OAuth requests", () => {
    const options = { provider: "openai" as const, accountId: "acct_123" };

    expect(usesOpenAICodexTransport(options)).toBe(true);
    expect(getContextWindow("gpt-5.5", options)).toBe(272_000);
    expect(getContextWindow("gpt-5.4", options)).toBe(272_000);
  });

  it("keeps non-OpenAI providers on their model context windows", () => {
    expect(usesOpenAICodexTransport({ provider: "anthropic", accountId: "acct_123" })).toBe(false);
    expect(
      getContextWindow("claude-sonnet-4-6", { provider: "anthropic", accountId: "acct_123" }),
    ).toBe(1_000_000);
  });
});
