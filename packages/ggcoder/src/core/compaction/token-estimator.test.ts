import { describe, it, expect } from "vitest";
import {
  estimateTokens,
  estimateMessageTokens,
  estimateConversationTokens,
} from "./token-estimator.js";
import type { Message } from "@kenkaiiii/gg-ai";

describe("estimateTokens", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });

  it("estimates at ~4 chars per token", () => {
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcdefgh")).toBe(2);
    expect(estimateTokens("abc")).toBe(1); // ceil(3/4) = 1
  });

  it("handles long text", () => {
    const text = "a".repeat(1000);
    expect(estimateTokens(text)).toBe(250);
  });
});

describe("estimateMessageTokens", () => {
  it("estimates string content message", () => {
    const msg: Message = { role: "user", content: "Hello world" };
    const tokens = estimateMessageTokens(msg);
    // ceil(11/4) = 3 + 4 overhead = 7
    expect(tokens).toBe(7);
  });

  it("includes per-message overhead", () => {
    const msg: Message = { role: "user", content: "" };
    // 0 content + 4 overhead
    expect(estimateMessageTokens(msg)).toBe(4);
  });

  it("estimates text content parts", () => {
    const msg: Message = {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
    };
    const tokens = estimateMessageTokens(msg);
    // ceil(5/4) = 2 + 4 overhead = 6
    expect(tokens).toBe(6);
  });

  it("estimates tool call parts", () => {
    const msg: Message = {
      role: "assistant",
      content: [
        {
          type: "tool_call",
          id: "tc1",
          name: "read_file",
          args: { path: "/foo/bar.ts" },
        },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    // name "read_file" = ceil(9/4) = 3
    // args JSON '{"path":"/foo/bar.ts"}' = ceil(21/4) = 6
    // + 4 overhead = 13
    expect(tokens).toBe(13);
  });

  it("estimates tool result parts", () => {
    const msg: Message = {
      role: "tool",
      content: [
        {
          type: "tool_result",
          toolCallId: "tc1",
          content: "file contents here",
        },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    // "file contents here" = ceil(18/4) = 5 + 4 overhead = 9
    expect(tokens).toBe(9);
  });

  it("sums multiple content parts", () => {
    const msg: Message = {
      role: "assistant",
      content: [
        { type: "text", text: "Here is the result:" },
        { type: "text", text: "Done" },
      ],
    };
    const tokens = estimateMessageTokens(msg);
    // ceil(19/4) = 5 + ceil(4/4) = 1 + 4 overhead = 10
    expect(tokens).toBe(10);
  });
});

describe("estimateConversationTokens", () => {
  it("returns 0 for empty array", () => {
    expect(estimateConversationTokens([])).toBe(0);
  });

  it("sums all message estimates", () => {
    const messages: Message[] = [
      { role: "system", content: "You are helpful." }, // ceil(16/4)=4 + 4 = 8
      { role: "user", content: "Hi" }, // ceil(2/4)=1 + 4 = 5
    ];
    expect(estimateConversationTokens(messages)).toBe(13);
  });

  it("handles a full conversation with tool calls", () => {
    const messages: Message[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "read foo" },
      {
        role: "assistant",
        content: [{ type: "tool_call", id: "t1", name: "read", args: { p: "foo" } }],
      },
      {
        role: "tool",
        content: [{ type: "tool_result", toolCallId: "t1", content: "bar" }],
      },
      { role: "assistant", content: "The file contains: bar" },
    ];
    const total = estimateConversationTokens(messages);
    expect(total).toBeGreaterThan(0);
    // Each message has at least 4 overhead tokens
    expect(total).toBeGreaterThanOrEqual(5 * 4);
  });
});
