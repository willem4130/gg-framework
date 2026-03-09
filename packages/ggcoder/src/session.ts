import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import type { Message } from "@kenkaiiii/gg-ai";
import type { SessionHeader, SessionMessageEntry, SessionEntry, SessionInfo } from "./types.js";

const SESSION_DIR = path.join(os.homedir(), ".gg", "sessions");

function encodeCwd(cwd: string): string {
  return cwd.replace(/[\\/]/g, "_").replace(/:/g, "").replace(/^_/, "");
}

function sessionDirForCwd(cwd: string): string {
  return path.join(SESSION_DIR, encodeCwd(cwd));
}

// ── Create Session ──────────────────────────────────────────

export interface Session {
  id: string;
  path: string;
  append(entry: SessionEntry): Promise<void>;
}

export async function createSession(
  cwd: string,
  provider: string,
  model: string,
): Promise<Session> {
  const id = crypto.randomUUID();
  const timestamp = new Date().toISOString();
  const dir = sessionDirForCwd(cwd);
  await fs.mkdir(dir, { recursive: true });

  const fileName = `${timestamp.replace(/[:.]/g, "-")}_${id.slice(0, 8)}.jsonl`;
  const filePath = path.join(dir, fileName);

  const header: SessionHeader = {
    type: "session",
    version: 1,
    id,
    timestamp,
    cwd,
    provider: provider as SessionHeader["provider"],
    model,
  };

  await fs.appendFile(filePath, JSON.stringify(header) + "\n", "utf-8");

  return {
    id,
    path: filePath,
    async append(entry: SessionEntry) {
      await fs.appendFile(filePath, JSON.stringify(entry) + "\n", "utf-8");
    },
  };
}

// ── Load Session ────────────────────────────────────────────

export async function loadSession(
  sessionPath: string,
): Promise<{ header: SessionHeader; messages: Message[] }> {
  const content = await fs.readFile(sessionPath, "utf-8");
  const lines = content.trim().split("\n").filter(Boolean);

  let header: SessionHeader | null = null;
  const messages: Message[] = [];

  for (const line of lines) {
    const entry = JSON.parse(line) as SessionEntry;
    if (entry.type === "session") {
      header = entry;
    } else if (entry.type === "message") {
      // Skip system messages — they'll be rebuilt fresh
      if (entry.message.role !== "system") {
        messages.push(entry.message);
      }
    }
  }

  if (!header) {
    throw new Error(`Invalid session file: no header found in ${sessionPath}`);
  }

  return { header, messages };
}

// ── List Sessions ───────────────────────────────────────────

export async function listSessions(cwd: string): Promise<SessionInfo[]> {
  const dir = sessionDirForCwd(cwd);

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const sessions: SessionInfo[] = [];

  for (const file of files) {
    if (!file.endsWith(".jsonl")) continue;
    const filePath = path.join(dir, file);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.trim().split("\n").filter(Boolean);
      if (lines.length === 0) continue;

      const header = JSON.parse(lines[0]) as SessionEntry;
      if (header.type !== "session") continue;

      const messageCount = lines.filter((line) => {
        try {
          const entry = JSON.parse(line) as SessionEntry;
          return entry.type === "message";
        } catch {
          return false;
        }
      }).length;

      sessions.push({
        id: header.id,
        path: filePath,
        timestamp: header.timestamp,
        cwd: header.cwd,
        messageCount,
      });
    } catch {
      // Skip corrupt files
    }
  }

  // Sort by timestamp descending (most recent first)
  sessions.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return sessions;
}

// ── Get Most Recent Session ─────────────────────────────────

export async function getMostRecentSession(cwd: string): Promise<string | null> {
  const sessions = await listSessions(cwd);
  return sessions.length > 0 ? sessions[0].path : null;
}

// ── Persist Messages ────────────────────────────────────────

export function persistMessage(session: Session, message: Message): Promise<void> {
  const entry: SessionMessageEntry = {
    type: "message",
    timestamp: new Date().toISOString(),
    message,
  };
  return session.append(entry);
}
