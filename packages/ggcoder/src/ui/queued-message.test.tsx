import React from "react";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import stringWidth from "string-width";
import {
  createTerminalHistoryPrinter,
  serializeCompletedItemToTerminalHistory,
} from "./terminal-history.js";
import { isActiveItem, type CompletedItem } from "./App.js";
import { loadTheme, ThemeContext } from "./theme/theme.js";
import { TerminalSizeProvider } from "./hooks/useTerminalSize.js";
import type { Theme } from "./theme/theme.js";
import { Text, Box } from "ink";

const TERMINAL_COLUMNS = 68;
const theme = loadTheme("dark");
const context = {
  theme,
  columns: TERMINAL_COLUMNS,
  version: "test",
  model: "test-model",
  provider: "anthropic" as const,
  cwd: "/tmp/test",
};

function queuedItem(overrides: Partial<Extract<CompletedItem, { kind: "queued" }>> = {}) {
  return {
    kind: "queued" as const,
    text: "follow-up prompt with enough words to prove wrapping stays in the same response gutter",
    id: "queued-1",
    ...overrides,
  };
}

function renderQueuedLiveItem(item: Extract<CompletedItem, { kind: "queued" }>, itemTheme: Theme) {
  const suffix = item.imageCount
    ? ` (+${item.imageCount} image${item.imageCount > 1 ? "s" : ""})`
    : "";
  return (
    <Box flexDirection="row" paddingLeft={1} marginTop={1} flexShrink={1}>
      <Box width={2} flexShrink={0}>
        <Text color={itemTheme.warning} bold>
          {"• "}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text color={itemTheme.text} wrap="wrap">
          <Text color={itemTheme.textDim}>Queued: </Text>
          {item.text || "(empty)"}
          {suffix}
        </Text>
      </Box>
    </Box>
  );
}

function cleanLines(value: string): string[] {
  return stripAnsi(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.length > 0);
}

function renderLiveQueuedLines(item: Extract<CompletedItem, { kind: "queued" }>): string[] {
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;
  process.stdout.columns = TERMINAL_COLUMNS;
  process.stdout.rows = 20;
  try {
    return cleanLines(
      renderToString(
        <ThemeContext.Provider value={theme}>
          <TerminalSizeProvider>{renderQueuedLiveItem(item, theme)}</TerminalSizeProvider>
        </ThemeContext.Provider>,
        { columns: TERMINAL_COLUMNS },
      ),
    );
  } finally {
    process.stdout.columns = originalColumns;
    process.stdout.rows = originalRows;
  }
}

function renderHistoryQueuedLines(item: Extract<CompletedItem, { kind: "queued" }>): string[] {
  return cleanLines(serializeCompletedItemToTerminalHistory(item, context));
}

describe("queued message UI invariants", () => {
  it("renders queued placeholders with the same live/history row shape", () => {
    const item = queuedItem();

    const liveLines = renderLiveQueuedLines(item);
    const historyLines = renderHistoryQueuedLines(item);

    expect(liveLines).toEqual(historyLines);
    expect(liveLines[0]).toMatch(/^ • Queued: follow-up prompt/);
    expect(liveLines.join("\n")).not.toContain("↳ Queued");
    expect(liveLines.join("\n")).not.toContain("⏳");
    for (const line of liveLines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(TERMINAL_COLUMNS);
    }
  });

  it("keeps queued placeholders active so insertion flush removes them from live items", () => {
    expect(isActiveItem(queuedItem())).toBe(true);
  });

  it("spaces queued rows like other agent chat rows when printed between agent items", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as NodeJS.WriteStream;

    createTerminalHistoryPrinter({ stream }).print(
      [
        { kind: "assistant", id: "assistant-1", text: "First response." },
        queuedItem({ id: "queued-1", text: "next prompt" }),
        { kind: "assistant", id: "assistant-2", text: "Second response." },
      ],
      context,
    );

    const rendered = stripAnsi(output);
    expect(rendered).toContain(" • Queued: next prompt");
    expect(rendered).toContain(
      " ⏺ First response.\n\n • Queued: next prompt\n\n ⏺ Second response.",
    );
  });
});
