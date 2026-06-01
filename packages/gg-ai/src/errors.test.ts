import { describe, expect, it } from "vitest";
import {
  GGAIError,
  ProviderError,
  formatError,
  formatErrorForDisplay,
  isUsageLimitError,
  readHeader,
} from "./errors.js";

describe("isUsageLimitError", () => {
  it("matches the canonical usage-limit message", () => {
    expect(isUsageLimitError(new ProviderError("anthropic", "Claude usage limit reached"))).toBe(
      true,
    );
  });

  it("does not match a transient rate-limit error", () => {
    expect(
      isUsageLimitError(
        new ProviderError("anthropic", "rate_limit_error: Rate limited.", { statusCode: 429 }),
      ),
    ).toBe(false);
  });

  it("returns false for non-Error values", () => {
    expect(isUsageLimitError("Claude usage limit reached")).toBe(false);
  });
});

describe("formatError usage limit", () => {
  it("produces a clear usage-finished message with reset time", () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 3600;
    const formatted = formatError(
      new ProviderError("anthropic", "Claude usage limit reached", {
        statusCode: 429,
        resetsAt,
      }),
    );
    expect(formatted.headline).toBe("Anthropic usage limit reached.");
    expect(formatted.message).toContain("Your Anthropic usage is finished.");
    expect(formatted.message).toContain("It resets at");
    expect(formatted.guidance).toContain("Try again once it's back.");
    expect(formatted.resetsAt).toBe(resetsAt);
  });

  it("omits the reset clause when no reset time is known", () => {
    const formatted = formatError(
      new ProviderError("anthropic", "Claude usage limit reached", { statusCode: 429 }),
    );
    expect(formatted.headline).toBe("Anthropic usage limit reached.");
    expect(formatted.message).toBe("Your Anthropic usage is finished.");
    expect(formatted.resetsAt).toBeUndefined();
  });
});

describe("formatErrorForDisplay", () => {
  it("renders an Anthropic 529 overloaded error as headline + message + guidance", () => {
    const out = formatErrorForDisplay(
      new ProviderError("anthropic", "overloaded_error: Overloaded", { statusCode: 529 }),
    );
    expect(out).toBe(
      [
        "Anthropic returned an error.",
        "  overloaded_error: Overloaded",
        "  \u2192 Anthropic's servers are overloaded right now. Retry in a moment \u2014 not a ggcoder issue.",
      ].join("\n"),
    );
  });

  it("renders an OpenAI 500 server_error pointing at the status page", () => {
    const out = formatErrorForDisplay(
      new ProviderError("openai", "server_error: something broke", { statusCode: 500 }),
    );
    expect(out).toBe(
      [
        "OpenAI returned an error.",
        "  server_error: something broke",
        "  \u2192 This is an error from OpenAI, not ggcoder. Retry \u2014 if it keeps happening, check status.openai.com.",
      ].join("\n"),
    );
  });

  it("prefers an explicit provider hint over the inferred guidance", () => {
    const out = formatErrorForDisplay(
      new ProviderError("openai", "This model is not available.", {
        statusCode: 404,
        hint: "Run /model and choose a listed model.",
      }),
    );
    expect(out).toBe(
      [
        "OpenAI returned an error.",
        "  This model is not available.",
        "  \u2192 Run /model and choose a listed model.",
      ].join("\n"),
    );
  });

  it("strips a legacy [provider] prefix from the message body", () => {
    const out = formatErrorForDisplay(
      new ProviderError("gemini", "[gemini] quota exceeded", { statusCode: 429 }),
    );
    expect(out).toBe(
      [
        "Gemini returned an error.",
        "  quota exceeded",
        "  \u2192 Your Gemini account has a billing or quota issue \u2014 check your balance. Not a ggcoder issue.",
      ].join("\n"),
    );
  });

  it("classifies a network GGAIError without a ggcoder bug headline", () => {
    const out = formatErrorForDisplay(new GGAIError("fetch failed", { source: "network" }));
    expect(out).toBe(
      [
        "Network error \u2014 couldn't reach the provider.",
        "  fetch failed",
        "  \u2192 Check your internet connection. Not a ggcoder issue \u2014 retry shortly.",
      ].join("\n"),
    );
  });

  it("falls back to the ggcoder-bug headline for unknown errors", () => {
    const out = formatErrorForDisplay(new Error("Cannot read property 'foo' of undefined"));
    expect(out).toBe(
      [
        "ggcoder hit an unexpected error.",
        "  Cannot read property 'foo' of undefined",
        "  \u2192 This looks like a ggcoder bug \u2014 please report it to the developer (see /help).",
      ].join("\n"),
    );
  });
});

describe("readHeader", () => {
  it("reads from a web Headers object", () => {
    const headers = new Headers({ "x-request-id": "req_123" });
    expect(readHeader(headers, "x-request-id")).toBe("req_123");
  });

  it("falls back to the lowercased name on a plain record", () => {
    // Preserves the original anthropic getter contract: tries the exact name,
    // then the lowercased name — so a capitalized lookup finds a lowercase key.
    expect(readHeader({ "x-request-id": "req_456" }, "X-Request-Id")).toBe("req_456");
  });

  it("returns the first present header among several candidates", () => {
    const headers = new Headers({ "openai-request-id": "oai_789" });
    expect(readHeader(headers, "x-request-id", "openai-request-id", "x-oai-request-id")).toBe(
      "oai_789",
    );
  });

  it("returns undefined when no candidate is present", () => {
    expect(readHeader(new Headers(), "x-request-id")).toBeUndefined();
  });

  it("returns undefined for nullish or non-object headers", () => {
    expect(readHeader(undefined, "x-request-id")).toBeUndefined();
    expect(readHeader(null, "x-request-id")).toBeUndefined();
  });
});
