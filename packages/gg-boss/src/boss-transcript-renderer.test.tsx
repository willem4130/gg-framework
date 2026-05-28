import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { AnimationProvider } from "@kenkaiiii/ggcoder/ui";
import { ThemeContext, loadTheme } from "@kenkaiiii/ggcoder/ui/theme";
import { TerminalSizeProvider } from "@kenkaiiii/ggcoder/ui/hooks/terminal-size";
import { renderBossTranscriptItem } from "./boss-transcript-renderer.js";
import type { BossDisplayItem } from "./boss-ui-items.js";

function renderItem(item: BossDisplayItem, index: number, items: BossDisplayItem[]): string {
  return renderToString(
    <TerminalSizeProvider>
      <ThemeContext.Provider value={loadTheme("dark")}>
        <AnimationProvider>{renderBossTranscriptItem({ item, index, items })}</AnimationProvider>
      </ThemeContext.Provider>
    </TerminalSizeProvider>,
  );
}

describe("boss transcript renderer", () => {
  it("renders live order user assistant tool start tool done assistant tail", () => {
    const items: BossDisplayItem[] = [
      { kind: "user", id: "u1", text: "Do it", timestamp: 1 },
      { kind: "assistant", id: "a1", text: "I will.", durationMs: 1 },
      {
        kind: "tool_start",
        id: "t1",
        toolCallId: "t1",
        name: "read",
        args: { file_path: "README.md" },
        startedAt: 1,
        animateUntil: 2,
      },
      {
        kind: "tool_done",
        id: "td1",
        toolCallId: "t1",
        name: "read",
        args: { file_path: "README.md" },
        result: "ok",
        isError: false,
        durationMs: 1,
      },
      { kind: "assistant", id: "a2", text: "Done.", durationMs: 1 },
    ];

    const output = items.map((item, index) => renderItem(item, index, items)).join("\n");

    expect(output).toContain("Do it");
    expect(output).toContain("I will.");
    expect(output).toContain("Read");
    expect(output).toContain("Done.");
  });
});
