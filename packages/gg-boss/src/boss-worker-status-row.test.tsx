import { describe, expect, it } from "vitest";
import { formatWorkerElapsed } from "./boss-worker-status-row.js";

describe("BossWorkerStatusRow helpers", () => {
  it("formats elapsed worker time as m:ss", () => {
    expect(formatWorkerElapsed(0)).toBe("0:00");
    expect(formatWorkerElapsed(9_999)).toBe("0:09");
    expect(formatWorkerElapsed(65_000)).toBe("1:05");
  });
});
