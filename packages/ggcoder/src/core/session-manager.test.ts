import { mkdtemp, readFile, rm, utimes, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager, type SessionEntry } from "./session-manager.js";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gg-session-manager-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function entry(id: string): SessionEntry {
  return {
    type: "message",
    id,
    parentId: null,
    timestamp: new Date().toISOString(),
    message: { role: "user", content: "hi" },
  };
}

describe("SessionManager persistence failure handling", () => {
  it("appendEntry does not throw when the write fails (e.g. disk full)", async () => {
    const manager = new SessionManager(await makeTempDir());
    const badPath = path.join("/nonexistent-gg-dir", "session.jsonl");

    const errors: NodeJS.ErrnoException[] = [];
    manager.onPersistError = (error) => errors.push(error);

    await expect(manager.appendEntry(badPath, entry("a"))).resolves.toBeUndefined();
    expect(errors).toHaveLength(1);
    expect(errors[0]?.code).toBe("ENOENT");
  });

  it("reports a persistence failure only once per error code", async () => {
    const manager = new SessionManager(await makeTempDir());
    const badPath = path.join("/nonexistent-gg-dir", "session.jsonl");

    let calls = 0;
    manager.onPersistError = () => {
      calls += 1;
    };

    await manager.appendEntry(badPath, entry("a"));
    await manager.appendEntry(badPath, entry("b"));
    await manager.updateLeaf(badPath, "leaf-1");
    expect(calls).toBe(1);
  });

  it("appendEntry still writes normally when the disk is healthy", async () => {
    const sessionsDir = await makeTempDir();
    const manager = new SessionManager(sessionsDir);
    const created = await manager.create(sessionsDir, "anthropic", "test-model");

    await manager.appendEntry(created.path, entry("ok"));
    const content = await readFile(created.path, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[1] ?? "")).toMatchObject({ type: "message", id: "ok" });
  });
});

describe("SessionManager.pruneOldSessions", () => {
  async function makeAgedSession(
    manager: SessionManager,
    cwd: string,
    ageDays: number,
  ): Promise<string> {
    const created = await manager.create(cwd, "anthropic", "test-model");
    const past = new Date(Date.now() - ageDays * 86_400_000);
    await utimes(created.path, past, past);
    return created.path;
  }

  it("deletes sessions older than the retention window and keeps recent ones", async () => {
    const sessionsDir = await makeTempDir();
    const manager = new SessionManager(sessionsDir);
    const oldPath = await makeAgedSession(manager, "/proj/a", 45);
    const recentPath = await makeAgedSession(manager, "/proj/a", 5);

    const result = await manager.pruneOldSessions({ maxAgeDays: 30 });

    expect(result.deletedFiles).toBe(1);
    expect(result.freedBytes).toBeGreaterThan(0);
    expect(existsSync(oldPath)).toBe(false);
    expect(existsSync(recentPath)).toBe(true);
  });

  it("never deletes paths listed in keepPaths, even when old", async () => {
    const sessionsDir = await makeTempDir();
    const manager = new SessionManager(sessionsDir);
    const activePath = await makeAgedSession(manager, "/proj/b", 90);

    const result = await manager.pruneOldSessions({ maxAgeDays: 30, keepPaths: [activePath] });

    expect(result.deletedFiles).toBe(0);
    expect(existsSync(activePath)).toBe(true);
  });

  it("removes project dirs left empty and is a no-op when retention is 0", async () => {
    const sessionsDir = await makeTempDir();
    const manager = new SessionManager(sessionsDir);
    const oldPath = await makeAgedSession(manager, "/proj/c", 60);

    const disabled = await manager.pruneOldSessions({ maxAgeDays: 0 });
    expect(disabled.deletedFiles).toBe(0);
    expect(existsSync(oldPath)).toBe(true);

    await manager.pruneOldSessions({ maxAgeDays: 30 });
    expect(existsSync(oldPath)).toBe(false);
    expect(await readdir(sessionsDir)).toHaveLength(0);
  });
});
