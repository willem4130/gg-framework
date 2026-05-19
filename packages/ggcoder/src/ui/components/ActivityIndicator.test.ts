import { describe, expect, it } from "vitest";
import { buildMetaParts, getThinkingShimmerColor } from "./ActivityIndicator.js";

describe("buildMetaParts", () => {
  it("shows live thinking without a duration before one second", () => {
    expect(buildMetaParts(400, 400, true, 0)).toEqual({
      prefix: "0s",
      thinking: "thinking",
    });
  });

  it("shows live thinking duration after one second", () => {
    expect(buildMetaParts(12_400, 5_400, true, 425)).toEqual({
      prefix: "12s · ↓ 425 tokens",
      thinking: "thinking for 5s",
    });
  });

  it("shows completed thought duration only after one second", () => {
    expect(buildMetaParts(61_000, 1_000, false, 1_250)).toEqual({
      prefix: "1m 1s · ↓ 1.3k tokens",
      thinking: "thought for 1s",
    });
  });

  it("omits completed thought duration below one second", () => {
    expect(buildMetaParts(2_000, 999, false, 0)).toEqual({
      prefix: "2s",
      thinking: "",
    });
  });
});

describe("getThinkingShimmerColor", () => {
  it("uses high-contrast green on dark themes", () => {
    expect(getThinkingShimmerColor("dark")).toBe("#22c55e");
  });

  it("uses a darker green on light themes", () => {
    expect(getThinkingShimmerColor("light")).toBe("#15803d");
  });

  it("uses ANSI green on ANSI themes", () => {
    expect(getThinkingShimmerColor("light-ansi")).toBe("#55ff55");
  });
});
