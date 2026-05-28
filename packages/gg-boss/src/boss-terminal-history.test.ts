import { describe, expect, it } from "vitest";
import { loadTheme } from "@kenkaiiii/ggcoder/ui/theme";
import { createBossTerminalHistoryPrinter } from "./boss-terminal-history.js";
import type { BossDisplayItem } from "./boss-ui-items.js";

const context = {
  theme: loadTheme("dark"),
  columns: 80,
  version: "0.0.0",
  model: "test-model",
  provider: "anthropic" as const,
  cwd: "/tmp",
};

describe("boss terminal history", () => {
  it("dedupes finalized rows after synchronous user print", () => {
    const writes: string[] = [];
    const printer = createBossTerminalHistoryPrinter();
    const user: BossDisplayItem = { kind: "user", id: "u1", text: "Ship it", timestamp: 1 };

    printer.print([user], context, { write: (data) => writes.push(data) });
    printer.print([user], context, { write: (data) => writes.push(data) });

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain("Ship it");
  });

  it("can reset dedupe before repainting durable history on resize", () => {
    const writes: string[] = [];
    const printer = createBossTerminalHistoryPrinter();
    const user: BossDisplayItem = { kind: "user", id: "u1", text: "Resize me", timestamp: 1 };

    printer.print([user], context, { write: (data) => writes.push(data) });
    printer.resetPrinted();
    printer.print([user], context, { write: (data) => writes.push(data) });

    expect(writes).toHaveLength(2);
  });

  it("separates Boss-only worker events from compact user to assistant boundary", () => {
    const writes: string[] = [];
    const printer = createBossTerminalHistoryPrinter();
    const items: BossDisplayItem[] = [
      { kind: "user", id: "u1", text: "Run workers", timestamp: 1 },
      { kind: "assistant", id: "a1", text: "Starting.", durationMs: 1 },
      {
        kind: "worker_event",
        id: "w1",
        project: "app",
        status: "idle",
        finalText: "Changed: src/app.ts Verified: pnpm test Status: DONE",
        toolsUsed: [{ name: "edit", ok: true }],
        turnIndex: 1,
        timestamp: "now",
      },
    ];

    printer.print(items, context, { write: (data) => writes.push(data) });

    const output = writes.join("");
    expect(output).toContain("Starting.");
    expect(output).toContain("app");
    expect(output).toContain("turn 1");
  });
});
