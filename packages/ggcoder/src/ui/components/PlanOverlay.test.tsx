import React from "react";
import { renderToString } from "ink";
import { describe, expect, it } from "vitest";
import { PlanActionBar } from "./PlanOverlay.js";
import { ThemeContext, loadTheme } from "../theme/theme.js";

function stripAnsi(value: string): string {
  return value.replace(new RegExp(String.raw`\u001B\[[0-?]*[ -/]*[@-~]`, "g"), "");
}

function renderActionBar(node: React.ReactElement): string {
  return stripAnsi(
    renderToString(<ThemeContext.Provider value={loadTheme("dark")}>{node}</ThemeContext.Provider>),
  );
}

describe("PlanActionBar", () => {
  it("renders approve/reject controls in the same compact TUI row style", () => {
    const output = renderActionBar(
      <PlanActionBar
        planName="review"
        confirmDelete={false}
        rejectMode={false}
        rejectFeedback=""
      />,
    );

    expect(output.trim()).toBe("◇ a approve · r reject · d delete · q back · ESC close");
  });

  it("renders reject feedback as a bottom input-style prompt", () => {
    const output = renderActionBar(
      <PlanActionBar
        planName="review"
        confirmDelete={false}
        rejectMode
        rejectFeedback="Need more risk notes"
      />,
    );

    expect(output).toContain("Feedback (Enter to submit, Esc to cancel):");
    expect(output).toContain("> Need more risk notes▍");
  });
});
