import type { CompletedItem } from "./App.js";

export function isAgentSpacingKind(kind: CompletedItem["kind"]): boolean {
  return [
    "assistant",
    "queued",
    "goal_progress",
    "tool_start",
    "tool_done",
    "tool_group",
    "server_tool_start",
    "server_tool_done",
    "subagent_group",
    "info",
    "error",
    "stopped",
    "plan_transition",
    "goal_agent_transition",
    "thinking_transition",
    "model_transition",
    "theme_transition",
    "plan_event",
    "update_notice",
    "compacting",
    "compacted",
    "style_pack",
    "setup_hint",
  ].includes(kind);
}
