import { describe, expect, it } from "vitest";
import {
  extractPlanSteps,
  segmentDisplayText,
  stripDoneMarkers,
  type PlanStep,
} from "./plan-steps.js";

const steps: PlanStep[] = [{ step: 6, text: "Ship the final response", completed: false }];

describe("extractPlanSteps", () => {
  it("returns no steps when the plan has no `## Steps` section", () => {
    // Numbered prose that is NOT a task list — design decisions, Q&A bullets,
    // rejected alternatives. None of these should be scraped as steps.
    const plan = [
      "# Reels Pipeline",
      "",
      "## Design Decisions",
      "1. All TypeScript / Node (no Python sidecar in v1).",
      "2. Ports & adapters (hexagonal).",
      "",
      "## Open Questions",
      "1. Source format(s):",
      "2. Caption styles:",
    ].join("\n");
    expect(extractPlanSteps(plan)).toEqual([]);
  });

  it("extracts only the numbered items under a `## Steps` section", () => {
    const plan = [
      "# Plan",
      "",
      "## Design Decisions",
      "1. Use hexagonal architecture.",
      "",
      "## Steps",
      "1. Add the FFmpeg renderer adapter.",
      "2. Wire the renderer into the CLI.",
      "3. **Add an integration test** for the render path.",
      "",
      "## Risks",
      "1. ONNX model download may be large.",
    ].join("\n");
    expect(extractPlanSteps(plan)).toEqual([
      { step: 1, text: "Add the FFmpeg renderer adapter.", completed: false },
      { step: 2, text: "Wire the renderer into the CLI.", completed: false },
      { step: 3, text: "Add an integration test", completed: false },
    ]);
  });

  it("renumbers steps sequentially and skips sub-items / snippets", () => {
    const plan = [
      "## Steps",
      "1. First real step here.",
      "   1. nested detail that should be ignored",
      "2. `code-only line`",
      "3. Second real step here.",
    ].join("\n");
    expect(extractPlanSteps(plan)).toEqual([
      { step: 1, text: "First real step here.", completed: false },
      { step: 2, text: "Second real step here.", completed: false },
    ]);
  });
});

describe("plan step display markers", () => {
  it("strips DONE markers even when adjacent to assistant text", () => {
    expect(stripDoneMarkers("[DONE:6]All set.")).toBe("All set.");
    expect(stripDoneMarkers("Finished [DONE:6]All set.")).toBe("Finished All set.");
  });

  it("segments adjacent DONE markers before following assistant text", () => {
    expect(segmentDisplayText("[DONE:6]All set.", steps)).toEqual([
      { kind: "done", stepNum: 6, description: "Ship the final response" },
      { kind: "text", text: "All set." },
    ]);
  });
});
