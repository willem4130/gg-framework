import { describe, expect, it } from "vitest";
import { segmentDisplayText, stripDoneMarkers, type PlanStep } from "./plan-steps.js";

const steps: PlanStep[] = [{ step: 6, text: "Ship the final response", completed: false }];

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
