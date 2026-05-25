import { describe, expect, it } from "vitest";
import type { Message } from "@kenkaiiii/gg-ai";
import type { ImageAttachment } from "../utils/image.js";
import {
  buildGoalSetupPromptFromPlanner,
  buildUserContentWithAttachments,
  collectAssistantTextSince,
  isGoalPromptCommandName,
  routePromptCommandInput,
  runGoalPromptSetupSequence,
} from "./prompt-routing.js";

describe("prompt-template slash commands with attachments", () => {
  it("routes /goal input to a short setup wrapper containing user args", () => {
    const route = routePromptCommandInput("/goal do X");

    expect(route).not.toBeNull();
    expect(route?.cmdName).toBe("goal");
    expect(route?.cmdArgs).toBe("do X");
    expect(route?.fullPrompt).toContain(route?.promptText);
    expect(route?.fullPrompt).toContain("## User Instructions");
    expect(route?.fullPrompt).toContain("do X");
    expect(route?.fullPrompt).toContain("First plan/research only if needed");
    expect(route?.fullPrompt).toContain("Goal setup will consume that plan");
    expect(route?.fullPrompt).not.toContain("Completion means verifier evidence satisfies");
    expect(route?.fullPrompt.length).toBeLessThan(600);
  });

  it("routes /goal markdown and multiline text without losing rendered edge cases", () => {
    const args = "prove **bold** UI renders\n- keep `code` text\n- wrap very long labels";
    const route = routePromptCommandInput(`/goal ${args}`);

    expect(route).toMatchObject({ cmdName: "goal", cmdArgs: args });
    expect(route?.fullPrompt).toContain(`## User Instructions\n\n${args}`);
    expect(route?.fullPrompt).toContain("**bold** UI renders");
    expect(route?.fullPrompt).toContain("`code` text");
  });

  it("routes /g alias through the same short Goal setup wrapper", () => {
    const route = routePromptCommandInput("/g prove the release flow");

    expect(route).toMatchObject({ cmdName: "g", cmdArgs: "prove the release flow" });
    expect(route?.fullPrompt).toContain("Create a Goal run for the following objective");
    expect(route?.fullPrompt).toContain("First plan/research only if needed");
    expect(route?.fullPrompt).toContain("## User Instructions\n\nprove the release flow");
    expect(route?.fullPrompt).not.toContain("## Plan Mode (ACTIVE)");
  });

  it("detects /goal and /g as Goal setup commands", () => {
    expect(isGoalPromptCommandName("goal")).toBe(true);
    expect(isGoalPromptCommandName("g")).toBe(true);
    expect(isGoalPromptCommandName("goals")).toBe(false);
  });

  it("does not route /goals as /goal", () => {
    expect(routePromptCommandInput("/goals do X")).toBeNull();
  });

  it("collects compact assistant planner output since a message index", () => {
    const text = collectAssistantTextSince(
      [
        { role: "system", content: "system" },
        { role: "assistant", content: "old" },
        { role: "user", content: "planner prompt" },
        { role: "assistant", content: "GOAL_PLAN\nresearch=none\nEND_GOAL_PLAN" },
      ],
      2,
    );

    expect(text).toBe("GOAL_PLAN\nresearch=none\nEND_GOAL_PLAN");
  });

  it("truncates collected planner output before setup embedding", () => {
    const text = collectAssistantTextSince([{ role: "assistant", content: "x".repeat(20) }], 0, 8);

    expect(text).toBe("xxxxxxxx\n[planner output truncated]");
  });

  it("builds setup prompt with planner output embedded once", () => {
    const prompt = buildGoalSetupPromptFromPlanner({
      originalGoalPrompt: "Create a Goal run\n\n## User Instructions\n\ndo X",
      plannerOutput: "GOAL_PLAN\nresearch=docs\nproof=run tests\nEND_GOAL_PLAN",
    });

    expect(prompt).toContain("Create a Goal run");
    expect(prompt).toContain("## User Instructions\n\ndo X");
    expect(prompt.match(/## Goal Planner Output/g)).toHaveLength(1);
    expect(prompt.match(/^GOAL_PLAN$/gm)).toHaveLength(1);
    expect(prompt).toContain("Use the original objective plus this planner output");
    expect(prompt).toContain("create durable Goal setup only");
  });

  it("runs /goal in planner then setup order with planner output handed off", async () => {
    const events: string[] = [];
    const messagesRef: { current: Message[] } = {
      current: [
        { role: "system", content: "system" },
        { role: "user", content: "before goal" },
      ],
    };

    await runGoalPromptSetupSequence({
      userContent: "Create a Goal run\n\n## User Instructions\n\ndo X",
      fullPrompt: "Create a Goal run\n\n## User Instructions\n\ndo X",
      messagesRef,
      async setGoalModeAndPrompt(nextMode) {
        events.push(`mode:${nextMode}`);
      },
      async runAgent(content) {
        events.push(`run:${typeof content === "string" ? content : "multimodal"}`);
        if (events.at(-2) === "mode:planner") {
          messagesRef.current.push({
            role: "assistant",
            content: "GOAL_PLAN\nresearch=none\nproof=goal verifier\nEND_GOAL_PLAN",
          });
        }
      },
    });

    expect(events[0]).toBe("mode:planner");
    expect(events[1]).toContain("run:Create a Goal run");
    expect(events[2]).toBe("mode:setup");
    expect(events[3]).toContain("## Goal Planner Output");
    expect(events[3]).toContain("GOAL_PLAN\nresearch=none\nproof=goal verifier\nEND_GOAL_PLAN");
    expect(events[3]).toContain("create durable Goal setup only");
  });

  it("builds multimodal user content with the full prompt text and image block", () => {
    const fullPrompt = "Goal command prompt\n\n## User Instructions\n\ndo X";
    const imageAttachment: ImageAttachment = {
      kind: "image",
      fileName: "screenshot.png",
      filePath: "/tmp/screenshot.png",
      mediaType: "image/png",
      data: "iVBORw0KGgo=",
    };

    const content = buildUserContentWithAttachments(fullPrompt, [imageAttachment], true);

    expect(content).toEqual([
      { type: "text", text: fullPrompt },
      { type: "image", mediaType: "image/png", data: "iVBORw0KGgo=" },
    ]);
  });

  it("wraps text attachments in file-tag text blocks", () => {
    const textAttachment: ImageAttachment = {
      kind: "text",
      fileName: "notes.txt",
      filePath: "/tmp/notes.txt",
      mediaType: "text/plain",
      data: "important context",
    };

    const content = buildUserContentWithAttachments("Analyze this", [textAttachment], true);

    expect(content).toEqual([
      { type: "text", text: "Analyze this" },
      { type: "text", text: '<file name="notes.txt">\nimportant context\n</file>' },
    ]);
  });

  it("returns the original prompt string when no attachments are provided", () => {
    const fullPrompt = "Goal command prompt\n\n## User Instructions\n\ndo X";

    expect(buildUserContentWithAttachments(fullPrompt, [], true)).toBe(fullPrompt);
  });
});
