import { useState, useCallback, useRef } from "react";
import type { Message } from "@kenkaiiii/gg-ai";
import { SessionManager, type MessageEntry, type SessionInfo } from "../../core/session-manager.js";
import crypto from "node:crypto";
import type { Provider } from "@kenkaiiii/gg-ai";

export interface UseSessionManagerReturn {
  sessionId: string;
  sessionPath: string;
  create: (cwd: string, provider: Provider, model: string) => Promise<void>;
  load: (sessionPath: string) => Promise<Message[]>;
  persistMessages: (messages: Message[], fromIndex: number) => Promise<void>;
  listSessions: (cwd: string) => Promise<SessionInfo[]>;
}

export function useSessionManager(sessionsDir: string): UseSessionManagerReturn {
  const managerRef = useRef(new SessionManager(sessionsDir));
  const [sessionId, setSessionId] = useState("");
  const [sessionPath, setSessionPath] = useState("");

  const create = useCallback(async (cwd: string, provider: Provider, model: string) => {
    const session = await managerRef.current.create(cwd, provider, model);
    setSessionId(session.id);
    setSessionPath(session.path);
  }, []);

  const load = useCallback(async (path: string) => {
    const loaded = await managerRef.current.load(path);
    return managerRef.current.getMessages(loaded.entries);
  }, []);

  const persistMessages = useCallback(
    async (messages: Message[], fromIndex: number) => {
      if (!sessionPath) return;
      for (let i = fromIndex; i < messages.length; i++) {
        const entry: MessageEntry = {
          type: "message",
          id: crypto.randomUUID(),
          parentId: null,
          timestamp: new Date().toISOString(),
          message: messages[i],
        };
        await managerRef.current.appendEntry(sessionPath, entry);
      }
    },
    [sessionPath],
  );

  const listSessions = useCallback(async (cwd: string) => {
    return managerRef.current.list(cwd);
  }, []);

  return {
    sessionId,
    sessionPath,
    create,
    load,
    persistMessages,
    listSessions,
  };
}
