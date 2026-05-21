import { describe, expect, it } from "vitest";
import {
  formatGoalTerminalProgress,
  routePromptCommandInput,
  shouldHideHistoryForOverlayView,
  shouldHideStaticItemsForOverlayView,
  shouldStabilizeOverlayPaneRerender,
  type CompletedItem,
  type GoalProgressItem,
} from "./App.js";
import type { GoalRun } from "../core/goal-store.js";

function goalRun(overrides: Partial<GoalRun> = {}): GoalRun {
  return {
    id: "run-1",
    title: "Persist goal output",
    goal: "Goal body",
    status: "passed",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    projectPath: "/tmp/project",
    successCriteria: [],
    prerequisites: [],
    harness: [],
    evidencePlan: [],
    tasks: [],
    evidence: [],
    blockers: [],
    ...overrides,
  };
}

describe("App TUI state persistence helpers", () => {
  it("hides Static history for clean idle overlay panes but keeps it mounted during active agent runs", () => {
    expect(shouldHideHistoryForOverlayView(true, false)).toBe(true);
    expect(shouldHideHistoryForOverlayView(true, true)).toBe(false);
    expect(shouldHideHistoryForOverlayView(false, false)).toBe(false);
  });

  it("keeps active Goal pane switches from blanking Static history", () => {
    const hideHistory = shouldHideHistoryForOverlayView(true, true);
    const stabilizeStatic = shouldStabilizeOverlayPaneRerender({
      overlayPane: "goal",
      isAgentRunning: true,
    });

    expect(hideHistory).toBe(false);
    expect(stabilizeStatic).toBe(true);
    expect(
      shouldHideStaticItemsForOverlayView({
        shouldHideHistoryForOverlay: hideHistory,
        stabilizeOverlayPaneRerender: stabilizeStatic,
      }),
    ).toBe(false);
  });

  it("models the regression: goal progress history remains persisted even when hidden behind a pane", () => {
    const goalProgress: GoalProgressItem = {
      kind: "goal_progress",
      phase: "terminal",
      title: "Goal passed: Persist goal output",
      detail: "Verifier evidence is recorded; auto-continuation stopped.",
      status: "passed",
      id: "goal-progress-1",
    };
    const history: CompletedItem[] = [
      { kind: "banner", id: "banner" },
      goalProgress,
      { kind: "assistant", text: "Goal run summary stays visible", id: "assistant-1" },
    ];

    const itemsRenderedDuringGoalPane = shouldHideHistoryForOverlayView(true, false) ? [] : history;

    expect(itemsRenderedDuringGoalPane).toEqual([]);
    expect(history).toContain(goalProgress);
  });

  it("routes slash prompt commands with pasted multi-line args into the command path", () => {
    const pastedArgs = "explain this snippet:\nconst a = 1;\nconsole.log(a);";
    const route = routePromptCommandInput(`/scan ${pastedArgs}`);

    expect(route).toMatchObject({ cmdName: "scan", cmdArgs: pastedArgs });
    expect(route?.fullPrompt).toContain("# Scan: Confirmed Dead Code Review");
    expect(route?.fullPrompt).toContain(`## User Instructions\n\n${pastedArgs}`);
  });

  it("formats terminal goal progress as durable history-safe rows", () => {
    expect(formatGoalTerminalProgress(goalRun({ status: "passed" }))).toMatchObject({
      kind: "goal_progress",
      phase: "terminal",
      title: "Goal passed: Persist goal output",
      status: "passed",
    });
    expect(formatGoalTerminalProgress(goalRun({ status: "running" }))).toBeNull();
  });
});
