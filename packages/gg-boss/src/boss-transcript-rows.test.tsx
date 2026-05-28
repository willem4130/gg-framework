import { describe, expect, it } from "vitest";
import {
  parseStatusGrade,
  parseWorkerTrailer,
  summarizeFinalText,
} from "./boss-transcript-rows.js";

describe("boss transcript worker trailer parsing", () => {
  it("extracts structured worker trailer fields", () => {
    const trailer = parseWorkerTrailer(
      `Done.\n\nChanged: src/app.ts and tests\nVerified: pnpm test\nNotes: none\nStatus: DONE`,
    );

    expect(trailer.changed).toBe("src/app.ts and tests");
    expect(trailer.verified).toBe("pnpm test");
    expect(trailer.notes).toBe("none");
  });

  it("uses the last status grade", () => {
    expect(parseStatusGrade("Status: INFO\nLater\nStatus: PARTIAL — missing fixture")).toBe(
      "PARTIAL",
    );
    expect(parseStatusGrade("no status here")).toBeNull();
  });

  it("summarizes trailer content before falling back to prose", () => {
    expect(
      summarizeFinalText("Changed: UI shell\nVerified: typecheck\nStatus: DONE", 80),
    ).toContain("Changed: UI shell");
    expect(summarizeFinalText("I checked the project. Everything is idle.\nStatus: INFO", 80)).toBe(
      "I checked the project.",
    );
  });
});
