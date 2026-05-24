import React from "react";
import { Box, Text, renderToString } from "ink";
import { describe, expect, it } from "vitest";
import stripAnsi from "strip-ansi";
import stringWidth from "string-width";
import type { CompletedItem } from "./App.js";
import { serializeCompletedItemToTerminalHistory } from "./terminal-history.js";
import { loadTheme, ThemeContext } from "./theme/theme.js";
import type { Theme } from "./theme/theme.js";
import { TerminalSizeProvider } from "./hooks/useTerminalSize.js";
import { ToolExecution } from "./components/ToolExecution.js";
import { ToolGroupExecution } from "./components/ToolGroupExecution.js";
import { ServerToolExecution } from "./components/ServerToolExecution.js";
import { MessageResponse } from "./components/MessageResponse.js";
import { ToolUseLoader } from "./components/ToolUseLoader.js";
import { SubAgentPanel } from "./components/SubAgentPanel.js";

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

function cleanLines(value: string): string[] {
  return stripAnsi(value)
    .replace(/\r/g, "\n")
    .split("\n")
    .filter((line) => line.length > 0);
}

function renderLive(element: React.ReactElement): string[] {
  const originalColumns = process.stdout.columns;
  const originalRows = process.stdout.rows;
  process.stdout.columns = TERMINAL_COLUMNS;
  process.stdout.rows = 20;
  try {
    return cleanLines(
      renderToString(
        <ThemeContext.Provider value={theme}>
          <TerminalSizeProvider>{element}</TerminalSizeProvider>
        </ThemeContext.Provider>,
        { columns: TERMINAL_COLUMNS },
      ),
    );
  } finally {
    process.stdout.columns = originalColumns;
    process.stdout.rows = originalRows;
  }
}

function renderHistory(item: CompletedItem): string[] {
  return cleanLines(serializeCompletedItemToTerminalHistory(item, context));
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

function renderGoalProgressLive(
  item: Extract<CompletedItem, { kind: "goal_progress" }>,
  itemTheme: Theme,
) {
  const isError = item.status === "failed" || item.status === "fail" || item.status === "blocked";
  const status = isError
    ? "error"
    : item.phase === "worker_finished" ||
        item.phase === "verifier_finished" ||
        item.phase === "terminal"
      ? "done"
      : "running";
  const color = isError
    ? itemTheme.error
    : item.phase === "worker_finished" || item.phase === "terminal"
      ? itemTheme.success
      : item.phase === "verifier_finished" || item.phase === "verifier_started"
        ? itemTheme.accent
        : item.phase === "orchestrator_reviewing" || item.phase === "orchestrator_working"
          ? itemTheme.secondary
          : item.phase === "continuing"
            ? itemTheme.warning
            : itemTheme.primary;
  const hasBody =
    !!item.detail ||
    (item.summaryRows !== undefined && item.summaryRows.length > 0) ||
    (item.summarySections !== undefined && item.summarySections.length > 0);

  return (
    <Box flexDirection="column" paddingLeft={1} marginTop={1} flexShrink={1}>
      <Box flexDirection="row">
        <ToolUseLoader status={status} staticDisplay />
        <Box flexGrow={1} width={Math.max(10, TERMINAL_COLUMNS - 3)}>
          <Text wrap="wrap">
            <Text color={color} bold>
              {item.title}
            </Text>
            {item.workerId ? (
              <Text color={itemTheme.textDim}> · worker {item.workerId}</Text>
            ) : null}
          </Text>
        </Box>
      </Box>
      {hasBody ? (
        <MessageResponse>
          <Box flexDirection="column" flexShrink={1}>
            {item.detail ? (
              <Text color={itemTheme.textDim} wrap="wrap">
                {item.detail}
              </Text>
            ) : null}
            {item.summaryRows?.map((row) => (
              <Text key={row.label} wrap="truncate">
                <Text color={itemTheme.textDim}>{row.label.padEnd(12)}</Text>
                <Text color={itemTheme.text}>{row.value}</Text>
                {row.detail ? <Text color={itemTheme.textDim}> · {row.detail}</Text> : null}
              </Text>
            ))}
            {item.summarySections?.map((section) => (
              <Box key={section.title} flexDirection="column" marginTop={1} flexShrink={1}>
                <Text color={itemTheme.textDim} bold>
                  {section.title}
                </Text>
                {section.lines.map((line, index) => (
                  <Text key={`${section.title}-${index}`} color={itemTheme.text} wrap="wrap">
                    {`• ${line}`}
                  </Text>
                ))}
              </Box>
            ))}
          </Box>
        </MessageResponse>
      ) : null}
    </Box>
  );
}

function renderStatusLive(
  glyph: string,
  content: React.ReactNode,
  glyphColor: string,
  itemTheme: Theme,
  options: { bold?: boolean; muted?: boolean } = {},
) {
  return (
    <Box flexDirection="row" paddingLeft={1} marginTop={1} flexShrink={1}>
      <Box width={2} flexShrink={0}>
        <Text color={glyphColor} bold={options.bold ?? true}>
          {glyph}
        </Text>
      </Box>
      <Box flexDirection="column" flexGrow={1}>
        <Text
          color={options.muted ? itemTheme.textDim : itemTheme.commandColor}
          bold={options.bold}
          wrap="wrap"
        >
          {content}
        </Text>
      </Box>
    </Box>
  );
}

function liveElementFor(item: CompletedItem): React.ReactElement | null {
  switch (item.kind) {
    case "queued":
      return renderQueuedLiveItem(item, theme);
    case "tool_start":
      return (
        <ToolExecution
          status="running"
          name={item.name}
          args={item.args}
          progressOutput={item.progressOutput}
          animateUntil={0}
        />
      );
    case "tool_done":
      return (
        <ToolExecution
          status="done"
          name={item.name}
          args={item.args}
          result={item.result}
          isError={item.isError}
          details={item.details}
        />
      );
    case "tool_group":
      return <ToolGroupExecution tools={item.tools} />;
    case "server_tool_start":
      return (
        <ServerToolExecution
          status="running"
          name={item.name}
          input={item.input}
          startedAt={0}
          animateUntil={0}
        />
      );
    case "server_tool_done":
      return (
        <ServerToolExecution
          status="done"
          name={item.name}
          input={item.input}
          durationMs={item.durationMs}
          resultType={item.resultType}
        />
      );
    case "subagent_group":
      return <SubAgentPanel agents={item.agents} aborted={item.aborted} />;
    case "goal_progress":
      return renderGoalProgressLive(item, theme);
    case "info":
      return renderStatusLive("○ ", item.text, theme.commandColor, theme, { muted: true });
    case "plan_transition":
      return renderStatusLive(
        "● ",
        item.text.replace(/\\n/g, "\n").replace(/^\n+|\n+$/g, ""),
        theme.commandColor,
        theme,
        { bold: true },
      );
    case "goal_agent_transition":
      return renderStatusLive(
        "● ",
        item.text.replace(/\\n/g, "\n").replace(/^\n+|\n+$/g, ""),
        theme.commandColor,
        theme,
        { bold: true },
      );
    case "thinking_transition":
      return renderStatusLive(
        "✻ ",
        item.active ? "Thinking ON" : "Thinking OFF",
        item.active ? theme.commandColor : theme.textDim,
        theme,
        { bold: true, muted: !item.active },
      );
    case "model_transition":
      return renderStatusLive(
        "▸ ",
        <>
          <Text color={theme.textDim}>{"Switched to "}</Text>
          <Text color={theme.commandColor} bold>
            {item.modelName}
          </Text>
        </>,
        theme.commandColor,
        theme,
        { bold: true },
      );
    case "theme_transition":
      return renderStatusLive(
        "◐ ",
        <>
          <Text color={theme.textDim}>{"Theme switched to "}</Text>
          <Text color={theme.commandColor} bold>
            {item.themeName}
          </Text>
        </>,
        theme.commandColor,
        theme,
        { bold: true },
      );
    case "plan_event": {
      const label =
        item.event === "approved"
          ? "Plan approved"
          : item.event === "rejected"
            ? "Plan rejected"
            : "Plan dismissed";
      return renderStatusLive(
        "○ ",
        <>
          <Text>{label}</Text>
          {item.detail ? <Text color={theme.textDim}>{` — "${item.detail}"`}</Text> : null}
        </>,
        theme.commandColor,
        theme,
        { bold: true },
      );
    }
    case "stopped":
      return renderStatusLive(
        "⊘ ",
        item.text.replace(/\\n/g, "\n").replace(/^\n+|\n+$/g, ""),
        theme.commandColor,
        theme,
        { bold: true },
      );
    default:
      return null;
  }
}

const parityCases: CompletedItem[] = [
  { kind: "queued", id: "queued-1", text: "next prompt with wrapping words" },
  {
    kind: "tool_start",
    id: "read-start",
    toolCallId: "read-start",
    name: "read",
    args: { file_path: "src/a.ts" },
    startedAt: 0,
    animateUntil: 0,
  },
  {
    kind: "tool_done",
    id: "read-done",
    name: "read",
    args: { file_path: "src/a.ts" },
    result: "1\tconst a = 1;",
    isError: false,
    durationMs: 1000,
  },
  {
    kind: "tool_start",
    id: "bash-start",
    toolCallId: "bash-start",
    name: "bash",
    args: { command: "printf hi" },
    progressOutput: "first line\nsecond line",
    startedAt: 0,
    animateUntil: 0,
  },
  {
    kind: "tool_done",
    id: "bash-done",
    name: "bash",
    args: { command: "printf hi" },
    result: "Exit code: 0\nhi",
    isError: false,
    durationMs: 1000,
  },
  {
    kind: "tool_group",
    id: "tool-group",
    tools: [
      {
        toolCallId: "read-1",
        name: "read",
        args: { file_path: "src/a.ts" },
        status: "done",
        result: "ok",
      },
    ],
  },
  {
    kind: "server_tool_start",
    id: "server-start",
    serverToolCallId: "server-start",
    name: "web_search",
    input: { query: "latest docs" },
    startedAt: 0,
    animateUntil: 0,
  },
  {
    kind: "server_tool_done",
    id: "server-done",
    name: "web_search",
    input: { query: "latest docs" },
    resultType: "search_result",
    data: {},
    durationMs: 2400,
  },
  {
    kind: "subagent_group",
    id: "subagent",
    agents: [
      {
        toolCallId: "agent-1",
        agentName: "bee",
        task: "Inspect widgets",
        status: "done",
        toolUseCount: 2,
        tokenUsage: { input: 1200, output: 300 },
        durationMs: 1800,
      },
    ],
  },
  {
    kind: "goal_progress",
    id: "goal-progress",
    phase: "worker_finished",
    title: "Worker finished",
    detail: "Completed the audit.",
    workerId: "worker-1",
    status: "done",
    summaryRows: [{ label: "tests", value: "passed", detail: "3 files" }],
    summarySections: [{ title: "Evidence", lines: ["unit test passed"] }],
  },
  { kind: "info", id: "info", text: "Configuration saved" },
  { kind: "plan_transition", id: "plan", text: "Plan mode ON", active: true },
  { kind: "goal_agent_transition", id: "goal-agent", text: "Goal agent ON" },
  { kind: "thinking_transition", id: "thinking", active: true },
  { kind: "model_transition", id: "model", modelName: "Claude Sonnet" },
  { kind: "theme_transition", id: "theme", themeName: "dark" },
  { kind: "plan_event", id: "plan-event", event: "approved", detail: "ship it" },
  { kind: "stopped", id: "stopped", text: "Stopped" },
];

describe("TUI live/history parity", () => {
  it.each(parityCases.map((item) => [item.kind, item] as const))(
    "keeps %s live rendering aligned with terminal history",
    (_kind, item) => {
      const liveElement = liveElementFor(item);
      expect(liveElement).not.toBeNull();
      const liveLines = renderLive(liveElement!);
      const historyLines = renderHistory(item);

      expect(liveLines, item.kind).toEqual(historyLines);
      for (const line of liveLines) {
        expect(stringWidth(line), `${item.kind}: ${line}`).toBeLessThanOrEqual(TERMINAL_COLUMNS);
      }
    },
  );
});
