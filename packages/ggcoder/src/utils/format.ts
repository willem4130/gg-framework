import chalk from "chalk";
import { formatUserError } from "./error-handler.js";

/**
 * Format tool call start for display.
 */
export function formatToolCallStart(name: string, args: Record<string, unknown>): string {
  const argsStr = formatArgs(name, args);
  return chalk.dim(`  ● ${name}${argsStr}`);
}

/**
 * Format tool call end for display.
 */
export function formatToolCallEnd(
  name: string,
  result: string,
  isError: boolean,
  durationMs: number,
): string {
  const duration = chalk.dim(`(${formatDuration(durationMs)})`);
  const summary = summarizeResult(name, result, isError);

  if (isError) {
    return chalk.red(`  ✗ ${name} ${duration} — ${summary}`);
  }
  return chalk.dim(`  ✓ ${name} ${duration} — ${summary}`);
}

/**
 * Format token usage for display.
 */
export function formatUsage(inputTokens: number, outputTokens: number): string {
  return chalk.dim(`  tokens: ${formatNumber(inputTokens)} in / ${formatNumber(outputTokens)} out`);
}

/**
 * Format an error for display.
 */
export function formatError(error: Error): string {
  return formatUserError(error);
}

/**
 * Format the welcome banner.
 */
export function formatWelcome(model: string, provider: string, cwd: string): string {
  const lines = [
    chalk.bold("ggcoder"),
    chalk.dim(`  model:    ${model}`),
    chalk.dim(`  provider: ${provider}`),
    chalk.dim(`  cwd:      ${cwd}`),
    "",
    chalk.dim("  Type your message and press Enter. Ctrl+D to exit."),
    "",
  ];
  return lines.join("\n");
}

// ── Helpers ──────────────────────────────────────────────────

function formatArgs(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "bash": {
      const cmd = String(args.command ?? "");
      const short = cmd.length > 80 ? cmd.slice(0, 77) + "..." : cmd;
      return ` ${chalk.dim(short)}`;
    }
    case "read":
    case "write":
    case "edit":
      return args.file_path ? ` ${chalk.dim(String(args.file_path))}` : "";
    case "find":
      return ` ${chalk.dim(String(args.pattern ?? ""))}`;
    case "grep":
      return ` ${chalk.dim(String(args.pattern ?? ""))}`;
    case "ls":
      return args.path ? ` ${chalk.dim(String(args.path))}` : "";
    default:
      return "";
  }
}

function summarizeResult(name: string, result: string, isError: boolean): string {
  if (isError) {
    const firstLine = result.split("\n")[0];
    return firstLine.length > 100 ? firstLine.slice(0, 97) + "..." : firstLine;
  }

  switch (name) {
    case "bash": {
      const match = result.match(/^Exit code: (.+)/);
      return match ? `exit ${match[1]}` : "done";
    }
    case "read": {
      const lines = result.split("\n").length;
      return `${lines} lines`;
    }
    case "write": {
      return result.split("\n")[0];
    }
    case "edit": {
      const added = (result.match(/^\+[^+]/gm) ?? []).length;
      const removed = (result.match(/^-[^-]/gm) ?? []).length;
      return `+${added} -${removed} lines`;
    }
    case "find": {
      const match = result.match(/(\d+) file\(s\) found/);
      return match ? `${match[1]} files` : "done";
    }
    case "grep": {
      const match = result.match(/(\d+) match\(es\) found/);
      return match ? `${match[1]} matches` : "done";
    }
    case "ls": {
      const lineCount = result.split("\n").length;
      return `${lineCount} entries`;
    }
    default:
      return "done";
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
