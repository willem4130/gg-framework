import assert from "node:assert/strict";
import { decideGoalNextAction, canCompleteGoalRun } from "../src/core/goal-controller.js";
import type { GoalRun, GoalTask } from "../src/core/goal-store.js";
import {
  buildGoalWorkerSyntheticEventPayload,
  buildGoalVerifierSyntheticEventPayload,
  formatGoalWorkerCompletionEvent,
  formatGoalVerifierCompletionEvent,
  parseGoalSyntheticEvent,
} from "../src/ui/goal-events.js";
import type { GoalWorkerCompletion } from "../src/core/goal-worker.js";

const now = "2026-01-01T00:00:00.000Z";

function baseRun(overrides: Partial<GoalRun> = {}): GoalRun {
  return {
    id: "goal-e2e-run",
    title: "Deterministic Goal lifecycle harness",
    goal: "Prove Goal orchestration lifecycle without live model credentials.",
    status: "running",
    createdAt: now,
    updatedAt: now,
    projectPath: process.cwd(),
    successCriteria: ["controller decisions are deterministic", "events are parseable"],
    prerequisites: [],
    harness: [],
    evidencePlan: [],
    tasks: [],
    evidence: [],
    blockers: [],
    ...overrides,
  };
}

function task(overrides: Partial<GoalTask> = {}): GoalTask {
  return {
    id: "task-1",
    title: "Implement local proof",
    prompt: "Create deterministic local proof.",
    status: "pending",
    attempts: 0,
    ...overrides,
  };
}

function assertDecision(run: GoalRun, kind: ReturnType<typeof decideGoalNextAction>["kind"], message: string) {
  const decision = decideGoalNextAction(run);
  assert.equal(decision.kind, kind, `${message}: expected ${kind}, got ${decision.kind} (${decision.reason})`);
  return decision;
}

const blockedPrereq = baseRun({
  prerequisites: [{ id: "p1", label: "API token", status: "missing", instructions: "Provide token." }],
});
assertDecision(blockedPrereq, "blocked", "missing prerequisites block lifecycle");
assert.equal(canCompleteGoalRun(blockedPrereq).ok, false);

const plannedEvidence = baseRun({
  evidencePlan: [{ id: "e1", label: "CLI proof", mechanism: "command", description: "Run local CLI", status: "planned" }],
});
assertDecision(plannedEvidence, "create_task", "planned evidence creates instrumentation task");

const blockedEvidence = baseRun({
  evidencePlan: [{ id: "e1", label: "External proof", mechanism: "manual", description: "External account", status: "blocked", instructions: "User login required." }],
});
assertDecision(blockedEvidence, "blocked", "blocked evidence plan blocks lifecycle");

const pendingTaskRun = baseRun({ tasks: [task()] });
const start = assertDecision(pendingTaskRun, "start_worker", "pending task starts worker");
assert.equal(start.kind === "start_worker" && start.attempts, 1);

const runningTaskRun = baseRun({ tasks: [task({ status: "running", workerId: "worker-1", attempts: 1 })] });
assertDecision(runningTaskRun, "wait", "running task emits wait decision");

const workerCompletion: GoalWorkerCompletion = {
  worker: {
    id: "worker-1",
    runId: pendingTaskRun.id,
    goalTaskId: "task-1",
    title: "Implement local proof",
    prompt: "Create deterministic local proof.",
    status: "done",
    attempts: 1,
    logFile: "tmp/goal-worker.log",
    startedAt: now,
  },
  status: "done",
  exitCode: 0,
  summary: "Worker completed local proof.",
  toolsUsed: [{ name: "bash", ok: true }],
};
const workerEvent = formatGoalWorkerCompletionEvent(pendingTaskRun, "Implement local proof", workerCompletion);
const parsedWorker = parseGoalSyntheticEvent(workerEvent);
assert.equal(parsedWorker?.kind, "worker");
assert.equal(parsedWorker?.status, "done");
assert.equal(buildGoalWorkerSyntheticEventPayload(pendingTaskRun, "Implement local proof", workerCompletion).toolsUsed[0]?.name, "bash");

const readyForVerifier = baseRun({
  tasks: [task({ status: "done", attempts: 1 })],
  evidencePlan: [{ id: "e1", label: "Verifier output", mechanism: "command", description: "Verifier passes", status: "ready", command: "pnpm goal:e2e", evidence: "pass" }],
  verifier: { description: "local verifier", command: "pnpm goal:e2e" },
});
assertDecision(readyForVerifier, "run_verifier", "ready run executes verifier");

const verifierFailRun = baseRun({
  tasks: [task({ status: "done", attempts: 1 })],
  evidencePlan: readyForVerifier.evidencePlan,
  verifier: { description: "local verifier", command: "pnpm goal:e2e", lastResult: { status: "fail", summary: "failed", command: "pnpm goal:e2e", exitCode: 1, outputPath: "tmp/fail.log", checkedAt: now } },
});
assertDecision(verifierFailRun, "create_task", "verifier failure creates bounded fix task");
const failEvent = formatGoalVerifierCompletionEvent(verifierFailRun, "fail", "pnpm goal:e2e", 1, "failed deterministically");
assert.equal(parseGoalSyntheticEvent(failEvent)?.kind, "verifier");
assert.equal(buildGoalVerifierSyntheticEventPayload(verifierFailRun, "fail", "pnpm goal:e2e", 1, "failed").completionGuidance.includes("bounded fix task"), true);

const completeRun = baseRun({
  status: "running",
  tasks: [task({ status: "done", attempts: 1 })],
  evidence: [{ id: "ev1", kind: "command", label: "Verifier output", path: "tmp/pass.log", content: "Verifier output pass", createdAt: now }],
  evidencePlan: readyForVerifier.evidencePlan,
  verifier: { description: "local verifier", command: "pnpm goal:e2e", lastResult: { status: "pass", summary: "Verifier output pass", command: "pnpm goal:e2e", exitCode: 0, outputPath: "tmp/pass.log", checkedAt: now } },
});
assert.equal(canCompleteGoalRun(completeRun).ok, true);
assertDecision(completeRun, "complete", "pass verifier plus evidence completes lifecycle");
const passEvent = formatGoalVerifierCompletionEvent(completeRun, "pass", "pnpm goal:e2e", 0, "passed deterministically");
const parsedPass = parseGoalSyntheticEvent(passEvent);
assert.equal(parsedPass?.kind, "verifier");
assert.equal(parsedPass?.status, "pass");

const terminalRun = baseRun({ status: "passed" });
assertDecision(terminalRun, "terminal", "passed run remains terminal");

console.log("Goal lifecycle harness passed: prerequisites blocked, evidence planned/blocked, worker and verifier events parsed, verifier fail fixes, ready run verifies, complete run completes.");
