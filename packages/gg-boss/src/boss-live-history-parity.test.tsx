import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { AnimationProvider } from "@kenkaiiii/ggcoder/ui";
import { ThemeContext, loadTheme } from "@kenkaiiii/ggcoder/ui/theme";
import { TerminalSizeProvider } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import type { HistoryItem } from "./boss-store.js";
import { BossStreamingTurnView, BossTranscriptRow } from "./boss-transcript-rows.js";

function wrap(node: React.ReactNode): string {
  return renderToString(
    <TerminalSizeProvider>
      <ThemeContext.Provider value={loadTheme("dark")}>
        <AnimationProvider>{node}</AnimationProvider>
      </ThemeContext.Provider>
    </TerminalSizeProvider>,
  );
}

const assistant: HistoryItem = { kind: "assistant", id: "a1", text: "I will.", durationMs: 1 };
const toolStart: HistoryItem = {
  kind: "tool_start",
  id: "t1",
  toolCallId: "t1",
  name: "read",
  args: { file_path: "README.md" },
  startedAt: 1,
  animateUntil: 2,
};
const toolDone: HistoryItem = {
  kind: "tool_done",
  id: "td1",
  toolCallId: "t1",
  name: "read",
  args: { file_path: "README.md" },
  result: "ok",
  isError: false,
  durationMs: 1,
};
const assistantTail: HistoryItem = { kind: "assistant", id: "a2", text: "Done.", durationMs: 1 };

describe("boss live/history transcript parity", () => {
  it("renders live tool rows before streaming assistant tail like ggcoder ChatLivePane", () => {
    const live = wrap(
      <BossStreamingTurnView
        turn={{
          text: "Done.",
          thinking: "",
          thinkingMs: 0,
          tools: [],
          startedAt: 1,
          thinkingStartedAt: null,
        }}
        isRunning
        liveItems={[toolStart, toolDone]}
        lastHistoryItem={assistant}
      />,
    );

    expect(live.indexOf("Read")).toBeGreaterThanOrEqual(0);
    expect(live.indexOf("Done.")).toBeGreaterThan(live.indexOf("Read"));
  });

  it("uses the same previous-row boundary when finalized history replaces live rows", () => {
    const history = [assistant, toolStart, toolDone, assistantTail];
    const rendered = history
      .map((row, index, rows) =>
        wrap(<BossTranscriptRow row={row} previousRow={index > 0 ? rows[index - 1] : undefined} />),
      )
      .join("\n");

    expect(rendered.indexOf("I will.")).toBeGreaterThanOrEqual(0);
    expect(rendered.indexOf("Read")).toBeGreaterThan(rendered.indexOf("I will."));
    expect(rendered.indexOf("Done.")).toBeGreaterThan(rendered.indexOf("Read"));
  });
});
