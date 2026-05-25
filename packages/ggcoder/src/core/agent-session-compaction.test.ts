import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Message } from "@kenkaiiii/gg-ai";
import type * as CompactorModule from "./compaction/compactor.js";
import type * as RepoMapModule from "./repomap.js";
import type * as GgAgentModule from "@kenkaiiii/gg-agent";
import type * as McpModule from "./mcp/index.js";

const shouldCompactMock = vi.hoisted(() => vi.fn());
const compactMock = vi.hoisted(() => vi.fn());
const agentLoopMock = vi.hoisted(() => vi.fn());

vi.mock("./compaction/compactor.js", async () => {
  const actual = await vi.importActual<typeof CompactorModule>("./compaction/compactor.js");
  return {
    ...actual,
    shouldCompact: shouldCompactMock,
    compact: compactMock,
  };
});

vi.mock("./repomap.js", async () => {
  const actual = await vi.importActual<typeof RepoMapModule>("./repomap.js");
  return {
    ...actual,
    buildRepoMap: vi.fn(async () => ({ markdown: "", snapshot: { files: [] } })),
  };
});

vi.mock("@kenkaiiii/gg-agent", async () => {
  const actual = await vi.importActual<typeof GgAgentModule>("@kenkaiiii/gg-agent");
  return {
    ...actual,
    agentLoop: agentLoopMock,
  };
});

vi.mock("./mcp/index.js", async () => {
  const actual = await vi.importActual<typeof McpModule>("./mcp/index.js");
  return {
    ...actual,
    MCPClientManager: vi.fn(function MCPClientManagerMock() {
      return {
        connectAll: vi.fn(async () => []),
        dispose: vi.fn(async () => {}),
      };
    }),
  };
});

let originalHome: string | undefined;
let tmpHome: string;
let tmpProject: string;

async function writeJson(filePath: string, value: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(value, null, 2), "utf-8");
}

beforeEach(async () => {
  originalHome = process.env.HOME;
  tmpHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-session-home-"));
  tmpProject = await fs.mkdtemp(path.join(os.tmpdir(), "agent-session-project-"));
  process.env.HOME = tmpHome;

  shouldCompactMock.mockReset();
  compactMock.mockReset();
  agentLoopMock.mockReset();

  await writeJson(path.join(tmpHome, ".gg", "auth.json"), {
    anthropic: {
      accessToken: "test-access-token",
      refreshToken: "test-refresh-token",
      expiresAt: Date.now() + 60_000,
    },
  });
  await writeJson(path.join(tmpHome, ".gg", "settings.json"), {
    autoCompact: true,
    compactThreshold: 0.1,
  });
});

afterEach(async () => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  await fs.rm(tmpHome, { recursive: true, force: true });
  await fs.rm(tmpProject, { recursive: true, force: true });
  vi.clearAllMocks();
});

describe("AgentSession worker auto-compaction", () => {
  it("auto-compacts transient JSON-mode worker sessions before the agent loop runs", async () => {
    const compactedMessages: Message[] = [
      { role: "system", content: "worker system prompt" },
      { role: "user", content: "[compacted worker context]\n\nDo worker task" },
    ];
    shouldCompactMock.mockReturnValue(true);
    compactMock.mockResolvedValue({
      messages: compactedMessages,
      result: {
        compacted: true,
        originalCount: 2,
        newCount: 2,
        tokensBeforeEstimate: 100_000,
        tokensAfterEstimate: 1_000,
      },
    });
    agentLoopMock.mockImplementation(async function* (messages: Message[]) {
      messages.push({ role: "assistant", content: "worker done" });
      yield { type: "agent_done" };
    });

    const { AgentSession } = await import("./agent-session.js");
    const session = new AgentSession({
      provider: "anthropic",
      model: "claude-test",
      cwd: tmpProject,
      systemPrompt: "worker system prompt",
      transient: true,
    });

    await session.initialize();
    await session.prompt("Do worker task");
    await session.dispose();

    expect(shouldCompactMock).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: "user", content: "Do worker task" }]),
      expect.any(Number),
      0.1,
    );
    expect(compactMock).toHaveBeenCalledWith(
      expect.arrayContaining([{ role: "user", content: "Do worker task" }]),
      expect.objectContaining({
        provider: "anthropic",
        model: "claude-test",
        apiKey: "test-access-token",
      }),
    );
    expect(agentLoopMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        { role: "user", content: "[compacted worker context]\n\nDo worker task" },
      ]),
      expect.objectContaining({ provider: "anthropic", model: "claude-test" }),
    );
  });
});
