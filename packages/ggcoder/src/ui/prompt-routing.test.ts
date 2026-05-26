import { describe, expect, it } from "vitest";
import type { Message } from "@kenkaiiii/gg-ai";
import { buildGoalSetupPromptFromPlanner, collectAssistantTextSince } from "./prompt-routing.js";

function assistant(text: string): Message {
  return { role: "assistant", content: text };
}

function user(text: string): Message {
  return { role: "user", content: text };
}

describe("Goal prompt routing", () => {
  it("preserves the complete GOAL_PLAN block when planner output includes earlier chatter", () => {
    const longPreamble = "diagnostic chatter ".repeat(400);
    const messages: Message[] = [
      user("/goal improve the loop"),
      assistant(`${longPreamble}\nGOAL_PLAN\nresearch=local\nsuccess=durable setup\nproof=targeted test\nEND_GOAL_PLAN`),
    ];

    const collected = collectAssistantTextSince(messages, 1, 2400);

    expect(collected).toBe(
      "GOAL_PLAN\nresearch=local\nsuccess=durable setup\nproof=targeted test\nEND_GOAL_PLAN",
    );
    expect(collected).not.toContain("diagnostic chatter");
  });

  it("instructs Goal setup to persist planner output as durable summary evidence", () => {
    const setupPrompt = buildGoalSetupPromptFromPlanner({
      originalGoalPrompt: "/goal ship it\n\n## Goal References (MANDATORY)\n\n- [original-goal-prompt] kind=prompt; label=\"Original Goal prompt\"",
      plannerOutput: "GOAL_PLAN\nresearch=none\nsuccess=ship\nEND_GOAL_PLAN",
    });

    expect(setupPrompt).toContain("## Goal References (MANDATORY)");
    expect(setupPrompt).toContain("GOAL_PLAN\nresearch=none\nsuccess=ship\nEND_GOAL_PLAN");
    expect(setupPrompt).toContain("Pass this exact planner output in the goals create summary");
  });
});
