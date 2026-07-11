import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentDefinition } from "./agents.js";
import { SubAgentManager } from "./subagent-manager.js";

const workerEntry = fileURLToPath(
  new URL("../tools/__fixtures__/fake-subagent-worker.mjs", import.meta.url),
);
const agents: AgentDefinition[] = [
  {
    name: "fake",
    description: "Fake test worker",
    tools: ["read"],
    systemPrompt: "fake",
    source: "bundled",
  },
];
const managers: SubAgentManager[] = [];

function manager(options: { idleTimeoutMs?: number; agentDefs?: AgentDefinition[] } = {}) {
  const instance = new SubAgentManager({
    cwd: process.cwd(),
    agents: options.agentDefs ?? agents,
    getProvider: () => "openai",
    getModel: () => "gpt-5.6-sol",
    getThinkingLevel: () => "ultra",
    workerEntry,
    idleTimeoutMs: options.idleTimeoutMs,
  });
  managers.push(instance);
  return instance;
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((instance) => instance.shutdownAll()));
});

describe("SubAgentManager", () => {
  it("returns after launch and overlaps four child turns", async () => {
    const instance = manager();
    const start = Date.now();
    const children = await Promise.all(
      [1, 2, 3, 4].map((number) => instance.spawn(`task-${number}`, "slow", "fake")),
    );
    expect(Date.now() - start).toBeLessThan(140);
    expect(children.every((child) => child.state === "running")).toBe(true);
    await expect(instance.spawn("fifth", "slow", "fake")).rejects.toThrow("At most 4");
    const result = await instance.wait(
      children.map((child) => child.agent_id),
      "all",
      1_000,
    );
    expect(result.timed_out).toBe(false);
    expect(result.agents.every((child) => child.state === "completed")).toBe(true);
  });

  it("waits for any, times out, steers, interrupts, and reuses context", async () => {
    const instance = manager();
    const fast = await instance.spawn("fast", "fast", "fake");
    const slow = await instance.spawn("slow", "slow", "fake");
    expect(await instance.sendMessage(slow.agent_id, "focus")).toBe(1);
    const any = await instance.wait([fast.agent_id, slow.agent_id], "any", 500);
    expect(any.timed_out).toBe(false);
    expect(any.agents.some((child) => child.state === "completed")).toBe(true);
    const timeout = await instance.wait([slow.agent_id], "all", 1);
    expect(timeout.timed_out).toBe(true);
    await instance.interrupt(slow.agent_id);
    const interrupted = await instance.wait([slow.agent_id], "all", 500);
    expect(interrupted.agents[0]?.state).toBe("interrupted");
    await instance.followup(slow.agent_id, "again");
    const followed = await instance.wait([slow.agent_id], "all", 500);
    expect(followed.agents[0]?.output).toContain("context:2");
  });

  it("rejects duplicate live names and reports malformed workers", async () => {
    const instance = manager();
    await instance.spawn("same", "slow", "fake");
    await expect(instance.spawn("same", "other", "fake")).rejects.toThrow("already exists");

    const malformedDefs = [{ ...agents[0]!, name: "bad", systemPrompt: "malformed" }];
    const malformed = manager({ agentDefs: malformedDefs });
    await expect(malformed.spawn("bad", "task", "bad")).rejects.toThrow("malformed");
  });

  it("rejects a launch that is still starting when cancellation interrupts all workers", async () => {
    const hangingDefs = [{ ...agents[0]!, name: "hanging", systemPrompt: "hang" }];
    const instance = manager({ agentDefs: hangingDefs });
    const launch = instance.spawn("hanging", "task", "hanging");
    const rejection = expect(launch).rejects.toThrow("Subagent worker closed");

    await new Promise((resolve) => setTimeout(resolve, 20));
    await instance.interruptAll();
    await rejection;
  });

  it("reaps idle workers and retains a bounded closed snapshot", async () => {
    const instance = manager({ idleTimeoutMs: 5 });
    const child = await instance.spawn("short", "fast", "fake");
    await instance.wait([child.agent_id], "all", 500);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(instance.list().find((item) => item.agent_id === child.agent_id)?.state).toBe("closed");
    await expect(instance.followup(child.agent_id, "late")).rejects.toThrow("reaped");
  });
});
