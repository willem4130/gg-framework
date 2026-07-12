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
};

export function chatAgentSessionsDir(coderSessionsDir: string, agentId: ChatAgentId): string {
  return path.resolve(coderSessionsDir, "..", "chat-sessions", agentId);
}

const MEMORY_CURATION_INSTRUCTIONS = `

Durable memory curation:
You can curate the shared durable memory available to General, Therapist, and Research with remember, update_memory, and forget. Save only facts that materially help future sessions: identity, stable preferences, ongoing projects or goals, important relationships or dates, recurring constraints, and significant health or work context. Never save one-off task details, full conversation summaries, readily recomputable facts, speculation, credentials, secrets, or transient emotion. Store one concise, self-contained fact per memory. Update or supersede changed facts instead of creating contradictions. Forget stale, wrong, or redundant facts, and honor explicit requests to forget. Curate silently and naturally; never claim to remember anything beyond the injected durable memory block. Memory IDs in the current injected block are authoritative and supersede IDs mentioned earlier in conversation history. When memory reaches its consolidation threshold, combine related facts with update_memory and remove stale or redundant entries. Prefer update_memory's forget_ids option to merge and delete each related group atomically; for large cleanups, work in small verifiable batches across turns instead of risking the wrong rows.`;

/** Create a chat agent on the shared caching/compaction spine without GG Coder behavior. */
export function createChatAgentSession(
  agentId: ChatAgentId,
  systemPrompt: string,
  options: ChatAgentOptions,
): AgentSession {
  const { sessionsDir, ...sessionOptions } = options;
  const sessionRootDir = chatAgentSessionsDir(sessionsDir, agentId);
  const requestedSession = sessionOptions.sessionId ? path.resolve(sessionOptions.sessionId) : null;
  const resumableSession =
    requestedSession?.startsWith(`${sessionRootDir}${path.sep}`) === true
      ? requestedSession
      : undefined;

  const delegationInstructions = sessionOptions.additionalTools?.some(
    (tool) => tool.name === "delegate_to_agent",
  )
    ? `\n\nDelegation:\nYou can call delegate_to_agent to ask one specialist chat agent for a focused result. Route emotional support, reflection, coping, relationships, or wellbeing to Therapist. Route evidence gathering, source verification, comparisons, current information, or deep analysis to Research. Route broad cross-domain tasks that do not fit those specialties to General. Delegate when the user's request clearly benefits from that expertise or from an independent pass. Give the delegate a self-contained task with the relevant context, constraints, and desired output, then critically synthesize its result for the user rather than forwarding it blindly. Do not delegate trivial requests, do not delegate reflexively, and do not delegate work you can answer just as well yourself. For substantial tasks that benefit from independent parallel investigation or an isolated specialist pass, you may also use the subagent tools; use them selectively rather than proactively on routine requests.`
    : "";
  const runtimeContext = [
    "Runtime context:",
    `- Active agent: ${agentId}`,
    `- Current date: ${new Date().toISOString().slice(0, 10)}`,
    `- Workspace root: ${sessionOptions.cwd}`,
    "- Conversation history and tool results are the authoritative changing context for this session.",
  ].join("\n");

  return new AgentSession({
    ...sessionOptions,
    sessionId: resumableSession,
    // Keep the stable role prompt first so provider prefix caching can reuse it;
    // append only the small per-session context that genuinely changes.
    systemPrompt: `${systemPrompt}${MEMORY_CURATION_INSTRUCTIONS}${delegationInstructions}\n\n${runtimeContext}`,
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
