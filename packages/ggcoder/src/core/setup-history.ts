import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const HISTORY_PATH = path.join(os.homedir(), ".gg", "setup-history.json");

interface SetupHistoryEntry {
  /** ISO timestamp of the most recent /setup audit for this cwd. */
  lastAuditedAt?: string;
  /** Language pack ids the user has already been notified about for this cwd.
   *  Persisted so the "STYLE PACK ACTIVE" badge only fires on first activation,
   *  not on every session start / /clear / restart. */
  announcedLanguages?: string[];
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
  return history[cwd]?.lastAuditedAt === undefined;
}

/** Mark this cwd as audited. Called immediately after the auto-run fires
 *  (whether or not the agent actually completes the audit) so we never
 *  double-trigger across sessions. */
export function markSetupAudited(cwd: string): void {
  const history = readHistory();
  const existing = history[cwd] ?? {};
  history[cwd] = { ...existing, lastAuditedAt: new Date().toISOString() };
  writeHistory(history);
}

/** Returns the language ids that have already been announced via the
 *  "STYLE PACK ACTIVE" badge for this cwd. */
export function getAnnouncedLanguages(cwd: string): string[] {
  const history = readHistory();
  return history[cwd]?.announcedLanguages ?? [];
}

/** Add language ids to the announced set for this cwd. No-op if the input
 *  is empty or adds nothing new. */
export function markLanguagesAnnounced(cwd: string, langs: readonly string[]): void {
  if (langs.length === 0) return;
  const history = readHistory();
  const existing = history[cwd] ?? {};
  const prev = existing.announcedLanguages ?? [];
  const merged = Array.from(new Set([...prev, ...langs]));
  if (merged.length === prev.length) return;
  history[cwd] = { ...existing, announcedLanguages: merged };
  writeHistory(history);
}
