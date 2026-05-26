import { writeFileSync } from "node:fs";
import type { Message, TextContent, ImageContent } from "@kenkaiiii/gg-ai";
import type { ImageAttachment } from "../utils/image.js";
import { PROMPT_COMMANDS, getPromptCommand } from "../core/prompt-commands.js";
import type { CustomCommand } from "../core/custom-commands.js";
import type { GoalMode } from "../core/runtime-mode.js";
import type { UserContent } from "./hooks/useAgentLoop.js";

export function routePromptCommandInput(
  input: string,
  promptCommands = PROMPT_COMMANDS,
  customCommands: Pick<CustomCommand, "name" | "prompt">[] = [],
): { cmdName: string; cmdArgs: string; promptText: string; fullPrompt: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(" ");
  const cmdName = parts[0];
  const cmdArgs = parts.slice(1).join(" ").trim();
  const builtinCmd = promptCommands.find((c) => c.name === cmdName || c.aliases.includes(cmdName));
  const customCmd = !builtinCmd ? customCommands.find((c) => c.name === cmdName) : undefined;
  const promptText = builtinCmd?.prompt ?? customCmd?.prompt;
  if (!promptText) return null;
  return {
    cmdName,
    cmdArgs,
    promptText,
    fullPrompt: cmdArgs ? `${promptText}\n\n## User Instructions\n\n${cmdArgs}` : promptText,
  };
}

const GOAL_PLANNER_OUTPUT_MAX_CHARS = 2400;
const GOAL_PLAN_BLOCK_PATTERN = /GOAL_PLAN[\s\S]*?END_GOAL_PLAN/;

function messageTextContent(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

export function collectAssistantTextSince(
  messages: readonly Message[],
  startIndex: number,
  maxChars = GOAL_PLANNER_OUTPUT_MAX_CHARS,
): string {
  const text = messages
    .slice(startIndex)
    .filter((message) => message.role === "assistant")
    .map(messageTextContent)
    .join("\n")
    .trim();
  const goalPlanBlock = text.match(GOAL_PLAN_BLOCK_PATTERN)?.[0]?.trim();
  if (goalPlanBlock) return goalPlanBlock;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars).trimEnd() + "\n[planner output truncated]";
}

export function buildGoalSetupPromptFromPlanner({
  originalGoalPrompt,
  plannerOutput,
}: {
  originalGoalPrompt: string;
  plannerOutput: string;
}): string {
  const compactPlannerOutput = plannerOutput.trim() || "GOAL_PLAN\nresearch=none\nEND_GOAL_PLAN";
  return (
    `${originalGoalPrompt.trim()}\n\n` +
    `## Goal Planner Output\n\n${compactPlannerOutput}\n\n` +
    `Use the original objective plus this planner output to create durable Goal setup only. ` +
    `Pass this exact planner output in the goals create summary so durable GOAL_PLAN evidence is recorded. ` +
    `Do not redo planner research unless the planner output is unusable.`
  );
}

export function isGoalPromptCommandName(cmdName: string): boolean {
  return getPromptCommand(cmdName)?.name === "goal";
}

export async function runGoalPromptSetupSequence({
  userContent,
  fullPrompt,
  messagesRef,
  setGoalModeAndPrompt,
  runAgent,
  onStage,
}: {
  userContent: UserContent;
  fullPrompt: string;
  messagesRef: { current: Message[] };
  setGoalModeAndPrompt: (nextMode: GoalMode) => Promise<void>;
  runAgent: (content: UserContent) => Promise<void>;
  onStage?: (text: string) => void;
}): Promise<void> {
  onStage?.("Planning Goal setup");
  await setGoalModeAndPrompt("planner");
  const plannerStartIndex = messagesRef.current.length;
  await runAgent(userContent);
  const plannerOutput = collectAssistantTextSince(messagesRef.current, plannerStartIndex);
  const setupPrompt = buildGoalSetupPromptFromPlanner({
    originalGoalPrompt: fullPrompt,
    plannerOutput,
  });
  await setGoalModeAndPrompt("setup");
  onStage?.("Creating Goal run");
  await runAgent(setupPrompt);
}

export function buildUserContentWithAttachments(
  text: string,
  inputImages: ImageAttachment[],
  modelSupportsImages: boolean,
): string | (TextContent | ImageContent)[] {
  if (inputImages.length === 0) return text;

  const parts: (TextContent | ImageContent)[] = [];
  if (text) {
    parts.push({ type: "text", text });
  }

  for (const img of inputImages) {
    if (img.kind === "text") {
      parts.push({
        type: "text",
        text: `<file name="${img.fileName}">\n${img.data}\n</file>`,
      });
    } else if (modelSupportsImages) {
      parts.push({ type: "image", mediaType: img.mediaType, data: img.data });
    } else {
      // GLM models: save image to temp file and instruct model to use vision MCP tool
      const ext = img.mediaType.split("/")[1] ?? "png";
      const tmpPath = `/tmp/ggcoder-img-${Date.now()}.${ext}`;
      try {
        writeFileSync(tmpPath, Buffer.from(img.data, "base64"));
        parts.push({
          type: "text",
          text: `[User attached an image saved at: ${tmpPath} — use the image_analysis tool to view and analyze it]`,
        });
      } catch {
        parts.push({
          type: "text",
          text: `[User attached an image but it could not be saved for analysis]`,
        });
      }
    }
  }

  // If only text parts remain after stripping images, simplify to plain string
  return parts.length === 1 && parts[0].type === "text" ? parts[0].text : parts;
}
