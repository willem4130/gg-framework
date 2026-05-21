import { describe, expect, it } from "vitest";
import type { GoalRun } from "./goal-store.js";
import {
  canCompleteGoalRun,
  decideGoalNextAction,
  formatGoalControllerDecision,
  shouldClearGoalContinuation,
} from "./goal-controller.js";

function goalRun(overrides: Partial<GoalRun> = {}): GoalRun {
  return {
    id: "goal-a",
    title: "Programmatic loop",
    goal: "Make the loop deterministic",
    status: "ready",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    projectPath: "/tmp/project",
    successCriteria: ["Verifier passes"],
    prerequisites: [],
    harness: [],
    evidencePlan: [],
    tasks: [],
    evidence: [],
    blockers: [],
    ...overrides,
  };
}

describe("goal controller", () => {
  it("starts the next pending worker task deterministically", () => {
    const task = {
      id: "task-a",
      title: "Implement loop",
      prompt: "Do work",
      status: "pending" as const,
      attempts: 1,
    };

    expect(decideGoalNextAction(goalRun({ tasks: [task] }))).toEqual({
      kind: "start_worker",
      task,
      attempts: 2,
      reason: 'Goal task "Implement loop" is ready for worker attempt 2.',
    });
  });

  it("waits instead of starting duplicate work when a worker or task is active", () => {
    expect(decideGoalNextAction(goalRun({ activeWorkerId: "worker-a" }))).toEqual({
      kind: "wait",
      reason: "Goal already has an active worker.",
      workerId: "worker-a",
    });
    expect(
      decideGoalNextAction(
        goalRun({
          tasks: [
            {
              id: "task-a",
              title: "Running task",
              prompt: "Do work",
              status: "running",
              workerId: "worker-a",
              attempts: 1,
            },
          ],
        }),
      ),
    ).toMatchObject({ kind: "wait", workerId: "worker-a" });
  });

  it("treats closure evidence and ready evidence-plan items as satisfied after verifier pass", () => {
    const run = goalRun({
      evidencePlan: [
        {
          id: "ready-proof",
          label: "Ready proof",
          mechanism: "test",
          description: "Ready proof was produced by the harness.",
          status: "ready",
          evidence: "Regression harness artifact was recorded.",
        },
        {
          id: "closure-proof",
          label: "Closure proof",
          mechanism: "browser",
          description: "Browser closure evidence proves the flow works.",
          status: "planned",
        },
        {
          id: "verifier-output-proof",
          label: "Verifier output proof",
          mechanism: "screenshot",
          description: "Capture final verifier artifact.",
          status: "planned",
          path: "artifacts/final-verifier.log",
        },
      ],
      evidence: [
        {
          id: "evidence-closure-proof",
          createdAt: "2024-01-01T00:00:00.000Z",
          kind: "summary",
          label: "Closure proof",
          content: "Closure evidence recorded after the worker finished.",
        },
      ],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "pass",
          summary: "Verifier passed and wrote final artifact.",
          command: "pnpm test",
          outputPath: "artifacts/final-verifier.log",
          checkedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });
    expect(canCompleteGoalRun(run)).toEqual({
      ok: true,
      reason: "All tasks are done and verifier evidence passed.",
    });
    expect(decideGoalNextAction(run)).toEqual({
      kind: "complete",
      reason: "All tasks are done and verifier evidence passed.",
    });
  });

  it("blocks instead of spawning repeated evidence-path workers after verifier success", () => {
    const decision = decideGoalNextAction(
      goalRun({
        evidencePlan: [
          {
            id: "proof",
            label: "Unmatched proof",
            mechanism: "browser",
            description: "Needs screenshot",
            status: "planned",
          },
        ],
        verifier: {
          description: "Full check",
          command: "pnpm test",
          lastResult: {
            status: "pass",
            summary: "tests passed",
            command: "pnpm test",
            checkedAt: "2024-01-01T00:00:00.000Z",
          },
        },
      }),
    );
    expect(decision).toEqual({
      kind: "blocked",
      reason:
        "Verifier passed, but the Goal evidence plan is still not satisfied; blocking instead of creating repeated evidence-path workers.",
    });
  });

  it("runs the verifier only after all tasks are done", () => {
    expect(
      decideGoalNextAction(
        goalRun({
          tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
          verifier: { description: "Full check", command: "pnpm test" },
        }),
      ),
    ).toEqual({
      kind: "run_verifier",
      command: "pnpm test",
      reason: "All Goal tasks are done; running configured verifier for real completion evidence.",
    });
  });

  it("creates a verifier-building task when done tasks have no verifier command", () => {
    expect(
      decideGoalNextAction(
        goalRun({
          tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
        }),
      ),
    ).toMatchObject({
      kind: "create_task",
      title: "Define Goal verifier",
      reason: "No pending Goal task or verifier command is configured.",
    });
  });

  it("creates a mobile/UI evidence-path task before verifier execution when proof is only planned", () => {
    const decision = decideGoalNextAction(
      goalRun({
        goal: "Make the mobile checkout screen render correctly on small viewports",
        tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
        evidencePlan: [
          {
            id: "mobile-ui-proof",
            label: "iOS simulator screenshot comparison",
            mechanism: "screenshot",
            description:
              "Capture the mobile checkout screen in a local simulator or browser viewport and compare the image/frame output.",
            status: "planned",
            path: "artifacts/mobile-checkout-diff.png",
          },
        ],
        verifier: { description: "Full check", command: "pnpm test:e2e" },
      }),
    );

    expect(decision).toMatchObject({
      kind: "create_task",
      title: "Build Goal evidence path",
      reason:
        "Goal evidence plan requires local instrumentation or exact prerequisite handling before verification.",
    });
    const prompt = decision.kind === "create_task" ? decision.prompt : "";
    expect(prompt).toContain("iOS simulator screenshot comparison (screenshot)");
    expect(prompt).toContain("what would prove this goal actually worked end-to-end");
    expect(prompt).toContain("observable proof paths");
    expect(prompt).toContain("not narrative-only verification or human visual inspection");
    expect(prompt).toContain("dev servers");
    expect(prompt).toContain("browser automation");
    expect(prompt).toContain("logs");
    expect(prompt).toContain("generated fixtures");
    expect(prompt).toContain("source/docs/code-search comparison");
    expect(prompt).toContain("iOS Simulator screenshots when available");
    expect(prompt).toContain("image/frame checks");
  });

  it("blocks when an evidence plan item requires a true external prerequisite", () => {
    expect(
      decideGoalNextAction(
        goalRun({
          tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
          evidencePlan: [
            {
              id: "device-proof",
              label: "Physical iPhone capture",
              mechanism: "device",
              description: "Run on a real phone.",
              status: "blocked",
              instructions: "Connect an unlocked iPhone with Developer Mode enabled.",
            },
          ],
          verifier: { description: "Full check", command: "pnpm test:e2e" },
        }),
      ),
    ).toEqual({
      kind: "blocked",
      reason: "Physical iPhone capture: Connect an unlocked iPhone with Developer Mode enabled.",
    });
  });

  it("creates a harness-building task before verifier execution when instrumentation is missing", () => {
    expect(
      decideGoalNextAction(
        goalRun({
          tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
          harness: [{ id: "harness-a", label: "Browser fixture", description: "Create fixture" }],
          verifier: { description: "Full check", command: "pnpm test:e2e" },
        }),
      ),
    ).toMatchObject({
      kind: "create_task",
      title: "Build Goal verification harness",
      reason: "Goal harness requires local instrumentation before verification.",
    });
  });

  it("blocks missing prerequisites with exact user instructions", () => {
    expect(
      decideGoalNextAction(
        goalRun({
          prerequisites: [
            {
              id: "api-key",
              label: "Demo API key",
              status: "missing",
              instructions: "Provide DEMO_API_KEY in the local environment.",
            },
          ],
        }),
      ),
    ).toEqual({
      kind: "blocked",
      reason: "Demo API key: Provide DEMO_API_KEY in the local environment.",
    });
  });

  it("creates a bounded fix task for verifier failure when resumed", () => {
    const run = goalRun({
      tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "tests failed",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
          outputPath: ".gg/log.log",
        },
      },
      evidence: [
        {
          id: "evidence-a",
          kind: "command",
          label: "Verifier fail",
          content: "tests failed",
          path: ".gg/log.log",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });
    const decision = decideGoalNextAction(run);
    expect(decision).toMatchObject({
      kind: "create_task",
      title: "Fix verifier failure",
      reason: "Verifier failed; creating bounded fix task 1/5.",
    });
    expect(decision.kind === "create_task" ? decision.prompt : "").toContain(
      "Output path: .gg/log.log",
    );
  });

  it("blocks repeated identical verifier failures instead of looping forever", () => {
    const run = goalRun({
      tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "same",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
        },
      },
      evidence: [
        {
          id: "e1",
          kind: "command",
          label: "Verifier fail",
          content: "same",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
        {
          id: "e2",
          kind: "command",
          label: "Verifier fail",
          content: "same",
          createdAt: "2024-01-01T00:00:01.000Z",
        },
      ],
    });
    expect(decideGoalNextAction(run)).toEqual({
      kind: "blocked",
      reason:
        "Verifier produced the same failure repeatedly; pause for diagnosis before creating more fix tasks.",
    });
  });

  it("treats failed status as terminal unless a later tool action revives it to ready", () => {
    const run = goalRun({
      status: "failed",
      tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "fail",
          summary: "tests failed",
          checkedAt: "2024-01-01T00:00:00.000Z",
          exitCode: 1,
        },
      },
      evidence: [
        {
          id: "evidence-a",
          kind: "command",
          label: "Verifier result",
          content: "tests failed",
          createdAt: "2024-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(canCompleteGoalRun(run)).toEqual({ ok: false, reason: "Verifier status is fail." });
    expect(decideGoalNextAction(run)).toEqual({
      kind: "terminal",
      status: "failed",
      reason: "Goal is failed.",
    });
  });

  it("completes only with all tasks done and pass verifier evidence", () => {
    const run = goalRun({
      tasks: [{ id: "task-a", title: "Done", prompt: "Done", status: "done", attempts: 1 }],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "pass",
          summary: "passed",
          checkedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    expect(canCompleteGoalRun(run)).toEqual({
      ok: true,
      reason: "All tasks are done and verifier evidence passed.",
    });
    expect(decideGoalNextAction(run)).toEqual({
      kind: "complete",
      reason: "All tasks are done and verifier evidence passed.",
    });
  });

  it("does not complete when verifier passed but tasks remain", () => {
    const run = goalRun({
      tasks: [
        { id: "done", title: "Done", prompt: "Done", status: "done", attempts: 1 },
        { id: "pending", title: "Pending", prompt: "Pending", status: "pending", attempts: 0 },
      ],
      verifier: {
        description: "Full check",
        command: "pnpm test",
        lastResult: {
          status: "pass",
          summary: "passed",
          checkedAt: "2024-01-01T00:00:00.000Z",
        },
      },
    });

    expect(canCompleteGoalRun(run)).toEqual({ ok: false, reason: "1 Goal task is not done." });
    expect(decideGoalNextAction(run)).toMatchObject({ kind: "start_worker" });
  });

  it("retries a failed task below the attempt limit for corrective work", () => {
    const task = {
      id: "task-a",
      title: "Repair verifier failure",
      prompt: "Fix the verifier failure using persisted evidence",
      status: "failed" as const,
      attempts: 1,
      lastSummary: "Verifier failed: assertion mismatch",
    };

    expect(decideGoalNextAction(goalRun({ tasks: [task] }))).toEqual({
      kind: "start_worker",
      task,
      attempts: 2,
      reason: 'Goal task "Repair verifier failure" is ready for worker attempt 2.',
    });
  });

  it("formats durable-readable controller decisions", () => {
    const decision = decideGoalNextAction(goalRun({ tasks: [] }));
    const formatted = formatGoalControllerDecision(decision);
    expect(formatted.label).toBe(`Goal decision: ${decision.kind}`);
    expect(formatted.content).toContain(`kind=${decision.kind}`);
    expect(shouldClearGoalContinuation({ kind: "wait", reason: "active" })).toBe(false);
    expect(shouldClearGoalContinuation(decision)).toBe(true);
  });

  it("pauses after repeated non-progress rather than looping forever", () => {
    const task = {
      id: "task-a",
      title: "Flaky repair",
      prompt: "Do work",
      status: "failed" as const,
      attempts: 5,
    };

    expect(decideGoalNextAction(goalRun({ tasks: [task] }))).toEqual({
      kind: "pause",
      task,
      attempts: 6,
      reason: "Attempt limit reached for task Flaky repair.",
    });
  });
});
