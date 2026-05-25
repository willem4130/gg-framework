import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createGoalWorkerWorktree,
  goalWorktreeRoot,
  sanitizeWorktreeToken,
} from "./goal-worktree.js";
import type { GoalWorktreeCommandRunner } from "./goal-worktree.js";

describe("goal worktree helpers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "goal-worktree-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("sanitizes worktree tokens for branch and path names", () => {
    expect(sanitizeWorktreeToken("Task: refactor / App?!")).toBe("Task-refactor-App");
    expect(sanitizeWorktreeToken("***")).toBe("item");
  });

  it("places worker worktrees beside the project checkout", () => {
    expect(goalWorktreeRoot(path.join("/tmp", "repo"))).toBe(
      path.join("/tmp", "repo-goal-worktrees"),
    );
  });

  it("creates a branch worktree from the requested base ref", async () => {
    const projectPath = path.join(tmpDir, "main");
    const root = path.join(tmpDir, "worktrees");
    await fs.mkdir(projectPath, { recursive: true });
    const calls: Array<{ file: string; args: readonly string[]; cwd: string }> = [];
    const runner: GoalWorktreeCommandRunner = {
      execFile: vi.fn(async (file, args, options) => {
        calls.push({ file, args, cwd: options.cwd });
        return { stdout: "", stderr: "" };
      }),
    };

    const candidate = await createGoalWorkerWorktree({
      projectPath,
      goalRunId: "goal-123",
      goalTaskId: "task/app split",
      workerId: "worker-1",
      baseRef: "abc123",
      worktreesRoot: root,
      commandRunner: runner,
    });

    expect(candidate).toEqual({
      baseRef: "abc123",
      branchName: "goal/goal-123/task-app-split-worker-1",
      path: path.join(root, "task-app-split-worker-1"),
    });
    expect(calls).toEqual([
      {
        file: "git",
        args: ["status", "--porcelain"],
        cwd: projectPath,
      },
      {
        file: "git",
        args: ["worktree", "add", "-b", candidate.branchName, candidate.path, "abc123"],
        cwd: projectPath,
      },
    ]);
  });

  it("resolves HEAD as the base ref when no explicit base is supplied", async () => {
    const projectPath = path.join(tmpDir, "main");
    const root = path.join(tmpDir, "worktrees");
    await fs.mkdir(projectPath, { recursive: true });
    const calls: Array<readonly string[]> = [];
    const runner: GoalWorktreeCommandRunner = {
      execFile: vi.fn(async (_file, args) => {
        calls.push(args);
        return args[0] === "rev-parse"
          ? { stdout: "head-sha\n", stderr: "" }
          : { stdout: "", stderr: "" };
      }),
    };

    const candidate = await createGoalWorkerWorktree({
      projectPath,
      goalRunId: "goal",
      goalTaskId: "task",
      workerId: "worker",
      worktreesRoot: root,
      commandRunner: runner,
    });

    expect(candidate.baseRef).toBe("head-sha");
    expect(calls[0]).toEqual(["status", "--porcelain"]);
    expect(calls[1]).toEqual(["rev-parse", "HEAD"]);
    expect(calls[2]?.at(-1)).toBe("head-sha");
  });

  it("refuses to create worker worktrees from dirty integration checkouts", async () => {
    const runner: GoalWorktreeCommandRunner = {
      execFile: vi.fn(async (_file, args) =>
        args[0] === "status"
          ? { stdout: " M packages/app.ts\n", stderr: "" }
          : { stdout: "", stderr: "" },
      ),
    };

    await expect(
      createGoalWorkerWorktree({
        projectPath: "/repo/main",
        goalRunId: "goal",
        goalTaskId: "task",
        workerId: "worker",
        baseRef: "base-sha",
        commandRunner: runner,
      }),
    ).rejects.toThrow("Cannot launch isolated Goal worker from a dirty checkout");
  });
});
