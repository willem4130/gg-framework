import type { Message, ContentPart, ToolResult } from "@kenkaiiii/gg-ai";

const CHARS_PER_TOKEN = 4;
const PER_MESSAGE_OVERHEAD = 4; // tokens

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

export function estimateMessageTokens(message: Message): number {
  let tokens = PER_MESSAGE_OVERHEAD;

  if (typeof message.content === "string") {
    tokens += estimateTokens(message.content);
  } else if (Array.isArray(message.content)) {
    for (const part of message.content) {
      if ("text" in part && typeof part.text === "string") {
        tokens += estimateTokens(part.text);
      } else if ("type" in part && part.type === "tool_call") {
        const tc = part as ContentPart & { type: "tool_call" };
        tokens += estimateTokens(tc.name);
        tokens += estimateTokens(JSON.stringify(tc.args));
      } else if ("type" in part && part.type === "tool_result") {
        const tr = part as unknown as ToolResult;
        tokens += estimateTokens(tr.content);
      }
    }
  }

  return tokens;
}

export function estimateConversationTokens(messages: Message[]): number {
  let total = 0;
  for (const msg of messages) {
    total += estimateMessageTokens(msg);
  }
  return total;
}
