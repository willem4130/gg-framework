import path from "node:path";
import { AgentSession, type AgentSessionOptions } from "../core/agent-session.js";
import type { ChatAgentId } from "./types.js";

export type ChatAgentOptions = Omit<
  AgentSessionOptions,
  | "systemPrompt"
  | "promptCacheKeyPrefix"
  | "sessionRootDir"
  | "coderSlashCommands"
  | "selfCorrectionHooks"
  | "projectCustomization"
  | "globalSubagents"
  | "loadExtensions"
  | "orchestrationPrompt"
  | "onEnterPlan"
  | "onExitPlan"
> & {
  sessionsDir: string;
  onAgentChange?: (agentId: ChatAgentId) => void | Promise<void>;
};

export function chatAgentSessionsDir(coderSessionsDir: string, agentId: ChatAgentId): string {
  return path.resolve(coderSessionsDir, "..", "chat-sessions", agentId);
}

const MEMORY_CURATION_INSTRUCTIONS = `

Durable memory curation:
You can curate the shared durable memory available to General, Therapist, and Research with remember, update_memory, and forget. Save only facts that materially help future sessions: identity, stable preferences, ongoing projects or goals, important relationships or dates, recurring constraints, and significant health or work context. Never save one-off task details, full conversation summaries, readily recomputable facts, speculation, credentials, secrets, or transient emotion. Store one concise, self-contained fact per memory. Update or supersede changed facts instead of creating contradictions. Forget stale, wrong, or redundant facts, and honor explicit requests to forget. Curate silently and naturally; never claim to remember anything beyond the injected durable memory block. Memory IDs in the current injected block are authoritative and supersede IDs mentioned earlier in conversation history. When memory reaches its consolidation threshold, combine related facts with update_memory and remove stale or redundant entries. Prefer update_memory's forget_ids option to merge and delete each related group atomically; for large cleanups, work in small verifiable batches across turns instead of risking the wrong rows.`;

export function buildChatAgentSystemPrompt(
  agentId: ChatAgentId,
  rolePrompt: string,
  cwd: string,
  handoffEnabled: boolean,
): string {
  const handoffInstructions = handoffEnabled
    ? `\n\nAgent handoff:\nYou can call delegate_to_agent to hand the entire conversation to a better-suited agent. Hand off to Therapist when the conversation primarily needs emotional support, reflection, coping, relationships, or wellbeing. Hand off to Research when it primarily needs evidence gathering, source verification, comparisons, current information, or deep analysis. Hand off to General when the conversation becomes broad or no longer needs a specialist. A handoff changes the active agent for this conversation; it is not a one-off subtask. Use it when the conversation's primary need clearly shifts, not for a brief side question or work you can handle naturally.`
    : "";
  const runtimeContext = [
    "Runtime context:",
    `- Active agent: ${agentId}`,
    `- Current date: ${new Date().toISOString().slice(0, 10)}`,
    `- Workspace root: ${cwd}`,
    "- Conversation history and tool results are the authoritative changing context for this session.",
  ].join("\n");

  return `${rolePrompt}${MEMORY_CURATION_INSTRUCTIONS}${handoffInstructions}\n\n${runtimeContext}`;
}

/** Create a chat agent on the shared caching/compaction spine without GG Coder behavior. */
export function createChatAgentSession(
  agentId: ChatAgentId,
  systemPrompt: string,
  options: ChatAgentOptions,
): AgentSession {
  const { sessionsDir, onAgentChange: _onAgentChange, ...sessionOptions } = options;
  const sessionRootDir = chatAgentSessionsDir(sessionsDir, agentId);
  const requestedSession = sessionOptions.sessionId ? path.resolve(sessionOptions.sessionId) : null;
  const resumableSession =
    requestedSession?.startsWith(`${sessionRootDir}${path.sep}`) === true
      ? requestedSession
      : undefined;
  const handoffEnabled = sessionOptions.additionalTools?.some(
    (tool) => tool.name === "delegate_to_agent",
  );

  return new AgentSession({
    ...sessionOptions,
    sessionId: resumableSession,
    // Keep the stable role prompt first so provider prefix caching can reuse it;
    // append only the small per-session context that genuinely changes.
    systemPrompt: buildChatAgentSystemPrompt(
      agentId,
      systemPrompt,
      sessionOptions.cwd,
      handoffEnabled === true,
    ),
    promptCacheKeyPrefix: `ggchat:${agentId}`,
    sessionRootDir,
    coderSlashCommands: false,
    selfCorrectionHooks: false,
    projectCustomization: false,
    globalSubagents: true,
    loadExtensions: false,
    orchestrationPrompt: false,
  });
}
