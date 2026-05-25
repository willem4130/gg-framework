import { describe, expect, it } from "vitest";
import type { CompletedItem, GoalProgressItem } from "./app-items.js";
import { routePromptCommandInput } from "./prompt-routing.js";
import { formatGoalTerminalProgress, getGoalContinuationChoiceKey } from "./goal-progress.js";
import { getNextGeneratedItemId } from "./item-helpers.js";
import {
  getDoneFlushDecision,
  getGoalActivationPaneTransition,
  getGoalSetupFinishedPaneTransition,
  getGoalSetupPaneTransitionAfterRun,
  nextGoalModeAfterAgentDone,
  shouldHideHistoryForOverlayView,
  shouldHideStaticItemsForOverlayView,
  shouldResetUIForGoalSetupPaneTransition,
  shouldStabilizeOverlayPaneRerender,
} from "./layout-decisions.js";
import { buildGoalSummaryRows } from "./goal-summary.js";
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
  it("hides Static history for overlay panes so they open as standalone views", () => {
    expect(shouldHideHistoryForOverlayView(true, false)).toBe(true);
    expect(shouldHideHistoryForOverlayView(true, true)).toBe(true);
    expect(shouldHideHistoryForOverlayView(false, false)).toBe(false);
  });

  it("opens /goal setup results as a focused auto-expanded Goal pane", () => {
    expect(getGoalSetupFinishedPaneTransition()).toEqual({
      overlay: "goal",
      goalAutoExpand: true,
      planAutoExpand: false,
      suppressDoneStatus: true,
    });
  });

  it("keeps the Goal setup pane transition pending even after onDone clears goal mode", () => {
    expect(
      getGoalSetupPaneTransitionAfterRun({
        isGoalSetupCommand: true,
        setupPanePending: true,
      }),
    ).toEqual(getGoalSetupFinishedPaneTransition());
    expect(
      getGoalSetupPaneTransitionAfterRun({
        isGoalSetupCommand: true,
        setupPanePending: false,
      }),
    ).toBeNull();
  });

  it("remounts when auto-opening review panes after setup finishes", () => {
    const appSupportsReset = { hasResetUI: true, hasSessionStore: true };
    const testFallback = { hasResetUI: false, hasSessionStore: true };

    expect(shouldResetUIForGoalSetupPaneTransition(appSupportsReset)).toBe(true);
    expect(shouldResetUIForGoalSetupPaneTransition(testFallback)).toBe(false);
  });

  it("closes and visually resets the Goal review pane when activating an approved Goal run", () => {
    expect(getGoalActivationPaneTransition()).toEqual({
      overlay: null,
      goalAutoExpand: false,
      planAutoExpand: false,
      resetReviewScreen: true,
    });
  });

  it("dedupes continuation choice rows by next action instead of run update timestamps", () => {
    const baseDecision = {
      kind: "create_task" as const,
      title: "Build Goal evidence path",
      prompt: "Record evidence.",
      reason: "Evidence is still planned.",
    };

    expect(getGoalContinuationChoiceKey({ runId: "goal-1", decision: baseDecision })).toBe(
      getGoalContinuationChoiceKey({ runId: "goal-1", decision: { ...baseDecision } }),
    );
    expect(
      getGoalContinuationChoiceKey({
        runId: "goal-1",
        decision: { ...baseDecision, title: "Run verifier" },
      }),
    ).not.toBe(getGoalContinuationChoiceKey({ runId: "goal-1", decision: baseDecision }));
  });

  it("keeps active Goal pane state standalone even while its polling rerenders", () => {
    const hideHistory = shouldHideHistoryForOverlayView(true, true);
    const stabilizeStatic = shouldStabilizeOverlayPaneRerender({
      overlayPane: "goal",
      isAgentRunning: true,
    });

    expect(hideHistory).toBe(true);
    expect(stabilizeStatic).toBe(true);
    expect(
      shouldHideStaticItemsForOverlayView({
        shouldHideHistoryForOverlay: hideHistory,
        stabilizeOverlayPaneRerender: stabilizeStatic,
      }),
    ).toBe(true);
  });

  it("persists the visible completion footer across idle pane remounts", () => {
    const doneStatus = { durationMs: 3200, toolsUsed: [], verb: "Mulled it over for" };
    const sessionStore = { doneStatus: null as typeof doneStatus | null };

    sessionStore.doneStatus = doneStatus;

    expect(sessionStore.doneStatus).toEqual(doneStatus);
  });

  it("preserves transient planner/setup modes across agent_done until the /goal handler advances", () => {
    expect(
      nextGoalModeAfterAgentDone({
        currentMode: "planner",
        runningGoalIds: 0,
        queuedSyntheticEvents: 0,
      }),
    ).toBe("planner");
    expect(
      nextGoalModeAfterAgentDone({
        currentMode: "setup",
        runningGoalIds: 0,
        queuedSyntheticEvents: 0,
      }),
    ).toBe("setup");
  });

  it("flushes transcript rows even when opening goal review without a done footer", () => {
    expect(
      getDoneFlushDecision({
        planOverlayPending: false,
        goalMode: "setup",
        goalAutoExpand: true,
      }),
    ).toEqual({ showDoneStatus: false, flushLiveItems: true });
    expect(
      getDoneFlushDecision({
        planOverlayPending: false,
        goalMode: "planner",
        goalAutoExpand: false,
      }),
    ).toEqual({ showDoneStatus: false, flushLiveItems: true });
    expect(
      getDoneFlushDecision({
        planOverlayPending: false,
        goalMode: "off",
        goalAutoExpand: false,
      }),
    ).toEqual({ showDoneStatus: true, flushLiveItems: true });
  });

  it("seeds generated item IDs after restored ui-prefixed history and live rows", () => {
    expect(
      getNextGeneratedItemId([{ id: "banner" }, { id: "ui-0" }, { id: "ui-1" }, { id: "ui-7" }]),
    ).toBe(8);
  });

  it("keeps fresh-session generated IDs in the same ui-prefixed namespace", () => {
    const firstFreshItem = `ui-${getNextGeneratedItemId([{ id: "banner" }])}`;

    expect(firstFreshItem).toBe("ui-0");
  });

  it("models the regression: goal progress history is hidden while a pane is open", () => {
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
    const pastedArgs = "prove this snippet renders:\nconst a = 1;\nconsole.log(a);";
    const route = routePromptCommandInput(`/goal ${pastedArgs}`);

    expect(route).toMatchObject({ cmdName: "goal", cmdArgs: pastedArgs });
    expect(route?.fullPrompt).toContain("Create a Goal run for the following objective");
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
      detail: "Final audit passed; verifier log: artifacts/goal-pass.log",
      status: "passed",
      summaryRows: [
        { label: "Work", value: "Implement" },
        { label: "Tasks", value: "1/1 done" },
        { label: "Verifier", value: "pass", detail: "artifacts/goal-pass.log" },
        { label: "Evidence", value: "1 recorded", detail: "artifacts/goal-pass.log" },
        { label: "Criteria", value: "1 checked" },
      ],
    });
    expect(formatGoalTerminalProgress(goalRun({ status: "running" }))).toBeNull();
  });

  it("allows live Goal worker-start rows while keeping durable reconstruction terminal-only", () => {
    const workerStarted: GoalProgressItem = {
      kind: "goal_progress",
      phase: "worker_started",
      title: "Worker started: Implement smoke check",
      detail: "Task is running in the background.",
      workerId: "worker-1",
      status: "running",
      id: "goal-worker-started-1",
    };
    const runningGoal = goalRun({ status: "running", activeWorkerId: "worker-1" });

    expect(workerStarted.phase).toBe("worker_started");
    expect(formatGoalTerminalProgress(runningGoal)).toBeNull();
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

  it("surfaces findings, work, residual risk, verifier, and audit outcome for passed Goals", () => {
    const progress = formatGoalTerminalProgress(
      goalRun({
        status: "passed",
        successCriteria: ["All findings are fixed or accepted"],
        tasks: [
          {
            id: "audit",
            title: "Audit findings",
            prompt: "Audit",
            status: "done",
            attempts: 1,
          },
          {
            id: "fix",
            title: "Fix production gaps",
            prompt: "Fix",
            status: "done",
            attempts: 1,
          },
        ],
        evidencePlan: [
          {
            id: "canary",
            label: "Optional provider canary",
            mechanism: "manual",
            description: "Provider-backed canary",
            status: "ready",
            evidence:
              "Optional provider-backed canary accepted as residual risk pending user approval.",
          },
        ],
        evidence: [
          {
            id: "findings",
            kind: "summary",
            label: "Close production gaps status",
            content:
              "Fixed setup completeness and verifier gaps. Residual provider canary accepted.",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ],
        verifier: {
          description: "Goal verifier",
          lastResult: {
            status: "pass",
            summary: "passed",
            checkedAt: "2024-01-01T00:00:00.000Z",
            outputPath: "artifacts/goal-pass.log",
          },
        },
        completionAudit: {
          status: "pass",
          summary:
            "FINAL_AUDIT_PASS verifier_checked_at=2024-01-01T00:00:00.000Z original-goal-prompt GOAL_PLAN All findings fixed and residual risks accepted.",
          checkedAt: "2024-01-01T00:00:01.000Z",
          verifierCheckedAt: "2024-01-01T00:00:00.000Z",
          outputPath: "artifacts/goal-pass.log",
        },
      }),
    );

    expect(progress).toMatchObject({
      title: "Goal passed: Persist goal output",
      detail: "original-goal-prompt GOAL_PLAN All findings fixed and residual risks accepted.",
      summaryRows: expect.arrayContaining([
        { label: "Findings", value: "Fixed setup completeness and verifier gaps." },
        { label: "Work", value: "Audit findings; Fix production gaps" },
        {
          label: "Residual",
          value: "Optional provider-backed canary accepted as residual risk pending user approval.",
        },
        { label: "Verifier", value: "pass", detail: "artifacts/goal-pass.log" },
      ]),
    });
  });

  it("formats every terminal Goal status label with stable summary rows", () => {
    const failed = formatGoalTerminalProgress(
      goalRun({ status: "failed", title: "Failing verifier", blockers: ["Tests still fail"] }),
    );
    const blocked = formatGoalTerminalProgress(
      goalRun({ status: "blocked", title: "Missing phone", blockers: ["Attach device"] }),
    );
    const paused = formatGoalTerminalProgress(
      goalRun({ status: "paused", title: "Paused review", blockers: ["User paused"] }),
    );

    expect(failed).toMatchObject({
      title: "Goal failed: Failing verifier",
      detail: "Auto-continuation stopped. Check Goal tasks for the failing step.",
      status: "failed",
      summaryRows: expect.any(Array),
    });
    expect(blocked).toMatchObject({
      title: "Goal blocked: Missing phone",
      detail: "Attach device",
      status: "blocked",
      summaryRows: expect.any(Array),
    });
    expect(paused).toMatchObject({
      title: "Goal paused: Paused review",
      detail: "User paused",
      status: "paused",
      summaryRows: expect.any(Array),
    });
    expect(formatGoalTerminalProgress(goalRun({ status: "ready" }))).toBeNull();
    expect(formatGoalTerminalProgress(goalRun({ status: "verifying" }))).toBeNull();
  });

  it("normalizes markdown and long rendered text in Goal summary rows", () => {
    const longCommand = `pnpm test ${"--filter goal-ui ".repeat(12)}with **markdown** and \`code\``;
    const rows = buildGoalSummaryRows(
      goalRun({
        status: "ready",
        successCriteria: ["Render **markdown** safely\nwithout layout churn"],
        verifier: { description: "Run markdown verifier", command: longCommand },
        evidence: [
          {
            id: "evidence-1",
            kind: "summary",
            label: "Rendered **bold** evidence\nwith newline",
            createdAt: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(rows).toHaveLength(4);
    expect(rows[1]).toMatchObject({ label: "Verifier", value: "ready" });
    expect(rows[1].detail).toContain("pnpm test --filter goal-ui");
    expect(rows[1].detail).not.toContain("\n");
    expect(rows[1].detail?.endsWith("…")).toBe(true);
    expect(rows[2]).toEqual({
      label: "Evidence",
      value: "1 recorded",
      detail: "Rendered **bold** evidence with newline",
    });
    expect(rows[3]).toEqual({
      label: "Criteria",
      value: "1 checked",
      detail: "Render **markdown** safely without layout churn",
    });
  });
});
