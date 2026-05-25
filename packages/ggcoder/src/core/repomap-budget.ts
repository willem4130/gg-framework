import type { Message } from "@kenkaiiii/gg-ai";
import { FOCUSED_REPO_MAP_MAX_CHARS, FIRST_TURN_REPO_MAP_MAX_CHARS } from "./repomap.js";

export interface RepoMapBudgetSignals {
  messages: readonly Message[];
  readFileCount: number;
}

export function getRepoMapBudgetForContext({
  messages,
  readFileCount,
}: RepoMapBudgetSignals): number {
  const userTurns = messages.filter((message) => message.role === "user").length;
  if (userTurns <= 1 && readFileCount === 0) return FIRST_TURN_REPO_MAP_MAX_CHARS;
  if (readFileCount > 0) return FOCUSED_REPO_MAP_MAX_CHARS;
  return FOCUSED_REPO_MAP_MAX_CHARS + 1000;
}
