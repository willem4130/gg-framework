import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HISTORY_PATH = path.join(os.homedir(), ".gg", "setup-history.json");

interface SetupHistoryEntry {
  /** ISO timestamp of the most recent /setup audit for this cwd. */
  lastAuditedAt: string;
}

type SetupHistory = Record<string, SetupHistoryEntry>;

/**
 * Persisted record of which project directories have been auto-audited by
 * `/setup`. Used to gate the first-time auto-run: we want the audit to fire
 * exactly once per project, not once per session.
 *
 * Stored at `~/.gg/setup-history.json`. Keys are absolute cwd paths. The file
 * is small (one line per project the user has ever opened with ggcoder) and
 * read/written on session start only \u2014 not in any hot path.
 */
function readHistory(): SetupHistory {
  try {
    const raw = fs.readFileSync(HISTORY_PATH, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as SetupHistory;
    }
  } catch {
    /* missing or unparseable \u2014 treat as empty */
  }
  return {};
}

function writeHistory(history: SetupHistory): void {
  try {
    fs.mkdirSync(path.dirname(HISTORY_PATH), { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf-8");
  } catch {
    /* best-effort \u2014 a failed write just means the auto-run will fire again
       next session, which is annoying but not broken. */
  }
}

/** Returns true if this cwd has never been audited by /setup before. */
export function isFirstTimeSetup(cwd: string): boolean {
  const history = readHistory();
  return history[cwd] === undefined;
}

/** Mark this cwd as audited. Called immediately after the auto-run fires
 *  (whether or not the agent actually completes the audit) so we never
 *  double-trigger across sessions. */
export function markSetupAudited(cwd: string): void {
  const history = readHistory();
  history[cwd] = { lastAuditedAt: new Date().toISOString() };
  writeHistory(history);
}
