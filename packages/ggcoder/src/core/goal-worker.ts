import { spawn, type ChildProcess } from "node:child_process";
import { createInterface } from "node:readline";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Provider } from "@kenkaiiii/gg-ai";
import { killProcessTree } from "../utils/process.js";
import { log } from "./logger.js";
import {
  appendGoalEvidence,
  projectDir,
  updateGoalTask,
  upsertGoalRun,
  getGoalRun,
  type GoalRun,
} from "./goal-store.js";

const DEFAULT_GOAL_WORKER_MAX_TURNS = 12;
const MAX_SUMMARY_CHARS = 4000;

export interface GoalWorkerRecord {
  id: string;
  pid: number;
  goalRunId: string;
  goalTaskId: string;
  cwd: string;
  provider: Provider;
  model: string;
  startedAt: string;
  logFile: string;
  status: "running" | "done" | "failed" | "stopped";
  exitCode: number | null;
  currentActivity?: string;
}

export interface GoalWorkerToolUse {
  name: string;
  ok: boolean;
}

export interface GoalWorkerCompletion {
  worker: GoalWorkerRecord;
  summary: string;
  status: "done" | "failed";
  exitCode: number;
  toolsUsed: GoalWorkerToolUse[];
  reason?: "exit" | "spawn_error" | "timeout";
}

export type GoalWorkerCompletionListener = (completion: GoalWorkerCompletion) => void;

interface GoalWorkerCompletionSubscription {
  projectPath?: string;
  listener: GoalWorkerCompletionListener;
}

export interface StartGoalWorkerOptions {
  cwd: string;
  provider: Provider;
  model: string;
  goalRunId: string;
  goalTaskId: string;
  prompt: string;
  systemPrompt?: string;
  parentCacheKey?: string;
  maxTurns?: number;
  onComplete?: (completion: GoalWorkerCompletion) => void;
}

const workers = new Map<string, GoalWorkerRecord>();
const children = new Map<string, ChildProcess>();
const completionSubscriptions = new Set<GoalWorkerCompletionSubscription>();
const pendingCompletions: GoalWorkerCompletion[] = [];
const MAX_PENDING_COMPLETIONS = 100;

function getCliPath(): string {
  return process.argv[1] ?? "";
}

function goalWorkerSystemPrompt(goalRunId: string, goalTaskId: string): string {
  return (
    "You are a disposable Goal worker running inside the same project as the main GG Coder session. " +
    "Follow only the assigned Goal task prompt. Keep changes focused, use local/free tools, source_path/docs/kencode real-code research when relevant, and translate the requested outcome into observable proof: ask what would prove this goal actually worked end-to-end, then create the simplest reliable local/free proof path for the domain. " +
    "create needed scripts/fixtures/harnesses and use tests, local CLIs, dev servers, browser/simulator/device screenshots, video/frame inspection, logs, generated assets, protocol traces, database assertions, API probes, contract tests, performance measurements, source/docs comparison, or other artifacts as appropriate; for mobile/UI, prefer local simulator/browser evidence such as iOS Simulator screenshots when available before requiring a physical phone. " +
    "Run requested verification and update durable Goal state with the goals tool using command/file evidence, screenshot/log evidence, not narrative or human visual inspection. Worker-started background processes, including dev servers, are worker-owned and are cleaned up when this worker CLI exits; if a later worker/verifier needs a persistent server, record instructions or metadata for the orchestrator to start/provide the localhost URL instead of relying on your background process. Record evidence and task status for " +
    `goal ${goalRunId}, task ${goalTaskId}. Do not mark the whole goal complete; only the orchestrator/verifier can complete it.`
  );
}

function appendSummary(summary: string, text: string): string {
  const next = summary + text;
  return next.length > MAX_SUMMARY_CHARS ? next.slice(next.length - MAX_SUMMARY_CHARS) : next;
}

function completionMatchesProject(
  completion: GoalWorkerCompletion,
  projectPath: string | undefined,
): boolean {
  return projectPath === undefined || completion.worker.cwd === projectPath;
}

function emitGoalWorkerCompletion(completion: GoalWorkerCompletion): void {
  let delivered = false;
  for (const subscription of completionSubscriptions) {
    if (!completionMatchesProject(completion, subscription.projectPath)) continue;
    delivered = true;
    try {
      subscription.listener(completion);
    } catch (err) {
      log("ERROR", "goal-worker", err instanceof Error ? err.message : String(err));
    }
  }
  if (delivered) return;

  pendingCompletions.push(completion);
  if (pendingCompletions.length > MAX_PENDING_COMPLETIONS) {
    pendingCompletions.splice(0, pendingCompletions.length - MAX_PENDING_COMPLETIONS);
  }
}

export function subscribeGoalWorkerCompletions(
  listener: GoalWorkerCompletionListener,
  projectPath?: string,
): () => void {
  const subscription: GoalWorkerCompletionSubscription = { listener, projectPath };
  completionSubscriptions.add(subscription);

  for (let index = 0; index < pendingCompletions.length; ) {
    const completion = pendingCompletions[index]!;
    if (!completionMatchesProject(completion, projectPath)) {
      index += 1;
      continue;
    }
    pendingCompletions.splice(index, 1);
    try {
      listener(completion);
    } catch (err) {
      log("ERROR", "goal-worker", err instanceof Error ? err.message : String(err));
    }
  }

  return () => {
    completionSubscriptions.delete(subscription);
  };
}

function formatActivity(name: string, args: Record<string, unknown>): string {
  const firstString = Object.values(args).find((value) => typeof value === "string") as
    | string
    | undefined;
  return firstString ? `${name}: ${firstString.slice(0, 80)}` : name;
}

async function setRunWorker(
  cwd: string,
  runId: string,
  workerId: string | undefined,
): Promise<void> {
  const run = await getGoalRun(cwd, runId);
  if (!run) return;
  const patch: GoalRun = workerId
    ? { ...run, activeWorkerId: workerId, status: "running" }
    : {
        ...run,
        activeWorkerId: undefined,
        status: run.status === "running" ? "ready" : run.status,
      };
  await upsertGoalRun(cwd, patch);
}

export async function startGoalWorker(options: StartGoalWorkerOptions): Promise<GoalWorkerRecord> {
  const cliPath = getCliPath();
  if (!cliPath) throw new Error("Cannot start Goal worker: CLI path is unavailable.");

  const existing = listGoalWorkers(options.cwd).find(
    (worker) => worker.goalRunId === options.goalRunId && worker.status === "running",
  );
  if (existing) return existing;

  const workerId = randomUUID().slice(0, 8);
  const workerDir = join(projectDir(options.cwd), "workers");
  await mkdir(workerDir, { recursive: true });
  const logFile = join(workerDir, `${workerId}.ndjson`);
  const logStream = createWriteStream(logFile, { flags: "a" });

  const cliArgs = [
    "--json",
    "--provider",
    options.provider,
    "--model",
    options.model,
    "--max-turns",
    String(options.maxTurns ?? DEFAULT_GOAL_WORKER_MAX_TURNS),
    "--system-prompt",
    options.systemPrompt ?? goalWorkerSystemPrompt(options.goalRunId, options.goalTaskId),
  ];
  if (options.parentCacheKey) {
    cliArgs.push("--prompt-cache-key", `${options.parentCacheKey}:goal`);
  }
  cliArgs.push(options.prompt);

  const child = spawn(process.execPath, [cliPath, ...cliArgs], {
    cwd: options.cwd,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env },
  });

  const record: GoalWorkerRecord = {
    id: workerId,
    pid: child.pid ?? 0,
    goalRunId: options.goalRunId,
    goalTaskId: options.goalTaskId,
    cwd: options.cwd,
    provider: options.provider,
    model: options.model,
    startedAt: new Date().toISOString(),
    logFile,
    status: "running",
    exitCode: null,
  };
  workers.set(workerId, record);
  children.set(workerId, child);

  await updateGoalTask(options.cwd, options.goalRunId, options.goalTaskId, {
    status: "running",
    workerId,
  });
  await setRunWorker(options.cwd, options.goalRunId, workerId);

  let summary = "";
  let stderr = "";
  const activeTools = new Map<string, string>();
  const toolsUsed: GoalWorkerToolUse[] = [];

  const rl = createInterface({ input: child.stdout! });
  rl.on("line", (line) => {
    logStream.write(line + "\n");
    try {
      const event = JSON.parse(line) as { type?: string } & Record<string, unknown>;
      if (event.type === "text_delta" && typeof event.text === "string") {
        summary = appendSummary(summary, event.text);
      } else if (event.type === "tool_call_start") {
        const name = typeof event.name === "string" ? event.name : "tool";
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : randomUUID();
        activeTools.set(toolCallId, name);
        const args =
          typeof event.args === "object" && event.args !== null
            ? (event.args as Record<string, unknown>)
            : {};
        record.currentActivity = formatActivity(name, args);
        void appendGoalEvidence(options.cwd, options.goalRunId, {
          kind: "log",
          label: `Worker ${workerId} tool start`,
          content: record.currentActivity,
          path: logFile,
        });
      } else if (event.type === "tool_call_end") {
        const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : "";
        const name = activeTools.get(toolCallId);
        activeTools.delete(toolCallId);
        if (name) toolsUsed.push({ name, ok: event.isError !== true });
      } else if (event.type === "agent_done") {
        summary = appendSummary(summary, "\n[agent_done]");
      } else if (event.type === "error") {
        const message = typeof event.message === "string" ? event.message : "Worker error";
        summary = appendSummary(summary, `\n[error] ${message}`);
      }
    } catch {
      summary = appendSummary(summary, line + "\n");
    }
  });

  child.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    stderr = appendSummary(stderr, text);
    logStream.write(JSON.stringify({ type: "stderr", text }) + "\n");
  });

  child.on("close", (code) => {
    void (async () => {
      rl.close();
      logStream.end();
      children.delete(workerId);
      record.exitCode = code;
      if (record.status === "stopped") {
        log("INFO", "goal-worker", `Worker ${workerId} stopped`, {
          code: String(code ?? 1),
          goalRunId: options.goalRunId,
          goalTaskId: options.goalTaskId,
        });
        return;
      }
      record.status = code === 0 ? "done" : "failed";
      const finalSummary =
        summary.trim() || stderr.trim() || (code === 0 ? "Worker completed." : "Worker failed.");
      const finalCode = code ?? (record.status === "done" ? 0 : 1);
      await updateGoalTask(options.cwd, options.goalRunId, options.goalTaskId, {
        status: code === 0 ? "done" : "failed",
        workerId,
        lastSummary: finalSummary,
      });
      await appendGoalEvidence(options.cwd, options.goalRunId, {
        kind: "log",
        label: `Worker ${workerId} ${record.status}`,
        content: finalSummary,
        path: logFile,
      });
      await setRunWorker(options.cwd, options.goalRunId, undefined);
      const completion: GoalWorkerCompletion = {
        worker: { ...record },
        summary: finalSummary,
        status: record.status,
        exitCode: finalCode,
        toolsUsed: [...toolsUsed],
        reason: "exit",
      };
      options.onComplete?.(completion);
      emitGoalWorkerCompletion(completion);
      log("INFO", "goal-worker", `Worker ${workerId} exited`, {
        code: String(code ?? 1),
        goalRunId: options.goalRunId,
        goalTaskId: options.goalTaskId,
      });
    })().catch((err: unknown) => {
      log("ERROR", "goal-worker", err instanceof Error ? err.message : String(err));
    });
  });

  child.on("error", (err) => {
    void (async () => {
      logStream.end();
      children.delete(workerId);
      record.exitCode = 1;
      record.status = "failed";
      const finalSummary = `Failed to spawn Goal worker: ${err.message}`;
      await updateGoalTask(options.cwd, options.goalRunId, options.goalTaskId, {
        status: "failed",
        workerId,
        lastSummary: finalSummary,
      });
      await appendGoalEvidence(options.cwd, options.goalRunId, {
        kind: "log",
        label: `Worker ${workerId} spawn failed`,
        content: err.message,
        path: logFile,
      });
      await setRunWorker(options.cwd, options.goalRunId, undefined);
      const completion: GoalWorkerCompletion = {
        worker: { ...record },
        summary: finalSummary,
        status: "failed",
        exitCode: 1,
        toolsUsed: [...toolsUsed],
        reason: "spawn_error",
      };
      options.onComplete?.(completion);
      emitGoalWorkerCompletion(completion);
    })().catch((error: unknown) => {
      log("ERROR", "goal-worker", error instanceof Error ? error.message : String(error));
    });
  });

  log("INFO", "goal-worker", `Worker ${workerId} started`, {
    pid: String(record.pid),
    goalRunId: options.goalRunId,
    goalTaskId: options.goalTaskId,
  });
  return record;
}

export function listGoalWorkers(projectPath?: string): GoalWorkerRecord[] {
  const records = [...workers.values()];
  return projectPath ? records.filter((record) => record.cwd === projectPath) : records;
}

export async function stopGoalWorker(workerId: string): Promise<string> {
  const record = workers.get(workerId);
  if (!record) return `No Goal worker with id "${workerId}".`;
  const child = children.get(workerId);
  if (!child || record.status !== "running") return `Goal worker ${workerId} is not running.`;

  record.status = "stopped";
  try {
    if (child.pid) killProcessTree(child.pid);
  } catch {
    child.kill("SIGTERM");
  }
  children.delete(workerId);
  await updateGoalTask(record.cwd, record.goalRunId, record.goalTaskId, {
    status: "blocked",
    workerId,
    lastSummary: "Worker stopped by user.",
  });
  await appendGoalEvidence(record.cwd, record.goalRunId, {
    kind: "summary",
    label: `Worker ${workerId} stopped`,
    content: "Worker stopped by user.",
    path: record.logFile,
  });
  await setRunWorker(record.cwd, record.goalRunId, undefined);
  return `Goal worker ${workerId} stopped.`;
}

export function shutdownGoalWorkers(projectPath?: string): void {
  for (const record of listGoalWorkers(projectPath)) {
    const child = children.get(record.id);
    if (!child || !child.pid) continue;
    killProcessTree(child.pid);
    children.delete(record.id);
    record.status = "stopped";
  }
}

export function hasGoalWorkerLog(record: GoalWorkerRecord): boolean {
  return existsSync(record.logFile);
}
