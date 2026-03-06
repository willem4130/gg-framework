import {
  stream,
  EventStream,
  type Message,
  type ToolCall,
  type ToolResult,
  type Usage,
  type ContentPart,
  type AssistantMessage,
} from "@kenkaiiii/gg-ai";
import type {
  AgentEvent,
  AgentOptions,
  AgentResult,
  AgentTool,
  ToolContext,
  ToolExecuteResult,
  StructuredToolResult,
} from "./types.js";

const DEFAULT_MAX_TURNS = 40;

/**
 * Detect context window overflow errors from LLM providers.
 * Anthropic: "prompt is too long: N tokens > M maximum"
 * OpenAI:    "context_length_exceeded" / "maximum context length"
 */
export function isContextOverflow(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return (
    msg.includes("prompt is too long") ||
    msg.includes("context_length_exceeded") ||
    msg.includes("maximum context length") ||
    (msg.includes("token") && msg.includes("exceed"))
  );
}

export async function* agentLoop(
  messages: Message[],
  options: AgentOptions,
): AsyncGenerator<AgentEvent, AgentResult> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const toolMap = new Map<string, AgentTool>((options.tools ?? []).map((t) => [t.name, t]));

  const totalUsage: Usage = { inputTokens: 0, outputTokens: 0 };
  let turn = 0;
  let overflowRetried = false;

  while (turn < maxTurns) {
    options.signal?.throwIfAborted();
    turn++;

    // ── Mid-loop context transform (compaction / truncation) ──
    if (options.transformContext) {
      const transformed = await options.transformContext(messages);
      if (transformed !== messages) {
        messages.length = 0;
        messages.push(...transformed);
      }
    }

    // ── Call LLM with overflow recovery ──
    let response;
    try {
      const result = stream({
        provider: options.provider,
        model: options.model,
        messages,
        tools: options.tools,
        serverTools: options.serverTools,
        maxTokens: options.maxTokens,
        temperature: options.temperature,
        thinking: options.thinking,
        apiKey: options.apiKey,
        baseUrl: options.baseUrl,
        signal: options.signal,
        accountId: options.accountId,
      });

      // Suppress unhandled rejection if the iterator path throws first
      result.response.catch(() => {});

      // Forward streaming deltas
      for await (const event of result) {
        if (event.type === "text_delta") {
          yield { type: "text_delta" as const, text: event.text };
        } else if (event.type === "thinking_delta") {
          yield { type: "thinking_delta" as const, text: event.text };
        } else if (event.type === "server_toolcall") {
          yield {
            type: "server_tool_call" as const,
            id: event.id,
            name: event.name,
            input: event.input,
          };
        } else if (event.type === "server_toolresult") {
          yield {
            type: "server_tool_result" as const,
            toolUseId: event.toolUseId,
            resultType: event.resultType,
            data: event.data,
          };
        }
      }

      response = await result.response;
    } catch (err) {
      // Context overflow: compact via transformContext and retry once
      if (!overflowRetried && isContextOverflow(err) && options.transformContext) {
        overflowRetried = true;
        const transformed = await options.transformContext(messages);
        if (transformed !== messages) {
          messages.length = 0;
          messages.push(...transformed);
        }
        turn--; // Don't count the failed turn
        continue;
      }
      throw err;
    }

    // Reset overflow flag after successful call
    overflowRetried = false;

    // Accumulate usage
    totalUsage.inputTokens += response.usage.inputTokens;
    totalUsage.outputTokens += response.usage.outputTokens;

    // Append assistant message to conversation
    messages.push(response.message);

    yield {
      type: "turn_end" as const,
      turn,
      stopReason: response.stopReason,
      usage: response.usage,
    };

    // If not tool_use, we're done
    if (response.stopReason !== "tool_use") {
      yield {
        type: "agent_done" as const,
        totalTurns: turn,
        totalUsage: { ...totalUsage },
      };
      return {
        message: response.message,
        totalTurns: turn,
        totalUsage: { ...totalUsage },
      };
    }

    // Extract and execute tool calls in parallel
    const toolCalls = extractToolCalls(response.message.content);
    const toolResults: ToolResult[] = [];
    const eventStream = new EventStream<AgentEvent>();

    // Launch all tool calls in parallel
    const executions = toolCalls.map(async (toolCall) => {
      const startTime = Date.now();

      eventStream.push({
        type: "tool_call_start" as const,
        toolCallId: toolCall.id,
        name: toolCall.name,
        args: toolCall.args,
      });

      let resultContent: string;
      let details: unknown;
      let isError = false;

      const tool = toolMap.get(toolCall.name);
      if (!tool) {
        resultContent = `Unknown tool: ${toolCall.name}`;
        isError = true;
      } else {
        try {
          const parsed = tool.parameters.parse(toolCall.args);
          const ctx: ToolContext = {
            signal: options.signal ?? AbortSignal.timeout(300_000),
            toolCallId: toolCall.id,
            onUpdate: (update: unknown) => {
              eventStream.push({
                type: "tool_call_update" as const,
                toolCallId: toolCall.id,
                update,
              });
            },
          };
          const raw = await tool.execute(parsed, ctx);
          const normalized = normalizeToolResult(raw);
          resultContent = normalized.content;
          details = normalized.details;
        } catch (err) {
          isError = true;
          resultContent = err instanceof Error ? err.message : String(err);
        }
      }

      const durationMs = Date.now() - startTime;

      eventStream.push({
        type: "tool_call_end" as const,
        toolCallId: toolCall.id,
        result: resultContent,
        details,
        isError,
        durationMs,
      });

      return { toolCallId: toolCall.id, content: resultContent, isError };
    });

    // Close event stream when all tools complete
    Promise.all(executions)
      .then((results) => {
        for (const tc of toolCalls) {
          const r = results.find((x) => x.toolCallId === tc.id)!;
          toolResults.push({
            type: "tool_result",
            toolCallId: tc.id,
            content: r.content,
            isError: r.isError || undefined,
          });
        }
        eventStream.close();
      })
      .catch((err) => eventStream.abort(err instanceof Error ? err : new Error(String(err))));

    // Yield events as they arrive from parallel tools
    for await (const event of eventStream) {
      yield event;
    }

    // Push tool results back into conversation
    messages.push({ role: "tool", content: toolResults });
  }

  // Exceeded max turns — return last assistant message
  let lastAssistant: AssistantMessage | undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i]!.role === "assistant") {
      lastAssistant = messages[i] as AssistantMessage;
      break;
    }
  }

  yield {
    type: "agent_done" as const,
    totalTurns: turn,
    totalUsage: { ...totalUsage },
  };

  return {
    message: lastAssistant ?? { role: "assistant" as const, content: [] },
    totalTurns: turn,
    totalUsage: { ...totalUsage },
  };
}

function normalizeToolResult(raw: ToolExecuteResult): StructuredToolResult {
  return typeof raw === "string" ? { content: raw } : raw;
}

function extractToolCalls(content: string | ContentPart[]): ToolCall[] {
  if (typeof content === "string") return [];
  return content.filter((part): part is ToolCall => part.type === "tool_call");
}
