import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AgentSessionOptions } from "../core/agent-session.js";
import { createGeneralChatAgent, GENERAL_CHAT_SYSTEM_PROMPT } from "./general.js";
import { chatAgentSessionsDir } from "./shared.js";

function optionsOf(agent: unknown): AgentSessionOptions {
  return (agent as { opts: AgentSessionOptions }).opts;
}

describe("General chat agent", () => {
  it("uses an isolated session namespace outside GG Coder history", () => {
    const coderSessions = path.join("/tmp", "gg", "sessions");
    expect(chatAgentSessionsDir(coderSessions, "general")).toBe(
      path.join("/tmp", "gg", "chat-sessions", "general"),
    );
  });

  it("keeps caching and compaction on the shared spine while disabling coder behavior", () => {
    const agent = createGeneralChatAgent({
      provider: "anthropic",
      model: "claude-test",
      cwd: "/tmp/workspace",
      sessionsDir: "/tmp/gg/sessions",
    });
    const options = optionsOf(agent);

    expect(options.systemPrompt).toContain(GENERAL_CHAT_SYSTEM_PROMPT);
    expect(options.systemPrompt).toContain("- Active agent: general");
    expect(options.systemPrompt).toContain("- Workspace root: /tmp/workspace");
    expect(options.promptCacheKeyPrefix).toBe("ggchat:general");
    expect(options.sessionRootDir).toBe("/tmp/gg/chat-sessions/general");
    expect(options.coderSlashCommands).toBe(false);
    expect(options.selfCorrectionHooks).toBe(false);
    expect(options.projectCustomization).toBe(false);
    expect(options.globalSubagents).toBe(true);
    expect(options.loadExtensions).toBe(false);
    expect(options.orchestrationPrompt).toBe(false);
    // No transient flag or compaction override: normal persistence, prompt caching,
    // dynamic model context, and AgentSession auto-compaction remain active.
    expect(options.transient).toBeUndefined();
  });

  it("refuses to resume a GG Coder session outside the General namespace", () => {
    const agent = createGeneralChatAgent({
      provider: "anthropic",
      model: "claude-test",
      cwd: "/tmp/workspace",
      sessionsDir: "/tmp/gg/sessions",
      sessionId: "/tmp/gg/sessions/project/coder-session.jsonl",
    });
    expect(optionsOf(agent).sessionId).toBeUndefined();
  });
});
