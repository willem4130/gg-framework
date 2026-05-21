import { describe, expect, it } from "vitest";
import type { GoalRun } from "../core/goal-store.js";
import {
  clampGoalDetailScrollOffset,
  clampGoalScrollOffset,
  clampGoalSelectedIndex,
  getGoalCardExtraRowCount,
  getGoalDetailRowCount,
  getGoalDetailScrollWindow,
  getGoalExpandedDetailViewportRows,
  getGoalListCardRowCount,
  getGoalListWindow,
  getGoalOverlayViewportRows,
  getGoalScrollOffsetForSelection,
  formatGoalPrerequisiteSummary,
  formatGoalProgressText,
  formatGoalTaskDetailSummary,
  formatGoalTaskSummary,
  formatGoalVerifierSummary,
  getGoalReadinessText,
  getGoalCardStatusColor,
  getGoalCardTitleColor,
  getGoalDetailTaskHeading,
  getGoalStatusCountsText,
  getGoalUserPrerequisiteHeading,
  shouldPersistGoalOverlayRuns,
  sortGoalRunsForOverlay,
} from "./components/GoalOverlay.js";

function goalRun(overrides: Partial<GoalRun>): GoalRun {
  return {
    id: "goal-1",
    title: "Goal",
    goal: "Goal text",
    status: "ready",
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

describe("goal overlay helpers", () => {
  it("sorts runs newest first", () => {
    const oldRun = goalRun({ id: "old", updatedAt: "2024-01-01T00:00:00.000Z" });
    const newRun = goalRun({ id: "new", updatedAt: "2024-02-01T00:00:00.000Z" });

    expect(sortGoalRunsForOverlay([oldRun, newRun]).map((run) => run.id)).toEqual(["new", "old"]);
  });

  it("clamps selected index", () => {
    expect(clampGoalSelectedIndex(3, 0)).toBe(0);
    expect(clampGoalSelectedIndex(-1, 3)).toBe(0);
    expect(clampGoalSelectedIndex(4, 3)).toBe(2);
    expect(clampGoalSelectedIndex(1, 3)).toBe(1);
  });

  it("clamps bounded Goal viewport scroll offsets", () => {
    expect(clampGoalScrollOffset(-2, 20, 5)).toBe(0);
    expect(clampGoalScrollOffset(99, 20, 5)).toBe(15);
    expect(clampGoalScrollOffset(4.8, 20, 5)).toBe(4);
    expect(clampGoalScrollOffset(Number.NaN, 20, 5)).toBe(0);
    expect(clampGoalScrollOffset(5, 3, 8)).toBe(0);
  });

  it("derives conservative internal viewport limits from terminal rows", () => {
    expect(getGoalOverlayViewportRows(30)).toBe(22);
    expect(getGoalOverlayViewportRows(8)).toBe(4);
    expect(getGoalOverlayViewportRows(Number.NaN)).toBe(8);
  });

  it("budgets complete cards by actual rows before showing another goal", () => {
    const runs = [
      goalRun({ id: "a" }),
      goalRun({ id: "b" }),
      goalRun({ id: "c" }),
      goalRun({ id: "d" }),
    ];

    expect(getGoalListWindow({ runs: [], selectedIndex: 0, viewportRows: 8 })).toMatchObject({
      rowsUsed: 1,
    });
    expect(getGoalListCardRowCount({ run: runs[0] })).toBe(4);
    expect(getGoalListWindow({ runs, selectedIndex: 0, viewportRows: 13 })).toEqual({
      start: 0,
      end: 2,
      hiddenBefore: 0,
      hiddenAfter: 2,
      rowsUsed: 10,
    });
    expect(getGoalListWindow({ runs, selectedIndex: 3, viewportRows: 13 })).toEqual({
      start: 2,
      end: 4,
      hiddenBefore: 2,
      hiddenAfter: 0,
      rowsUsed: 10,
    });
  });

  it("keeps expanded selection visible without growing terminal scrollback", () => {
    expect(
      getGoalScrollOffsetForSelection({
        selectedIndex: 12,
        currentOffset: 0,
        itemCount: 30,
        viewportRows: 5,
      }),
    ).toBe(8);
    expect(
      getGoalScrollOffsetForSelection({
        selectedIndex: 4,
        currentOffset: 8,
        itemCount: 30,
        viewportRows: 5,
      }),
    ).toBe(4);
    expect(
      getGoalScrollOffsetForSelection({
        selectedIndex: 10,
        currentOffset: 8,
        itemCount: 30,
        viewportRows: 5,
      }),
    ).toBe(8);
  });

  it("counts and clamps expanded detail rows for an internal detail viewport", () => {
    const run = goalRun({
      prerequisites: [
        { id: "cli", label: "CLI", status: "met", evidence: "available" },
        { id: "token", label: "Token", status: "missing", instructions: "Provide token." },
      ],
      tasks: [
        {
          id: "task-a",
          title: "Task A",
          prompt: "Do A",
          status: "done",
          attempts: 1,
          lastSummary: "Implemented A.",
        },
        { id: "task-b", title: "Task B", prompt: "Do B", status: "pending", attempts: 0 },
      ],
      verifier: { description: "Run tests", command: "pnpm test" },
    });

    expect(getGoalDetailRowCount(run)).toBe(15);
    expect(clampGoalDetailScrollOffset(-1, 15, 5)).toBe(0);
    expect(clampGoalDetailScrollOffset(99, 15, 5)).toBe(11);
    expect(clampGoalDetailScrollOffset(Number.NaN, 15, 5)).toBe(0);
  });

  it("counts full Goal metadata in expanded details", () => {
    const run = goalRun({
      goal: "Long objective",
      successCriteria: ["criterion one", "criterion two"],
      harness: [{ id: "harness", label: "Harness", command: "pnpm test" }],
      evidencePlan: [
        {
          id: "proof",
          label: "Proof path",
          mechanism: "test",
          description: "Run proof",
          status: "planned",
          command: "pnpm test",
        },
      ],
      blockers: ["Needs user input"],
      evidence: [
        {
          id: "evidence",
          kind: "command",
          label: "Verifier result",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(getGoalDetailRowCount(run)).toBe(15);
  });

  it("reserves expanded detail space without showing other goals", () => {
    expect(getGoalCardExtraRowCount(goalRun({}))).toBe(0);
    expect(
      getGoalCardExtraRowCount(
        goalRun({ prerequisites: [{ id: "token", label: "Token", status: "missing" }] }),
      ),
    ).toBe(1);
    expect(getGoalCardExtraRowCount(goalRun({ blockers: ["Blocked"] }))).toBe(1);
    expect(getGoalExpandedDetailViewportRows({ viewportRows: 20, cardExtraRows: 0 })).toBe(14);
    expect(getGoalExpandedDetailViewportRows({ viewportRows: 20, cardExtraRows: 2 })).toBe(12);
  });

  it("reserves fixed rows for detail scroll indicators instead of growing terminal scrollback", () => {
    expect(
      getGoalDetailScrollWindow({ detailRowCount: 12, scrollOffset: 0, viewportRows: 5 }),
    ).toEqual({ start: 0, end: 4, hiddenBefore: 0, hiddenAfter: 8 });
    expect(
      getGoalDetailScrollWindow({ detailRowCount: 12, scrollOffset: 4, viewportRows: 5 }),
    ).toEqual({ start: 4, end: 7, hiddenBefore: 4, hiddenAfter: 5 });
    expect(
      getGoalDetailScrollWindow({ detailRowCount: 12, scrollOffset: 99, viewportRows: 5 }),
    ).toEqual({ start: 8, end: 12, hiddenBefore: 8, hiddenAfter: 0 });
  });

  it("summarizes prerequisites including blocking states", () => {
    const run = goalRun({
      prerequisites: [
        { id: "cli", label: "CLI", status: "met" },
        { id: "sim", label: "Simulator", status: "missing" },
        { id: "data", label: "Fixture data", status: "unknown" },
      ],
    });

    expect(formatGoalPrerequisiteSummary(run)).toBe("1/3 prereqs met (1 missing, 1 unknown)");
  });

  it("puts user prerequisites before worker tasks in detail headings", () => {
    const run = goalRun({
      prerequisites: [
        {
          id: "supabase-token",
          label: "Supabase token",
          status: "missing",
          instructions: "Provide SUPABASE_ACCESS_TOKEN.",
        },
      ],
    });

    expect(getGoalUserPrerequisiteHeading(run)).toBe("1. User prerequisites");
    expect(getGoalDetailTaskHeading(run)).toBe("2. Worker tasks");
    expect(getGoalUserPrerequisiteHeading(goalRun({}))).toBeNull();
    expect(getGoalDetailTaskHeading(goalRun({}))).toBe("Worker tasks");
  });

  it("summarizes task states", () => {
    const run = goalRun({
      tasks: [
        { id: "a", title: "A", prompt: "A", status: "done", attempts: 1 },
        { id: "b", title: "B", prompt: "B", status: "running", attempts: 2 },
        { id: "c", title: "C", prompt: "C", status: "failed", attempts: 1 },
        { id: "d", title: "D", prompt: "D", status: "blocked", attempts: 0 },
      ],
    });

    expect(formatGoalTaskSummary(run)).toBe("1/4 tasks done (1 running, 1 failed, 1 blocked)");
  });

  it("summarizes task detail with only the first concise line", () => {
    expect(formatGoalTaskDetailSummary("\nChanged the harness.\nVerified tests.")).toBe(
      "Changed the harness.",
    );
    expect(formatGoalTaskDetailSummary("\n\n")).toBe("");
    expect(formatGoalTaskDetailSummary("x".repeat(220))).toBe(`${"x".repeat(177)}…`);
  });

  it("formats concise progress and readiness affordances", () => {
    expect(formatGoalProgressText(goalRun({}))).toBe("no prereqs · no tasks");
    expect(
      formatGoalProgressText(
        goalRun({
          prerequisites: [
            { id: "a", label: "A", status: "met" },
            { id: "b", label: "B", status: "missing" },
          ],
          tasks: [
            { id: "t1", title: "T1", prompt: "Do it", status: "done", attempts: 1 },
            { id: "t2", title: "T2", prompt: "Do more", status: "pending", attempts: 0 },
          ],
        }),
      ),
    ).toBe("prereqs 1/2 · tasks 1/2");

    expect(
      getGoalReadinessText(
        goalRun({ prerequisites: [{ id: "token", label: "Token", status: "missing" }] }),
      ),
    ).toBe("needs user input");
    expect(getGoalReadinessText(goalRun({ status: "running" }))).toBe("work in progress");
    expect(getGoalReadinessText(goalRun({ status: "passed" }))).toBe("verified");
    expect(
      getGoalReadinessText(
        goalRun({ verifier: { description: "Run tests", command: "pnpm test" } }),
      ),
    ).toBe("ready to verify");
  });

  it("summarizes verifier state", () => {
    expect(formatGoalVerifierSummary(goalRun({}))).toBe("no verifier");
    expect(
      formatGoalVerifierSummary(
        goalRun({ verifier: { description: "Run tests", command: "pnpm test" } }),
      ),
    ).toBe("verifier command ready");
    expect(
      formatGoalVerifierSummary(
        goalRun({
          verifier: {
            description: "Run tests",
            lastResult: {
              status: "pass",
              summary: "passed",
              checkedAt: "2024-01-01T00:00:00.000Z",
            },
          },
        }),
      ),
    ).toBe("verifier pass");
  });

  it("formats status counts for header", () => {
    const runs = [
      goalRun({ id: "passed", status: "passed" }),
      goalRun({ id: "running", status: "running" }),
      goalRun({ id: "paused", status: "paused" }),
      goalRun({ id: "blocked", status: "blocked" }),
    ];

    expect(getGoalStatusCountsText(runs)).toBe("1 passed · 1 running · 1 pending · 1 blocked");
  });

  it("keeps unselected goal cards readable when multiple goals are listed", () => {
    expect(
      getGoalCardStatusColor({
        status: "ready",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("text");
    expect(
      getGoalCardStatusColor({
        status: "passed",
        selected: false,
        primaryColor: "primary",
        textColor: "text",
      }),
    ).toBe("#4ade80");
    expect(
      getGoalCardTitleColor({ selected: false, primaryColor: "primary", textColor: "text" }),
    ).toBe("text");
    expect(
      getGoalCardTitleColor({ selected: true, primaryColor: "primary", textColor: "text" }),
    ).toBe("primary");
  });

  it("refuses to persist a transient empty overlay state while active Goal work exists", () => {
    const activeRuns = [
      goalRun({
        id: "active",
        status: "running",
        activeWorkerId: "worker-a",
        tasks: [
          {
            id: "task-a",
            title: "Active work",
            prompt: "Do work",
            status: "running",
            attempts: 1,
            workerId: "worker-a",
          },
        ],
      }),
    ];

    expect(shouldPersistGoalOverlayRuns(activeRuns, [])).toBe(false);
    expect(shouldPersistGoalOverlayRuns(activeRuns, [goalRun({ id: "next" })])).toBe(true);
    expect(shouldPersistGoalOverlayRuns([goalRun({ id: "done", status: "passed" })], [])).toBe(
      true,
    );
  });
});
