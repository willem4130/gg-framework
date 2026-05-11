import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let tmpHome: string;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "setup-history-"));
  // Re-point os.homedir() at our tmp dir. Done via a spy so the change is
  // reverted after each test via vi.restoreAllMocks().
  vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  // setup-history.ts captures HISTORY_PATH at module load via os.homedir().
  // We must re-import after the mock is in place to pick up the tmp path.
  vi.resetModules();
});

afterEach(() => {
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

async function loadModule() {
  return await import("./setup-history.js");
}

describe("setup-history", () => {
  it("isFirstTimeSetup returns true when history file is absent", async () => {
    const { isFirstTimeSetup } = await loadModule();
    expect(isFirstTimeSetup("/tmp/never-seen")).toBe(true);
  });

  it("markSetupAudited persists the cwd entry", async () => {
    const { isFirstTimeSetup, markSetupAudited } = await loadModule();
    const cwd = "/tmp/first-project";
    expect(isFirstTimeSetup(cwd)).toBe(true);
    markSetupAudited(cwd);
    expect(isFirstTimeSetup(cwd)).toBe(false);
  });

  it("treats distinct cwds independently", async () => {
    const { isFirstTimeSetup, markSetupAudited } = await loadModule();
    markSetupAudited("/tmp/project-a");
    expect(isFirstTimeSetup("/tmp/project-a")).toBe(false);
    expect(isFirstTimeSetup("/tmp/project-b")).toBe(true);
  });

  it("tolerates corrupt history files (treats as empty)", async () => {
    const ggDir = path.join(tmpHome, ".gg");
    fs.mkdirSync(ggDir, { recursive: true });
    fs.writeFileSync(path.join(ggDir, "setup-history.json"), "{ not valid json");
    const { isFirstTimeSetup } = await loadModule();
    expect(isFirstTimeSetup("/tmp/anywhere")).toBe(true);
  });

  it("getAnnouncedLanguages returns [] when never announced", async () => {
    const { getAnnouncedLanguages } = await loadModule();
    expect(getAnnouncedLanguages("/tmp/fresh")).toEqual([]);
  });

  it("markLanguagesAnnounced persists and dedupes across calls", async () => {
    const { getAnnouncedLanguages, markLanguagesAnnounced } = await loadModule();
    const cwd = "/tmp/proj";
    markLanguagesAnnounced(cwd, ["typescript"]);
    expect(getAnnouncedLanguages(cwd)).toEqual(["typescript"]);
    markLanguagesAnnounced(cwd, ["typescript", "rust"]);
    expect(getAnnouncedLanguages(cwd).sort()).toEqual(["rust", "typescript"]);
  });

  it("markLanguagesAnnounced and markSetupAudited coexist without clobbering", async () => {
    const { isFirstTimeSetup, markSetupAudited, getAnnouncedLanguages, markLanguagesAnnounced } =
      await loadModule();
    const cwd = "/tmp/coexist";
    markLanguagesAnnounced(cwd, ["python"]);
    expect(isFirstTimeSetup(cwd)).toBe(true);
    markSetupAudited(cwd);
    expect(isFirstTimeSetup(cwd)).toBe(false);
    expect(getAnnouncedLanguages(cwd)).toEqual(["python"]);
  });

  it("markLanguagesAnnounced is a no-op for empty input", async () => {
    const { getAnnouncedLanguages, markLanguagesAnnounced } = await loadModule();
    markLanguagesAnnounced("/tmp/noop", []);
    expect(getAnnouncedLanguages("/tmp/noop")).toEqual([]);
  });
});
