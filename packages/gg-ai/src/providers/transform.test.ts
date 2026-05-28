import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  toAnthropicMessages,
  toAnthropicThinking,
  toAnthropicTools,
  toOpenAIMessages,
  toOpenAIReasoningEffort,
} from "./transform.js";
import type { Message, Tool } from "../types.js";

const exampleTools: Tool[] = [
  {
    name: "read_file",
    description: "Read a file.",
    parameters: z.object({ filePath: z.string() }),
  },
  {
    name: "write_file",
    description: "Write a file.",
    parameters: z.object({ filePath: z.string(), content: z.string() }),
  },
];

const MAX_TOKENS = 16_000;

describe("Anthropic transform", () => {
  it("splits system prompt into cached and uncached blocks at the marker", () => {
    const cacheControl = { type: "ephemeral" as const };
    const messages: Message[] = [
      {
        role: "system",
        content: "Stable prompt\n\n<!-- uncached -->\nToday's date: 17 May 2026",
      },
      { role: "user", content: "Hello" },
    ];

    const result = toAnthropicMessages(messages, cacheControl);

    expect(result.system).toEqual([
      { type: "text", text: "Stable prompt", cache_control: cacheControl },
      { type: "text", text: "Today's date: 17 May 2026" },
    ]);
    expect(result.messages).toEqual([
      {
        role: "user",
        content: [{ type: "text", text: "Hello", cache_control: cacheControl }],
      },
    ]);
  });

  it("leaves the date block uncached when Anthropic cache control is enabled", () => {
    const result = toAnthropicMessages(
      [
        {
          role: "system",
          content: "Reusable prefix\n<!-- uncached -->\nToday's date: 17 May 2026",
        },
      ],
      { type: "ephemeral" },
    );

    expect(result.system).toHaveLength(2);
    expect(result.system?.[0]).toHaveProperty("cache_control");
    expect(result.system?.[1]).not.toHaveProperty("cache_control");
    expect(result.system?.[1]?.text).toBe("Today's date: 17 May 2026");
  });

  it("adds cache_control only to the last tool definition", () => {
    const tools = toAnthropicTools(exampleTools, {
      cacheControl: { type: "ephemeral" },
    }) as unknown as Array<Record<string, unknown>>;

    expect(tools).toHaveLength(2);
    expect(tools[0]?.cache_control).toBeUndefined();
    expect(tools[1]?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("adds eager_input_streaming when fine-grained tool streaming is enabled", () => {
    const tools = toAnthropicTools(exampleTools, {
      cacheControl: { type: "ephemeral" },
      enableFineGrainedToolStreaming: true,
    }) as unknown as Array<Record<string, unknown>>;

    expect(tools.map((tool) => tool.eager_input_streaming)).toEqual([true, true]);
  });
});

describe("OpenAI transform", () => {
  it("keeps the whole system prompt literal, including the uncached marker", () => {
    const content = "Stable prompt\n\n<!-- uncached -->\nToday's date: 17 May 2026";
    const messages: Message[] = [
      { role: "system", content },
      { role: "user", content: "Hello" },
    ];

    expect(toOpenAIMessages(messages)).toEqual([
      { role: "system", content },
      { role: "user", content: "Hello" },
    ]);
  });
});

describe("toAnthropicThinking", () => {
  it("passes Anthropic adaptive effort levels through for Claude Opus 4.8", () => {
    for (const level of ["low", "medium", "high", "xhigh", "max"] as const) {
      expect(toAnthropicThinking(level, MAX_TOKENS, "claude-opus-4-8").outputConfig).toEqual({
        effort: level,
      });
    }
  });

  it("clamps xhigh to high on adaptive Anthropic models that do not support xhigh", () => {
    expect(toAnthropicThinking("xhigh", MAX_TOKENS, "claude-sonnet-4-6").outputConfig).toEqual({
      effort: "high",
    });
    expect(toAnthropicThinking("max", MAX_TOKENS, "claude-sonnet-4-6").outputConfig).toEqual({
      effort: "max",
    });
  });
});

describe("toOpenAIReasoningEffort", () => {
  it("clamps shared max thinking level to OpenAI's xhigh effort", () => {
    expect(toOpenAIReasoningEffort("max", "gpt-5.5")).toBe("xhigh");
  });
});
