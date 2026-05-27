import { describe, expect, it } from "vitest";
import { getTranscriptItemMarginTop, isTranscriptSpacingKind } from "./spacing.js";
import type { CompletedItem } from "../app-items.js";

describe("transcript spacing", () => {
  it("treats user messages as spaced transcript rows", () => {
    expect(isTranscriptSpacingKind("user")).toBe(true);
  });

  it("keeps a submitted user message separated after a plan transition", () => {
    const item: CompletedItem = { kind: "user", id: "user", text: "create a new plan" };
    const previous: CompletedItem = {
      kind: "plan_transition",
      id: "plan",
      text: "Plan mode ON",
      active: true,
    };

    expect(
      getTranscriptItemMarginTop({
        item,
        lastHistoryItem: previous,
      }),
    ).toBe(1);
  });
});
