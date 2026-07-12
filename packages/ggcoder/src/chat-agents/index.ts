import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { AgentSession } from "../core/agent-session.js";
import { createGeneralChatAgent } from "./general.js";
import { createResearchChatAgent } from "./research.js";
import { createTherapistChatAgent } from "./therapist.js";
import { chatAgentSessionsDir, type ChatAgentOptions } from "./shared.js";
import { parseChatAgentId, type ChatAgentId } from "./types.js";

export { CHAT_AGENT_IDS, parseChatAgentId, type ChatAgentId } from "./types.js";
export { chatAgentSessionsDir } from "./shared.js";

export const CHAT_AGENT_LABELS: Record<ChatAgentId, string> = {
  general: "General Agent",
  therapist: "Therapist Agent",
  research: "Research Agent",
};

function finalAssistantText(session: AgentSession): string {
  const message = [...session.getMessages()].reverse().find((item) => item.role === "assistant");
  if (!message) return "The delegated agent completed without a written result.";
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return String(message.content);
  const text = message.content
    .filter(
      (block): block is { type: "text"; text: string } =>
        typeof block === "object" &&
        block !== null &&
        "type" in block &&
        block.type === "text" &&
        "text" in block &&
        typeof block.text === "string",
    )
    .map((block) => block.text)
    .join("\n");
  return text || "The delegated agent completed without a written result.";
}

const delegationParameters = z.object({
  agent: z.enum(["general", "therapist", "research"]).describe("Specialist to delegate to"),
  task: z.string().min(1).describe("Self-contained task, context, constraints, and desired output"),
});

function createDelegationTool(
  currentAgent: ChatAgentId,
  options: ChatAgentOptions,
  getParentSession: () => AgentSession,
): AgentTool<typeof delegationParameters> {
  return {
    name: "delegate_to_agent",
    description:
      "Delegate one focused task and return its result: Therapist for emotional support, relationships, coping, or wellbeing; Research for evidence, sources, current information, comparisons, or deep analysis; General for broad cross-domain work. Use only when specialization or an independent pass materially improves the outcome, and provide a self-contained task with context, constraints, and desired output.",
    parameters: delegationParameters,
    executionMode: "sequential",
    async execute({ agent, task }, context) {
      if (agent === currentAgent) {
        return `Already running as ${CHAT_AGENT_LABELS[currentAgent]}; handle this task directly.`;
      }
      const {
        sessionId: _sessionId,
        continueRecent: _continueRecent,
        ...delegatedOptions
      } = options;
      const parent = getParentSession();
      const parentState = parent.getState();
      const delegated = createChatAgent(
        agent,
        {
          ...delegatedOptions,
          provider: parentState.provider,
          model: parentState.model,
          thinkingLevel: parent.getThinkingLevel(),
          signal: context.signal,
          transient: true,
        },
        false,
      );
      try {
        await delegated.initialize();
        await delegated.prompt(task);
        return finalAssistantText(delegated);
      } finally {
        await delegated.dispose().catch(() => {});
      }
    },
  };
}

export function createChatAgent(
  agentId: ChatAgentId,
  options: ChatAgentOptions,
  delegationEnabled = true,
): AgentSession {
  let session!: AgentSession;
  const sessionOptions = delegationEnabled
    ? {
        ...options,
        additionalTools: [
          ...(options.additionalTools ?? []),
          createDelegationTool(agentId, options, () => session),
        ],
      }
    : {
        ...options,
        additionalTools: (options.additionalTools ?? []).filter(
          (tool) => tool.name !== "delegate_to_agent",
        ),
      };

  switch (agentId) {
    case "therapist":
      session = createTherapistChatAgent(sessionOptions);
      break;
    case "research":
      session = createResearchChatAgent(sessionOptions);
      break;
    case "general":
      session = createGeneralChatAgent(sessionOptions);
      break;
  }
  return session;
}

export function sessionsDirForChatAgent(coderSessionsDir: string, value: unknown): string {
  return chatAgentSessionsDir(coderSessionsDir, parseChatAgentId(value));
}
