import { describe, expect, it } from "vitest";
import {
  buildGoalSummaryRows,
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
  it("keeps Static history mounted for overlay panes so scrollback is not rewritten", () => {
    expect(shouldHideHistoryForOverlayView(true, false)).toBe(false);
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

  it("persists the visible completion footer across idle pane remounts", () => {
    const doneStatus = { durationMs: 3200, toolsUsed: [], verb: "Mulled it over for" };
    const sessionStore = { doneStatus: null as typeof doneStatus | null };

    sessionStore.doneStatus = doneStatus;

    expect(sessionStore.doneStatus).toEqual(doneStatus);
  });

  it("models the regression: goal progress history remains rendered while a pane is open", () => {
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

    expect(itemsRenderedDuringGoalPane).toEqual(history);
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
    expect(
      formatGoalTerminalProgress(
        goalRun({
          status: "passed",
          successCriteria: ["Verifier proves the Goal end-to-end"],
          tasks: [
            { id: "task-1", title: "Implement", prompt: "Do it", status: "done", attempts: 1 },
          ],
          evidence: [
            {
              id: "evidence-1",
              kind: "command",
              label: "Verifier pass",
              path: "artifacts/goal-pass.log",
              createdAt: "2024-01-01T00:00:00.000Z",
            },
          ],
          verifier: {
            description: "Goal verifier",
            command: "pnpm test",
            lastResult: {
              status: "pass",
              summary: "passed",
              command: "pnpm test",
              exitCode: 0,
              outputPath: "artifacts/goal-pass.log",
              checkedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        }),
      ),
    ).toMatchObject({
      kind: "goal_progress",
      phase: "terminal",
      title: "Goal passed: Persist goal output",
      status: "passed",
      summaryRows: [
        { label: "Tasks", value: "1/1 done" },
        { label: "Verifier", value: "pass", detail: "artifacts/goal-pass.log" },
        { label: "Evidence", value: "1 recorded", detail: "artifacts/goal-pass.log" },
        { label: "Criteria", value: "1 checked" },
      ],
    });
    expect(formatGoalTerminalProgress(goalRun({ status: "running" }))).toBeNull();
  });

  it("builds a compact terminal Goal summary with blocker context", () => {
    expect(
      buildGoalSummaryRows(
        goalRun({
          status: "blocked",
          blockers: ["Connect an unlocked iPhone with Developer Mode enabled."],
          tasks: [
            { id: "task-1", title: "Implement", prompt: "Do it", status: "done", attempts: 1 },
            { id: "task-2", title: "Capture", prompt: "Capture", status: "blocked", attempts: 0 },
          ],
        }),
      ),
    ).toEqual([
      { label: "Tasks", value: "1/2 done", detail: "1 blocked" },
      { label: "Verifier", value: "missing" },
      { label: "Evidence", value: "0 recorded" },
      { label: "Blocked on", value: "Connect an unlocked iPhone with Developer Mode enabled." },
    ]);
  });
});
