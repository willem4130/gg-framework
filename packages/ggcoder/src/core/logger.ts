import fs from "node:fs";
import type { EventBus } from "./event-bus.js";

type LogLevel = "INFO" | "ERROR" | "WARN";

let fd: number | null = null;
let unsubscribers: (() => void)[] = [];

/**
 * Initialize the debug logger. Opens the log file with truncation ('w' mode)
 * and writes a startup header. No-op if already initialized.
 */
export function initLogger(
  filePath: string,
  meta?: { version?: string; provider?: string; model?: string; thinking?: string },
): void {
  if (fd !== null) return;
  try {
    fd = fs.openSync(filePath, "w");
  } catch {
    // Can't open log file — silently disable logging
    return;
  }
  const parts = ["ggcoder"];
  if (meta?.version) parts[0] += ` v${meta.version}`;
  parts.push("started");
  if (meta?.provider) parts.push(`provider=${meta.provider}`);
  if (meta?.model) parts.push(`model=${meta.model}`);
  if (meta?.thinking) parts.push(`thinking=${meta.thinking}`);
  log("INFO", "startup", parts.join(" "));
}

/**
 * Write a timestamped log line. No-op if logger is not initialized.
 */
export function log(
  level: LogLevel,
  category: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  if (fd === null) return;
  const ts = new Date().toISOString();
  let line = `[${ts}] [${level}] [${category}] ${message}`;
  if (data) {
    const pairs = Object.entries(data)
      .map(([k, v]) => `${k}=${typeof v === "string" ? v : JSON.stringify(v)}`)
      .join(" ");
    line += ` ${pairs}`;
  }
  line += "\n";
  try {
    fs.writeSync(fd, line);
  } catch {
    // Write failed — don't crash
  }
}

/**
 * Subscribe to EventBus events and log them. Used by print/json modes.
 */
export function attachToEventBus(bus: EventBus): void {
  const unsubs: (() => void)[] = [];

  unsubs.push(
    bus.on("tool_call_start", ({ toolCallId, name }) => {
      log("INFO", "tool", `Tool call started: ${name}`, { id: toolCallId });
    }),
  );

  unsubs.push(
    bus.on("tool_call_end", ({ toolCallId, result: _result, isError, durationMs }) => {
      const level: LogLevel = isError ? "ERROR" : "INFO";
      log(level, "tool", `Tool call ended`, {
        id: toolCallId,
        duration: `${durationMs}ms`,
        isError: String(isError),
      });
    }),
  );

  unsubs.push(
    bus.on("turn_end", ({ turn, stopReason, usage }) => {
      log("INFO", "turn", `Turn ${turn} ended`, {
        stopReason,
        inputTokens: String(usage.inputTokens),
        outputTokens: String(usage.outputTokens),
        ...(usage.cacheRead != null && { cacheRead: String(usage.cacheRead) }),
        ...(usage.cacheWrite != null && { cacheWrite: String(usage.cacheWrite) }),
      });
    }),
  );

  unsubs.push(
    bus.on("agent_done", ({ totalTurns, totalUsage }) => {
      log("INFO", "agent", `Agent done`, {
        totalTurns: String(totalTurns),
        inputTokens: String(totalUsage.inputTokens),
        outputTokens: String(totalUsage.outputTokens),
        ...(totalUsage.cacheRead != null && { cacheRead: String(totalUsage.cacheRead) }),
        ...(totalUsage.cacheWrite != null && { cacheWrite: String(totalUsage.cacheWrite) }),
      });
    }),
  );

  unsubs.push(
    bus.on("error", ({ error }) => {
      log("ERROR", "error", error.message);
    }),
  );

  unsubs.push(
    bus.on("session_start", ({ sessionId }) => {
      log("INFO", "session", `Session started`, { sessionId });
    }),
  );

  unsubs.push(
    bus.on("model_change", ({ provider, model }) => {
      log("INFO", "model", `Model changed`, { provider, model });
    }),
  );

  unsubs.push(
    bus.on("compaction_start", ({ messageCount }) => {
      log("INFO", "compaction", `Compaction started`, { messageCount: String(messageCount) });
    }),
  );

  unsubs.push(
    bus.on("compaction_end", ({ originalCount, newCount }) => {
      log("INFO", "compaction", `Compaction ended`, {
        originalCount: String(originalCount),
        newCount: String(newCount),
      });
    }),
  );

  unsubs.push(
    bus.on("user_input", ({ content }) => {
      const truncated = content.length > 100 ? content.slice(0, 100) + "..." : content;
      log("INFO", "input", `User input: ${truncated}`);
    }),
  );

  unsubs.push(
    bus.on("slash_command", ({ name, args }) => {
      log("INFO", "command", `Slash command: /${name}${args ? ` ${args}` : ""}`);
    }),
  );

  unsubscribers.push(...unsubs);
}

/**
 * Write a shutdown line, close the file descriptor, and clean up subscriptions.
 */
export function closeLogger(): void {
  if (fd === null) return;
  log("INFO", "shutdown", "ggcoder shutting down");
  try {
    fs.closeSync(fd);
  } catch {
    // Ignore close errors
  }
  fd = null;
  for (const unsub of unsubscribers) {
    unsub();
  }
  unsubscribers = [];
}
