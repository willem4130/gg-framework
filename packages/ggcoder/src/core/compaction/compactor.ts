import {
  stream,
  type Message,
  type Provider,
  type ContentPart,
  type ToolResult,
} from "@kenkaiiii/gg-ai";
import { estimateConversationTokens, estimateMessageTokens } from "./token-estimator.js";
import { getSummaryModel } from "../model-registry.js";
import { log } from "../logger.js";

/** Max chars per tool result when building the summary prompt. */
const TOOL_RESULT_SUMMARY_MAX_CHARS = 2000;

export interface CompactionResult {
  originalCount: number;
  newCount: number;
  tokensBeforeEstimate: number;
  tokensAfterEstimate: number;
}

/**
 * Check if compaction should be triggered.
 */
export function shouldCompact(
  messages: Message[],
  contextWindow: number,
  threshold = 0.8,
): boolean {
  const estimated = estimateConversationTokens(messages);
  const limit = contextWindow * threshold;
  log("INFO", "compaction", `Context check: ${estimated} estimated tokens, threshold ${limit}`);
  return estimated > limit;
}

/**
 * Find the index where recent messages should start, given a token budget.
 * Walks backward from the end, accumulating token estimates, and returns the
 * first index that fits within the budget. Never cuts at index 0 (system message).
 * Avoids splitting tool_call / tool_result pairs.
 */
export function findRecentCutPoint(messages: Message[], tokenBudget: number): number {
  if (messages.length <= 1) return messages.length;

  let accumulated = 0;
  let cutIndex = messages.length;

  // Walk backwards from the last message
  for (let i = messages.length - 1; i >= 1; i--) {
    const tokens = estimateMessageTokens(messages[i]);
    if (accumulated + tokens > tokenBudget) {
      break;
    }
    accumulated += tokens;
    cutIndex = i;
  }

  // Don't split tool_call and tool_result pairs:
  // If cut lands on a tool result message, back up to include the preceding assistant
  if (cutIndex < messages.length && messages[cutIndex].role === "tool") {
    // Back up to find the assistant message with the tool_call
    if (cutIndex > 1) {
      cutIndex--;
    }
  }

  // Never cut before index 1 (preserve system message at 0)
  return Math.max(1, cutIndex);
}

/**
 * Truncate a string for summary purposes.
 */
function truncateForSummary(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const truncatedChars = text.length - maxChars;
  return `${text.slice(0, maxChars)}\n\n[... ${truncatedChars} more characters truncated]`;
}

/**
 * Extract file paths from tool calls in assistant messages for tracking.
 */
function extractFileOperations(messages: Message[]): { read: Set<string>; modified: Set<string> } {
  const read = new Set<string>();
  const modified = new Set<string>();

  for (const msg of messages) {
    if (msg.role !== "assistant") continue;
    if (typeof msg.content === "string") continue;
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content as ContentPart[]) {
      if (!("type" in part) || part.type !== "tool_call") continue;
      const tc = part as ContentPart & {
        type: "tool_call";
        name: string;
        args: Record<string, unknown>;
      };
      const filePath = tc.args.file_path ?? tc.args.path ?? tc.args.file;
      if (typeof filePath !== "string") continue;

      if (tc.name === "read" || tc.name === "grep" || tc.name === "find") {
        read.add(filePath);
      } else if (tc.name === "write" || tc.name === "edit") {
        modified.add(filePath);
      }
    }
  }

  return { read, modified };
}

/**
 * Serialize a message for the summary prompt, truncating tool results.
 */
function serializeMessageForSummary(msg: Message): string {
  const role = msg.role;

  if (typeof msg.content === "string") {
    return `[${role}]: ${truncateForSummary(msg.content, TOOL_RESULT_SUMMARY_MAX_CHARS)}`;
  }

  if (!Array.isArray(msg.content)) {
    return `[${role}]: ${truncateForSummary(JSON.stringify(msg.content), TOOL_RESULT_SUMMARY_MAX_CHARS)}`;
  }

  // Handle tool result messages (role === "tool")
  if (role === "tool") {
    const results = msg.content as ToolResult[];
    const parts = results.map(
      (tr) => `[tool_result: ${truncateForSummary(tr.content, TOOL_RESULT_SUMMARY_MAX_CHARS)}]`,
    );
    return `[${role}]: ${parts.join("\n")}`;
  }

  // For ContentPart[] (assistant messages with tool calls, etc.)
  const parts: string[] = [];
  for (const part of msg.content as ContentPart[]) {
    if ("text" in part && typeof part.text === "string") {
      parts.push(truncateForSummary(part.text, TOOL_RESULT_SUMMARY_MAX_CHARS));
    } else if ("type" in part && part.type === "tool_call") {
      const tc = part as ContentPart & {
        type: "tool_call";
        name: string;
        args: Record<string, unknown>;
      };
      parts.push(`[tool_call: ${tc.name}(${truncateForSummary(JSON.stringify(tc.args), 500)})]`);
    } else {
      parts.push(truncateForSummary(JSON.stringify(part), 500));
    }
  }

  return `[${role}]: ${parts.join("\n")}`;
}

/** Budget of recent tokens to keep un-summarized (~20K tokens). */
const KEEP_RECENT_TOKENS = 20_000;

/**
 * Compact a conversation by summarizing older messages via LLM.
 *
 * - Keeps the system message (index 0) intact.
 * - Keeps the most recent ~20K tokens of conversation intact.
 * - Summarizes everything in between using an appropriate model
 *   (Sonnet for Anthropic, Codex Mini for OpenAI, current model for others).
 * - Tool results are truncated to 2K chars in the summary prompt so the
 *   summarization call itself doesn't blow up.
 */
export async function compact(
  messages: Message[],
  options: {
    provider: Provider;
    model: string;
    apiKey?: string;
    contextWindow: number;
    signal?: AbortSignal;
  },
): Promise<{ messages: Message[]; result: CompactionResult }> {
  const originalCount = messages.length;
  const tokensBeforeEstimate = estimateConversationTokens(messages);

  log("INFO", "compaction", `Starting compaction`, {
    messageCount: String(originalCount),
    estimatedTokens: String(tokensBeforeEstimate),
    contextWindow: String(options.contextWindow),
  });

  // Find the cut point — keep ~20K tokens of recent conversation
  const systemMessage = messages[0];
  const recentStart = findRecentCutPoint(messages, KEEP_RECENT_TOKENS);
  const recentMessages = messages.slice(recentStart);
  const middleMessages = messages.slice(1, recentStart);

  // If there's nothing to compact, return as-is
  if (middleMessages.length <= 2) {
    log("INFO", "compaction", `Skipping compaction — too few messages to summarize`, {
      middleMessages: String(middleMessages.length),
      recentStart: String(recentStart),
      totalMessages: String(messages.length),
    });
    return {
      messages: [...messages],
      result: {
        originalCount,
        newCount: messages.length,
        tokensBeforeEstimate,
        tokensAfterEstimate: tokensBeforeEstimate,
      },
    };
  }

  // Track file operations from the messages being summarized
  const fileOps = extractFileOperations(middleMessages);

  // Build summary request with truncated tool results
  const summaryContent = middleMessages.map((m) => serializeMessageForSummary(m)).join("\n\n");

  // Build file tracking section
  let fileTrackingSection = "";
  if (fileOps.read.size > 0 || fileOps.modified.size > 0) {
    const parts: string[] = [];
    if (fileOps.read.size > 0) {
      parts.push(`<read-files>\n${[...fileOps.read].join("\n")}\n</read-files>`);
    }
    if (fileOps.modified.size > 0) {
      parts.push(`<modified-files>\n${[...fileOps.modified].join("\n")}\n</modified-files>`);
    }
    fileTrackingSection = "\n\n" + parts.join("\n");
  }

  // Pick the appropriate model for summarization
  const summaryModel = getSummaryModel(options.provider, options.model);

  log("INFO", "compaction", `Summarizing ${middleMessages.length} messages`, {
    summaryPromptChars: String(summaryContent.length),
    summaryModel: summaryModel.id,
    filesRead: String(fileOps.read.size),
    filesModified: String(fileOps.modified.size),
    recentKept: String(recentMessages.length),
  });

  const summaryPrompt =
    `Summarize the following conversation segment concisely. ` +
    `Focus on: key decisions made, files read and modified, tool results, and important context needed to continue the conversation. ` +
    `Use this format:\n` +
    `## Goal\n<what the user is trying to accomplish>\n` +
    `## Progress\n<what has been done so far>\n` +
    `## Key Decisions\n<important choices made>\n` +
    `## Files Touched\n<files that were read or modified>\n` +
    `## Next Steps\n<what remains to be done>\n\n` +
    `Be factual and brief.\n\n${summaryContent}`;

  const summaryMessages: Message[] = [{ role: "user", content: summaryPrompt }];

  const result = stream({
    provider: options.provider,
    model: summaryModel.id,
    messages: summaryMessages,
    maxTokens: 2048,
    apiKey: options.apiKey,
    signal: options.signal,
  });

  const response = await result.response;
  const summaryText =
    typeof response.message.content === "string"
      ? response.message.content
      : response.message.content
          .filter((p) => p.type === "text")
          .map((p) => (p as { text: string }).text)
          .join("");

  log("INFO", "compaction", `Summary generated`, {
    summaryChars: String(summaryText.length),
  });

  // Build new messages array
  const summaryMessage: Message = {
    role: "user",
    content: `[Previous conversation summary]\n\n${summaryText}${fileTrackingSection}`,
  };

  const newMessages: Message[] = [
    systemMessage,
    summaryMessage,
    {
      role: "assistant",
      content:
        "I understand. I have the context from our previous conversation. How can I help you continue?",
    },
    ...recentMessages,
  ];

  const tokensAfterEstimate = estimateConversationTokens(newMessages);
  const reduction = Math.round((1 - tokensAfterEstimate / tokensBeforeEstimate) * 100);

  log("INFO", "compaction", `Compaction complete`, {
    originalMessages: String(originalCount),
    newMessages: String(newMessages.length),
    tokensBefore: String(tokensBeforeEstimate),
    tokensAfter: String(tokensAfterEstimate),
    reduction: `${reduction}%`,
  });

  return {
    messages: newMessages,
    result: {
      originalCount,
      newCount: newMessages.length,
      tokensBeforeEstimate,
      tokensAfterEstimate,
    },
  };
}
