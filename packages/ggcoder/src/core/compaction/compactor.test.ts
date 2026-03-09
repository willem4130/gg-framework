import { describe, it, expect } from "vitest";
import { shouldCompact, findRecentCutPoint } from "./compactor.js";
import { estimateConversationTokens } from "./token-estimator.js";
import type { Message } from "@kenkaiiii/gg-ai";

// ── Helpers ────────────────────────────────────────────────

function makeMessage(role: "system", content: string): Message;
function makeMessage(role: "user", content: string): Message;
function makeMessage(role: "assistant", content: string): Message;
function makeMessage(role: Message["role"], content: string): Message {
  return { role, content } as Message;
}

function makeToolCallMessage(): Message {
  return {
    role: "assistant",
    content: [{ type: "tool_call", id: "t1", name: "read", args: { path: "foo.ts" } }],
  };
}

function makeToolResultMessage(): Message {
  return {
    role: "tool",
    content: [{ type: "tool_result", toolCallId: "t1", content: "file contents" }],
  };
}

// ── shouldCompact ──────────────────────────────────────────

describe("shouldCompact", () => {
  it("returns false when under threshold", () => {
    const messages = [makeMessage("system", "sys"), makeMessage("user", "hello")];
    // Estimated tokens ~= 13, contextWindow 200k, threshold 0.8 → 160k
    expect(shouldCompact(messages, 200_000, 0.8)).toBe(false);
  });

  it("returns true when over threshold", () => {
    // Create a message with enough content to exceed a small context window
    const bigContent = "x".repeat(1000); // ~250 tokens
    const messages = [makeMessage("system", bigContent), makeMessage("user", bigContent)];
    // Total ~508 tokens, window=500, threshold 0.8 → 400
    expect(shouldCompact(messages, 500, 0.8)).toBe(true);
  });

  it("uses default threshold of 0.8", () => {
    const content = "x".repeat(400); // ~100 tokens + 4 overhead = 104
    const messages = [makeMessage("user", content)];
    const estimated = estimateConversationTokens(messages);
    // With window = estimated / 0.7 → should be under 0.8 threshold
    expect(shouldCompact(messages, Math.ceil(estimated / 0.7))).toBe(false);
    // With window = estimated / 0.9 → should be over 0.8 threshold
    expect(shouldCompact(messages, Math.ceil(estimated / 0.9))).toBe(true);
  });

  it("handles custom threshold", () => {
    const content = "x".repeat(200); // ~50 tokens + 4 = 54
    const messages = [makeMessage("user", content)];
    const estimated = estimateConversationTokens(messages);
    // Tight threshold: 0.5 → need window > estimated/0.5 to not compact
    expect(shouldCompact(messages, estimated * 3, 0.5)).toBe(false);
    expect(shouldCompact(messages, estimated, 0.5)).toBe(true);
  });
});

// ── findRecentCutPoint ─────────────────────────────────────

describe("findRecentCutPoint", () => {
  it("keeps all messages when total tokens are under budget", () => {
    const messages = [
      makeMessage("system", "sys"),
      makeMessage("user", "hello"),
      makeMessage("assistant", "hi"),
    ];
    // All messages are small, budget is huge
    const cut = findRecentCutPoint(messages, 100_000);
    expect(cut).toBe(1); // Only system (index 0) is excluded
  });

  it("keeps only recent messages when total exceeds budget", () => {
    const big = "x".repeat(400); // ~100 tokens each
    const messages = [
      makeMessage("system", "sys"),
      makeMessage("user", big), // ~104 tokens
      makeMessage("assistant", big), // ~104 tokens
      makeMessage("user", big), // ~104 tokens
      makeMessage("assistant", big), // ~104 tokens
      makeMessage("user", "last"), // ~5 tokens
    ];
    // Budget of 120 tokens — should keep last ~1-2 messages
    const cut = findRecentCutPoint(messages, 120);
    expect(cut).toBeGreaterThan(1);
    expect(cut).toBeLessThan(messages.length);
  });

  it("never cuts at index 0 (system message)", () => {
    const messages = [makeMessage("system", "sys"), makeMessage("user", "hi")];
    const cut = findRecentCutPoint(messages, 100_000);
    expect(cut).toBeGreaterThanOrEqual(1);
  });

  it("does not split tool_call and tool_result pairs", () => {
    const big = "x".repeat(400); // ~100 tokens
    const messages = [
      makeMessage("system", "sys"),
      makeMessage("user", big),
      makeToolCallMessage(), // assistant with tool_call
      makeToolResultMessage(), // tool result
      makeMessage("user", "thanks"),
    ];
    // Budget that would normally cut at the tool result (index 3)
    // should back up to include the tool_call (index 2)
    const cut = findRecentCutPoint(messages, 50);
    // The cut should NOT leave a tool result as the first kept message
    if (cut < messages.length) {
      expect(messages[cut].role).not.toBe("tool");
    }
  });

  it("handles conversation with only system message", () => {
    const messages = [makeMessage("system", "sys")];
    const cut = findRecentCutPoint(messages, 100);
    expect(cut).toBe(1); // Nothing to keep beyond system
  });

  it("returns length when budget is 0", () => {
    const messages = [
      makeMessage("system", "sys"),
      makeMessage("user", "hello"),
      makeMessage("assistant", "hi"),
    ];
    const cut = findRecentCutPoint(messages, 0);
    // Can't fit anything — cut at the end
    expect(cut).toBe(messages.length);
  });
});
