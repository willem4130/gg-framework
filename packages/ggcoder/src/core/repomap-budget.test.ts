import { describe, expect, it } from "vitest";
import { FOCUSED_REPO_MAP_MAX_CHARS, FIRST_TURN_REPO_MAP_MAX_CHARS } from "./repomap.js";
import { getRepoMapBudgetForContext } from "./repomap-budget.js";

const userMessage = (content: string) => ({ role: "user" as const, content });
const assistantMessage = (content: string) => ({ role: "assistant" as const, content });

describe("getRepoMapBudgetForContext", () => {
  it("uses the first-turn budget before any files have been read", () => {
    expect(
      getRepoMapBudgetForContext({
        messages: [assistantMessage("hello"), userMessage("first request")],
        readFileCount: 0,
      }),
    ).toBe(FIRST_TURN_REPO_MAP_MAX_CHARS);
  });

  it("uses the focused budget as soon as read-file signals exist", () => {
    expect(
      getRepoMapBudgetForContext({
        messages: [userMessage("first request")],
        readFileCount: 1,
      }),
    ).toBe(FOCUSED_REPO_MAP_MAX_CHARS);
  });

  it("keeps a small repo-map budget after the first turn without file-read focus", () => {
    expect(
      getRepoMapBudgetForContext({
        messages: [userMessage("first"), assistantMessage("done"), userMessage("second")],
        readFileCount: 0,
      }),
    ).toBe(FOCUSED_REPO_MAP_MAX_CHARS + 1000);
  });
});
