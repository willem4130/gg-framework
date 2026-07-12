import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import type { AgentSessionOptions } from "../core/agent-session.js";
import { createChatAgent, parseChatAgentId } from "./index.js";
import { RESEARCH_CHAT_SYSTEM_PROMPT } from "./research.js";
import { THERAPIST_CHAT_SYSTEM_PROMPT } from "./therapist.js";

function optionsFor(agentId: "therapist" | "research"): AgentSessionOptions {
  const agent = createChatAgent(agentId, {
    provider: "anthropic",
    model: "claude-test",
    cwd: "/tmp/workspace",
    sessionsDir: "/tmp/gg/sessions",
  });
  return (agent as unknown as { opts: AgentSessionOptions }).opts;
}

describe("specialist chat agents", () => {
  it("configures Therapist with a cached isolated prompt and the full toolset", () => {
    const options = optionsFor("therapist");
    expect(options.systemPrompt).toContain(THERAPIST_CHAT_SYSTEM_PROMPT);
    expect(options.systemPrompt).toContain("- Active agent: therapist");
    expect(options.promptCacheKeyPrefix).toBe("ggchat:therapist");
    expect(options.sessionRootDir).toBe("/tmp/gg/chat-sessions/therapist");
    expect(options.allowedTools).toBeUndefined();
    expect(options.additionalTools?.map((tool) => tool.name)).toContain("delegate_to_agent");
    expect(options.systemPrompt).toContain("Durable memory curation:");
    expect(options.selfCorrectionHooks).toBe(false);
  });

  it("configures Research with a cached isolated prompt and the full toolset", () => {
    const options = optionsFor("research");
    expect(options.systemPrompt).toContain(RESEARCH_CHAT_SYSTEM_PROMPT);
    expect(options.systemPrompt).toContain("- Active agent: research");
    expect(options.systemPrompt).toMatch(/- Current date: \d{4}-\d{2}-\d{2}/);
    expect(options.promptCacheKeyPrefix).toBe("ggchat:research");
    expect(options.sessionRootDir).toBe("/tmp/gg/chat-sessions/research");
    expect(options.allowedTools).toBeUndefined();
    expect(options.additionalTools?.map((tool) => tool.name)).toContain("delegate_to_agent");
  });

  it("retains memory tools and dynamic context for delegated specialists without recursive delegation", () => {
    const memoryTool: AgentTool = {
      name: "remember",
      description: "test memory tool",
      parameters: z.object({}),
      execute: () => "remembered",
    };
    const getSystemPromptTail = () => "current memories";
    const delegated = createChatAgent(
      "research",
      {
        provider: "anthropic",
        model: "claude-test",
        cwd: "/tmp/workspace",
        sessionsDir: "/tmp/gg/sessions",
        additionalTools: [memoryTool],
        getSystemPromptTail,
      },
      false,
    );
    const options = (delegated as unknown as { opts: AgentSessionOptions }).opts;
    expect(options.additionalTools?.map((tool) => tool.name)).toEqual(["remember"]);
    expect(options.getSystemPromptTail).toBe(getSystemPromptTail);
  });

  it("defaults unknown persisted agent ids to General", () => {
    expect(parseChatAgentId("therapist")).toBe("therapist");
    expect(parseChatAgentId("research")).toBe("research");
    expect(parseChatAgentId("unknown")).toBe("general");
  });
});
