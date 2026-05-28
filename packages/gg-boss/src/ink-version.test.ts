import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("gg-boss Ink dependency", () => {
  it("pins Ink to match GG Coder", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
      devDependencies?: Record<string, string>;
      dependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.ink ?? pkg.devDependencies?.ink).toBe("6.8.0");
  });
});
