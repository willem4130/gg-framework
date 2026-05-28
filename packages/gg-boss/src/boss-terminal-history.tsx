import { renderToString } from "ink";
import React from "react";
import { AnimationProvider } from "@kenkaiiii/ggcoder/ui";
import { TerminalSizeProvider } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { ThemeContext, type Theme } from "@kenkaiiii/ggcoder/ui/theme";
import type { TerminalHistoryContext } from "@kenkaiiii/ggcoder/ui/terminal-history";
import {
  formatHistoryWrite,
  color,
  dim,
  indent,
  RESPONSE_LEFT_PADDING,
  wrapPlain,
} from "@kenkaiiii/ggcoder/ui/terminal-history-format";
import { shouldSeparateTranscriptItemKinds } from "@kenkaiiii/ggcoder/ui/transcript/spacing";
import type { BossDisplayItem, BossTranscriptItem } from "./boss-ui-items.js";
import { BossTranscriptRow } from "./boss-transcript-rows.js";
import { COLORS } from "./branding.js";

export interface BossTerminalHistoryPrinter {
  print(
    items: readonly BossDisplayItem[],
    context: TerminalHistoryContext,
    options?: { force?: boolean; write?: (data: string) => void },
  ): void;
  clear(): void;
  resetPrinted(): void;
  readonly printedIds: ReadonlySet<string>;
}

export interface BossTerminalHistoryPrinterOptions {
  stream?: NodeJS.WriteStream;
}

const BOSS_HISTORY_SPACING_KINDS = new Set<string>([
  "user",
  "assistant",
  "tool_start",
  "tool_done",
  "worker_event",
  "worker_error",
  "task_dispatch",
  "info",
  "update_notice",
  "compacting",
  "compacted",
  "stopped",
]);

export function createBossTerminalHistoryPrinter({
  stream = process.stdout,
}: BossTerminalHistoryPrinterOptions = {}): BossTerminalHistoryPrinter {
  const printed = new Set<string>();
  let previousPrintedKind: string | null = null;

  return {
    print(items, context, options) {
      const writeOutput = options?.write ?? ((data: string) => void stream.write(data));
      for (const item of items) {
        if (!options?.force && printed.has(item.id)) continue;
        const output = serializeBossItemToTerminalHistory(item, context);
        const formatted = formatHistoryWrite(output, {
          leadingSeparator: shouldSeparateTranscriptItemKinds({
            previousKind: previousPrintedKind ?? undefined,
            currentKind: item.kind,
            spacingKinds: BOSS_HISTORY_SPACING_KINDS,
          }),
          trailingBlankLine: false,
          trailingNewlines: item.kind === "user" ? 1 : undefined,
        });
        if (formatted.length === 0) continue;
        printed.add(item.id);
        writeOutput(formatted);
        previousPrintedKind = item.kind;
      }
    },
    clear() {
      printed.clear();
      previousPrintedKind = null;
    },
    resetPrinted() {
      printed.clear();
      previousPrintedKind = null;
    },
    get printedIds() {
      return printed;
    },
  };
}

export function serializeBossItemToTerminalHistory(
  item: BossDisplayItem,
  context: TerminalHistoryContext,
): string {
  switch (item.kind) {
    case "worker_event":
      return renderWorkerEvent(item, context.theme);
    case "worker_error":
      return renderWorkerError(item, context.theme);
    case "task_dispatch":
      return renderTaskDispatch(item, context.theme);
    default:
      return renderBossTranscriptItemToAnsi(item, context.theme);
  }
}

function renderBossTranscriptItemToAnsi(item: BossTranscriptItem, theme: Theme): string {
  return renderToString(
    <TerminalSizeProvider>
      <ThemeContext.Provider value={theme}>
        <AnimationProvider>
          <BossTranscriptRow row={item} />
        </AnimationProvider>
      </ThemeContext.Provider>
    </TerminalSizeProvider>,
  ).replace(/\n+$/u, "");
}

function renderWorkerEvent(
  item: Extract<BossDisplayItem, { kind: "worker_event" }>,
  theme: Theme,
): string {
  const failedCount = item.toolsUsed.filter((tool) => !tool.ok).length;
  const total = item.toolsUsed.length;
  const toolSummary =
    total === 0
      ? "no tools"
      : failedCount > 0
        ? `${total} tools (${failedCount} failed)`
        : `${total} tool${total === 1 ? "" : "s"}`;
  const header = `${RESPONSE_LEFT_PADDING}${color(failedCount > 0 ? theme.error : COLORS.accent, "●")} ${color(COLORS.primary, item.project, true)}${dim({ theme } as TerminalHistoryContext, `  turn ${item.turnIndex} · ${toolSummary}`)}`;
  const summary = item.finalText.replace(/\s+/g, " ").trim();
  return [header, summary ? indent(wrapPlain(summary, 100), "   ") : ""].filter(Boolean).join("\n");
}

function renderWorkerError(
  item: Extract<BossDisplayItem, { kind: "worker_error" }>,
  theme: Theme,
): string {
  const context = { theme } as TerminalHistoryContext;
  return `${RESPONSE_LEFT_PADDING}${color(theme.error, "●")} ${color(theme.error, item.project, true)}${dim(context, "  worker error")}\n${indent(color(theme.error, item.message), "   ")}`;
}

function renderTaskDispatch(
  item: Extract<BossDisplayItem, { kind: "task_dispatch" }>,
  theme: Theme,
): string {
  const count = item.tasks.length;
  const lines = [
    `${RESPONSE_LEFT_PADDING}${color(COLORS.primary, "●")} ${color(theme.text, `Running ${count} task${count === 1 ? "" : "s"}:`, true)}`,
  ];
  for (const task of item.tasks) {
    lines.push(
      `   • ${color(COLORS.primary, task.project, true)}${dim({ theme } as TerminalHistoryContext, ": ")}${color(theme.text, task.title)}`,
    );
  }
  return lines.join("\n");
}
