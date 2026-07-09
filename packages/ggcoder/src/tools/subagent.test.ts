import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import type { AgentDefinition } from "../core/agents.js";
import { createSubAgentTool, isModelUnavailableError } from "./subagent.js";

class MockChildProcess extends EventEmitter {
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  readonly kill = vi.fn(() => true);
}

const owl: AgentDefinition = {
  name: "owl",
  description: "Read-only scout",
  tools: ["read"],
  systemPrompt: "Inspect code and report findings.",
  source: "bundled",
};

function spawnedModels(): string[] {
  return spawnMock.mock.calls.map(([, rawArgs]) => {
    const args = rawArgs as string[];
    return args[args.indexOf("--model") + 1]!;
  });
}

function mockExit(stderr: string, code: number, stdout = ""): MockChildProcess {
  const child = new MockChildProcess();
  setImmediate(() => {
    if (stdout) child.stdout.write(`${JSON.stringify({ type: "text_delta", text: stdout })}\n`);
    if (stderr) child.stderr.write(stderr);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", code);
  });
  return child;
}

async function runOwl() {
  const tool = createSubAgentTool(
    process.cwd(),
    [owl],
    () => "openai",
    () => "gpt-5.6-sol",
  );
  return tool.execute(
    { agent: "owl", task: "Inspect the registry." },
    { signal: new AbortController().signal, toolCallId: "test-call" },
  );
}

beforeEach(() => {
  spawnMock.mockReset();
});

describe("createSubAgentTool fast-model fallback", () => {
  it("respawns with the parent model when the fast model is unavailable", async () => {
    spawnMock
      .mockImplementationOnce(() =>
        mockExit("OpenAI does not recognize the requested model (not).", 1),
      )
      .mockImplementationOnce(() => mockExit("", 0, "fallback succeeded"));

    await expect(runOwl()).resolves.toMatchObject({ content: "fallback succeeded" });
    expect(spawnedModels()).toEqual(["gpt-5.6-luna", "gpt-5.6-sol"]);
  });

  it("does not retry unrelated child failures", async () => {
    spawnMock.mockImplementationOnce(() => mockExit("usage limit reached", 1));

    await expect(runOwl()).resolves.toMatchObject({
      content: "Sub-agent failed (exit 1): usage limit reached",
    });
    expect(spawnedModels()).toEqual(["gpt-5.6-luna"]);
  });
});

describe("isModelUnavailableError", () => {
  it("recognizes unavailable-model failures", () => {
    expect(
      isModelUnavailableError(
        "OpenAI does not recognize the requested model (not). It may not exist or your account may not have access.",
      ),
    ).toBe(true);
    expect(isModelUnavailableError("The requested model is not available for this account.")).toBe(
      true,
    );
    expect(isModelUnavailableError("Model gpt-example does not exist.")).toBe(true);
  });

  it("does not retry unrelated provider or process failures", () => {
    expect(isModelUnavailableError("usage limit reached")).toBe(false);
    expect(isModelUnavailableError("401 invalid authentication credentials")).toBe(false);
    expect(isModelUnavailableError("spawn node ENOENT")).toBe(false);
  });
});
