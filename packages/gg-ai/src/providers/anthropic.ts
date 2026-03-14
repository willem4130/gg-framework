import Anthropic from "@anthropic-ai/sdk";
import type {
  ContentPart,
  ServerToolCall,
  ServerToolResult,
  StreamOptions,
  StreamResponse,
  ToolCall,
} from "../types.js";
import { ProviderError } from "../errors.js";
import { StreamResult } from "../utils/event-stream.js";
import {
  normalizeAnthropicStopReason,
  toAnthropicCacheControl,
  toAnthropicMessages,
  toAnthropicThinking,
  toAnthropicToolChoice,
  toAnthropicTools,
} from "./transform.js";

export function streamAnthropic(options: StreamOptions): StreamResult {
  const result = new StreamResult();
  runStream(options, result).catch((err) => result.abort(toError(err)));
  return result;
}

async function runStream(options: StreamOptions, result: StreamResult): Promise<void> {
  const isOAuth = options.apiKey?.startsWith("sk-ant-oat");

  const client = new Anthropic({
    ...(isOAuth
      ? { apiKey: null as unknown as string, authToken: options.apiKey }
      : { apiKey: options.apiKey }),
    ...(options.baseUrl ? { baseURL: options.baseUrl } : {}),
    ...(isOAuth
      ? {
          defaultHeaders: {
            "user-agent": "claude-cli/2.1.75",
            "x-app": "cli",
          },
        }
      : {}),
  });

  const cacheControl = toAnthropicCacheControl(options.cacheRetention, options.baseUrl);
  const { system: rawSystem, messages } = toAnthropicMessages(options.messages, cacheControl);

  // OAuth tokens require Claude Code identity in the system prompt
  const system = isOAuth
    ? [
        { type: "text" as const, text: "You are Claude Code, Anthropic's official CLI for Claude." },
        ...(rawSystem ?? []),
      ]
    : rawSystem;

  let maxTokens = options.maxTokens ?? 4096;
  let thinking: Anthropic.ThinkingConfigParam | undefined;
  let outputConfig: Record<string, unknown> | undefined;

  if (options.thinking) {
    const t = toAnthropicThinking(options.thinking, maxTokens, options.model);
    thinking = t.thinking;
    maxTokens = t.maxTokens;
    if (t.outputConfig) {
      outputConfig = t.outputConfig;
    }
  }

  const params: Anthropic.MessageCreateParams = {
    model: options.model,
    max_tokens: maxTokens,
    messages,
    ...(system ? { system: system as Anthropic.MessageCreateParams["system"] } : {}),
    ...(thinking ? { thinking } : {}),
    ...(outputConfig
      ? { output_config: outputConfig as unknown as Anthropic.MessageCreateParams["output_config"] }
      : {}),
    ...(options.temperature != null && !thinking ? { temperature: options.temperature } : {}),
    ...(options.topP != null ? { top_p: options.topP } : {}),
    ...(options.stop ? { stop_sequences: options.stop } : {}),
    ...(options.tools?.length || options.serverTools?.length || options.webSearch
      ? {
          tools: [
            ...(options.tools?.length ? toAnthropicTools(options.tools) : []),
            ...(options.serverTools ?? []),
            ...(options.webSearch ? [{ type: "web_search_20250305", name: "web_search" }] : []),
          ] as Anthropic.MessageCreateParams["tools"],
        }
      : {}),
    ...(options.toolChoice && options.tools?.length
      ? { tool_choice: toAnthropicToolChoice(options.toolChoice) }
      : {}),
    ...(options.compaction
      ? { context_management: { edits: [{ type: "compact_20260112" }] } }
      : {}),
    stream: true,
  } as Anthropic.MessageCreateParams;

  const betaHeaders = [
    ...(isOAuth ? ["claude-code-20250219", "oauth-2025-04-20"] : []),
    ...(options.compaction ? ["compact-2026-01-12"] : []),
  ];

  const stream = client.messages.stream(params, {
    signal: options.signal ?? undefined,
    ...(betaHeaders.length ? { headers: { "anthropic-beta": betaHeaders.join(",") } } : {}),
  });

  const contentParts: ContentPart[] = [];
  // Track the current tool call being streamed (by content block index)
  let currentToolId = "";
  let currentToolName = "";

  stream.on("text", (text) => {
    result.push({ type: "text_delta", text });
  });

  stream.on("thinking", (thinkingDelta) => {
    result.push({ type: "thinking_delta", text: thinkingDelta });
  });

  stream.on("streamEvent", (event) => {
    if (event.type === "content_block_start") {
      // When a new tool_use content block starts, capture its id and name
      if (event.content_block.type === "tool_use") {
        currentToolId = event.content_block.id;
        currentToolName = event.content_block.name;
      }
      // Track server_tool_use blocks
      if (event.content_block.type === "server_tool_use") {
        currentToolId = event.content_block.id;
        currentToolName = event.content_block.name;
      }
    }
  });

  stream.on("inputJson", (delta) => {
    result.push({
      type: "toolcall_delta",
      id: currentToolId,
      name: currentToolName,
      argsJson: delta,
    });
  });

  stream.on("contentBlock", (block) => {
    if (block.type === "text") {
      contentParts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking") {
      contentParts.push({ type: "thinking", text: block.thinking, signature: block.signature });
    } else if (block.type === "tool_use") {
      const tc: ToolCall = {
        type: "tool_call",
        id: block.id,
        name: block.name,
        args: block.input as Record<string, unknown>,
      };
      contentParts.push(tc);
      result.push({
        type: "toolcall_done",
        id: tc.id,
        name: tc.name,
        args: tc.args,
      });
    } else if (block.type === "server_tool_use") {
      const stc: ServerToolCall = {
        type: "server_tool_call",
        id: block.id,
        name: block.name,
        input: block.input,
      };
      contentParts.push(stc);
      result.push({
        type: "server_toolcall",
        id: stc.id,
        name: stc.name,
        input: stc.input,
      });
    } else {
      const raw = block as unknown as Record<string, unknown>;
      const blockType = raw.type as string;
      if (blockType === "web_search_tool_result") {
        // Server tool result blocks
        const str: ServerToolResult = {
          type: "server_tool_result",
          toolUseId: raw.tool_use_id as string,
          resultType: blockType,
          data: raw,
        };
        contentParts.push(str);
        result.push({
          type: "server_toolresult",
          toolUseId: str.toolUseId,
          resultType: str.resultType,
          data: str.data,
        });
      } else {
        // Preserve unknown blocks (e.g. compaction) for round-tripping
        contentParts.push({ type: "raw", data: raw });
      }
    }
  });

  try {
    const finalMessage = await stream.finalMessage();
    const stopReason = normalizeAnthropicStopReason(finalMessage.stop_reason);

    const response: StreamResponse = {
      message: {
        role: "assistant",
        content: contentParts.length > 0 ? contentParts : "",
      },
      stopReason,
      usage: {
        inputTokens: finalMessage.usage.input_tokens,
        outputTokens: finalMessage.usage.output_tokens,
        ...((finalMessage.usage as unknown as Record<string, unknown>).cache_read_input_tokens !=
          null && {
          cacheRead: (finalMessage.usage as unknown as Record<string, unknown>)
            .cache_read_input_tokens as number,
        }),
        ...((finalMessage.usage as unknown as Record<string, unknown>)
          .cache_creation_input_tokens != null && {
          cacheWrite: (finalMessage.usage as unknown as Record<string, unknown>)
            .cache_creation_input_tokens as number,
        }),
      },
    };

    result.push({ type: "done", stopReason });
    result.complete(response);
  } catch (err) {
    const error = toError(err);
    result.push({ type: "error", error });
    result.abort(error);
  }
}

function toError(err: unknown): ProviderError {
  if (err instanceof Anthropic.APIError) {
    return new ProviderError("anthropic", err.message, {
      statusCode: err.status,
      cause: err,
    });
  }
  if (err instanceof Error) {
    return new ProviderError("anthropic", err.message, { cause: err });
  }
  return new ProviderError("anthropic", String(err));
}
