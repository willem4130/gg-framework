import { execFile } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_GIT_OUTPUT = 2000;

export interface GoalWorktreeCommandRunner {
  execFile(
    file: string,
    args: readonly string[],
    options: { cwd: string },
  ): Promise<{ stdout: string; stderr: string }>;
}

export interface GoalWorktreeRequest {
  projectPath: string;
  goalRunId: string;
  goalTaskId: string;
  workerId: string;
  baseRef?: string;
  worktreesRoot?: string;
  commandRunner?: GoalWorktreeCommandRunner;
}

export interface GoalWorktreeCandidate {
  baseRef: string;
  branchName: string;
  path: string;
}

export async function defaultGoalWorktreeCommandRunner(
  file: string,
  args: readonly string[],
  options: { cwd: string },
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(file, [...args], {
    cwd: options.cwd,
    maxBuffer: 1024 * 1024,
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

export function goalWorktreeRoot(projectPath: string): string {
  return join(dirname(projectPath), `${projectBasename(projectPath)}-goal-worktrees`);
}

function projectBasename(projectPath: string): string {
  const parts = projectPath.split(/[\\/]+/u).filter(Boolean);
  return parts.at(-1) ?? "project";
}

export function sanitizeWorktreeToken(value: string): string {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "item"
  );
}

export async function createGoalWorkerWorktree({
  projectPath,
  goalRunId,
  goalTaskId,
  workerId,
  baseRef,
  worktreesRoot,
  commandRunner,
}: GoalWorktreeRequest): Promise<GoalWorktreeCandidate> {
  const runner = commandRunner ?? { execFile: defaultGoalWorktreeCommandRunner };
  await assertCleanProject(runner, projectPath);
  const resolvedBaseRef = baseRef ?? (await gitStdout(runner, projectPath, ["rev-parse", "HEAD"]));
  const token = sanitizeWorktreeToken(`${goalTaskId}-${workerId}`);
  const branchName = `goal/${sanitizeWorktreeToken(goalRunId)}/${token}`;
  const root = worktreesRoot ?? goalWorktreeRoot(projectPath);
  const worktreePath = join(root, token);

  await mkdir(root, { recursive: true });
  await runner.execFile(
    "git",
    ["worktree", "add", "-b", branchName, worktreePath, resolvedBaseRef],
    {
      cwd: projectPath,
    },
  );

  return { baseRef: resolvedBaseRef, branchName, path: worktreePath };
}

async function assertCleanProject(runner: GoalWorktreeCommandRunner, cwd: string): Promise<void> {
  const status = await gitStdout(runner, cwd, ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error(
      `Cannot launch isolated Goal worker from a dirty checkout. Commit or stash integration changes first. Dirty files:\n${status.slice(0, MAX_GIT_OUTPUT)}`,
    );
  }
}

async function gitStdout(
  runner: GoalWorktreeCommandRunner,
  cwd: string,
  args: readonly string[],
): Promise<string> {
  try {
    const result = await runner.execFile("git", args, { cwd });
    return result.stdout.trim();
  } catch (error) {
    throw new Error(`git ${args.join(" ")} failed: ${formatGitError(error)}`, { cause: error });
  }
}

export function formatGitError(error: unknown): string {
  if (error instanceof Error) {
    const maybe = error as Error & { stderr?: unknown; stdout?: unknown };
    const output = [maybe.stderr, maybe.stdout, error.message]
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .join("\n")
      .trim();
    return output.slice(0, MAX_GIT_OUTPUT);
  }
  return String(error).slice(0, MAX_GIT_OUTPUT);
}
