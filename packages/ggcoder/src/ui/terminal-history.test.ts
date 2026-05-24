import { describe, expect, it } from "vitest";
import stringWidth from "string-width";
import {
  createTerminalHistoryPrinter,
  serializeCompletedItemToTerminalHistory,
} from "./terminal-history.js";
import type { CompletedItem } from "./App.js";
import { loadTheme } from "./theme/theme.js";

const context = {
  theme: loadTheme("dark"),
  columns: 80,
  version: "0.0.0-test",
  model: "test-model",
  provider: "openai" as const,
  cwd: "/tmp/project",
};

function stripAnsi(value: string): string {
  const escape = String.fromCharCode(27);
  return value.replace(new RegExp(`${escape}\\[[0-9;]*m`, "g"), "");
}

describe("terminal history", () => {
  it("serializes assistant rows with the existing dot prefix", () => {
    const item: CompletedItem = {
      kind: "assistant",
      text: "Hello **world**",
      id: "assistant-1",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toContain("Hello");
    expect(rendered).toContain("world");
    expect(rendered).toMatch(/^ [⏺●] Hello/);
  });

  it("hard-wraps long assistant words in durable terminal history", () => {
    const item: CompletedItem = {
      kind: "assistant",
      text: "prefix " + "x".repeat(120),
      id: "assistant-long-word",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered.split("\n").length).toBeGreaterThan(1);
    expect(rendered).toContain("  x");
  });

  it("renders assistant continuation chunks without another response dot", () => {
    const item: CompletedItem = {
      kind: "assistant",
      text: "continued poem line one\ncontinued poem line two",
      continuation: true,
      id: "assistant-continuation",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).not.toMatch(/^ [⏺●] /);
    expect(rendered).toContain("   continued poem line one");
  });

  it("renders final assistant tails after streamed chunks as continuations", () => {
    const finalTail: CompletedItem = {
      kind: "assistant",
      text: "final poem line after streamed chunks",
      continuation: true,
      id: "assistant-final-tail",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(finalTail, context));

    expect(rendered).not.toContain("⏺");
    expect(rendered).toContain("   final poem line after streamed chunks");
  });

  it("serializes user rows as the prompt chip without adding a You label", () => {
    const item: CompletedItem = {
      kind: "user",
      text: "ship it",
      id: "user-1",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toContain("> ship it");
    expect(rendered).not.toContain("You");
  });

  it("renders terminal-history user rows with the same full-width shell as the input field", () => {
    const item: CompletedItem = {
      kind: "user",
      text: "ship it",
      id: "user-1",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    const lines = rendered.split("\n");
    expect(lines[0]).toBe("▄".repeat(context.columns));
    expect(lines[1]).toContain("> ship it");
    expect(lines[1]).toHaveLength(context.columns);
    expect(lines[2]).toBe("▀".repeat(context.columns));
  });

  it("collapses typed multiline prompts inside one user row", () => {
    const item: CompletedItem = {
      kind: "user",
      text: "first line\nsecond line\nthird line",
      id: "user-1",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toContain("> first line ⏎ second line ⏎ third line");
    expect(rendered).not.toContain("\nsecond line");
    expect(rendered.match(/>/g)).toHaveLength(1);
  });

  it("collapses pasted multiline prompts to the same single badge as live user rows", () => {
    const item: CompletedItem = {
      kind: "user",
      text: "please read:\nline one\nline two\nthen summarize",
      pasteInfo: {
        offset: "please read:\n".length,
        length: "line one\nline two".length,
        lineCount: 2,
      },
      id: "user-1",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toContain("> please read:");
    expect(rendered).toContain("[Pasted text #17 +2 lines]");
    expect(rendered).toContain("then summarize");
    expect(rendered).not.toContain("line one");
    expect(rendered).not.toContain("line two");
    expect(rendered).not.toContain("\nline");
    expect(rendered.match(/>/g)).toHaveLength(1);
  });

  it("serializes tool rows with status dots and the response gutter", () => {
    const item: CompletedItem = {
      kind: "tool_done",
      id: "tool-1",
      name: "bash",
      args: { command: "printf hi" },
      result: "Exit code: 0\nhi",
      isError: false,
      durationMs: 1234,
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toMatch(/^ [⏺●] Bash\(printf hi\)/);
    expect(rendered).toContain("  ⎿  hi");
  });

  it("serializes compact tool rows like the live compact summaries", () => {
    const item: CompletedItem = {
      kind: "tool_done",
      id: "tool-compact-1",
      name: "grep",
      args: { pattern: "needle" },
      result: "src/a.ts:1:needle\nsrc/b.ts:2:needle\n2 matches found",
      isError: false,
      durationMs: 1234,
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toMatch(/^ [⏺●] Searched for 1 pattern \(2 matches\)$/);
    expect(rendered).not.toContain("src/a.ts");
  });

  it("serializes grouped tool rows as one consolidated summary", () => {
    const item: CompletedItem = {
      kind: "tool_group",
      id: "tool-group-1",
      tools: [
        {
          toolCallId: "read-1",
          name: "read",
          args: { file_path: "src/a.ts" },
          status: "done",
          result: "1\tconst a = 1;",
        },
        {
          toolCallId: "read-2",
          name: "read",
          args: { file_path: "src/b.ts" },
          status: "done",
          result: "1\tconst b = 1;",
        },
      ],
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toMatch(/^ [⏺●] Read 2 files$/);
  });

  it("serializes server search rows with quoted detail and response summary", () => {
    const item: CompletedItem = {
      kind: "server_tool_done",
      id: "server-tool-1",
      name: "web_search",
      input: { query: "latest docs" },
      resultType: "search_result",
      data: {},
      durationMs: 2400,
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toMatch(/^ [⏺●] Web Search\("latest docs"\)/);
    expect(rendered).toContain("  ⎿  Did 1 search in 2s");
  });

  it("keeps finalized markdown tables inside the terminal width", () => {
    const narrowContext = { ...context, columns: 52 };
    const item: CompletedItem = {
      kind: "assistant",
      id: "assistant-table-1",
      text:
        "| Area | Details | Status |\n" +
        "| --- | --- | --- |\n" +
        "| Dashboard | Provides a centralized Next.js dashboard with live account statuses, automation activity, error logs, and engagement metrics. | Ready |\n" +
        "| Recovery | Captures long verifier failure summaries without letting table borders overflow terminal width. | Needs review |",
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, narrowContext));
    const tableLines = rendered.split("\n").filter((line) => /[┌┬┐│├┼┤└┴┘]/.test(line));

    expect(tableLines.length).toBeGreaterThan(4);
    for (const line of tableLines) {
      expect(stringWidth(line)).toBeLessThanOrEqual(narrowContext.columns);
    }
    expect(rendered).not.toContain("| --- | --- | --- |");
  });

  it("serializes goal progress rows with tool-style gutter and agent spacing", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as NodeJS.WriteStream;
    const printer = createTerminalHistoryPrinter({ stream });
    const items: CompletedItem[] = [
      { kind: "assistant", text: "Coordinator update", id: "assistant-before-goal" },
      {
        kind: "goal_progress",
        phase: "worker_started",
        title: "Worker started: Audit /goal role contracts",
        detail: "Task is running in the background.",
        workerId: "worker-1",
        status: "running",
        id: "goal-progress-worker",
      },
    ];

    printer.print(items, context);
    const rendered = stripAnsi(output);

    expect(rendered).toMatch(
      /Coordinator update\n\n [⏺●] Worker started: Audit \/goal role contracts/,
    );
    expect(rendered).toContain(" · worker worker-1");
    expect(rendered).toContain("  ⎿  Task is running in the background.");
    expect(rendered).not.toContain("↻ Worker started");
  });

  it("serializes subagent groups as the live tree panel shape", () => {
    const item: CompletedItem = {
      kind: "subagent_group",
      id: "subagent-1",
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
    };

    const rendered = stripAnsi(serializeCompletedItemToTerminalHistory(item, context));

    expect(rendered).toMatch(/^[⏺●] 1 agent completed/);
    expect(rendered).toContain("  └─ ✓ Inspect widgets");
    expect(rendered).toContain("     ⎿ 1.5k tokens · 2s");
  });

  it("prints each finalized item id once across remount-style replays", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as NodeJS.WriteStream;
    const printer = createTerminalHistoryPrinter({ stream });
    const items: CompletedItem[] = [
      { kind: "banner", id: "banner" },
      { kind: "user", text: "hello", id: "user-1" },
    ];

    printer.print(items, context);
    printer.print(items, context);

    expect(output.match(/GG Coder/g)).toHaveLength(1);
    expect(output.match(/hello/g)).toHaveLength(1);
  });

  it("leaves one message-sized blank line after the banner", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as NodeJS.WriteStream;
    const printer = createTerminalHistoryPrinter({ stream });

    printer.print(
      [
        { kind: "banner", id: "banner" },
        { kind: "user", text: "hello", id: "user-1" },
      ],
      context,
    );

    const rendered = stripAnsi(output);
    expect(rendered).toMatch(/toggle thinking\n\n▄+/);
    expect(rendered).toContain("> hello");
    expect(rendered).not.toMatch(/toggle thinking\n\n\n▄+/);
  });

  it("prints one leading separator and no trailing blank after finalized rows", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as NodeJS.WriteStream;
    const printer = createTerminalHistoryPrinter({ stream });

    printer.print([{ kind: "assistant", text: "last answer", id: "assistant-1" }], context);

    expect(stripAnsi(output)).toMatch(/^ [⏺●] last answer\n$/);
  });

  it("can intentionally clear printed ids for a fresh session", () => {
    let output = "";
    const stream = {
      write(chunk: string) {
        output += chunk;
        return true;
      },
    } as NodeJS.WriteStream;
    const printer = createTerminalHistoryPrinter({ stream });
    const item: CompletedItem = { kind: "user", text: "again", id: "user-1" };

    printer.print([item], context);
    expect(printer.printedIds.has(item.id)).toBe(true);
    printer.clear();
    expect(printer.printedIds.has(item.id)).toBe(false);
    printer.print([item], context);

    expect(output.match(/again/g)).toHaveLength(2);
  });
});
