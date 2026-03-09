import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createWriteTool } from "./write.js";

function resultToString(result: string | { content: string }): string {
  return typeof result === "string" ? result : result.content;
}

describe("createWriteTool", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "write-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("returns line count and content for a short file", async () => {
    const tool = createWriteTool(tmpDir);
    const content = "line1\nline2\nline3\n";
    const raw = await tool.execute(
      { file_path: "test.txt", content },
      { signal: new AbortController().signal, toolCallId: "test-1" },
    );

    const lines = resultToString(raw).split("\n");
    expect(lines[0]).toBe("Wrote 3 lines to test.txt");
    // Rest should be the content itself
    expect(lines.slice(1).join("\n")).toBe(content);
  });

  it("counts lines correctly without trailing newline", async () => {
    const tool = createWriteTool(tmpDir);
    const content = "a\nb\nc";
    const raw = await tool.execute(
      { file_path: "no-newline.txt", content },
      { signal: new AbortController().signal, toolCallId: "test-2" },
    );

    expect(resultToString(raw).split("\n")[0]).toBe("Wrote 3 lines to no-newline.txt");
  });

  it("counts single line correctly", async () => {
    const tool = createWriteTool(tmpDir);
    const content = "hello world\n";
    const raw = await tool.execute(
      { file_path: "one.txt", content },
      { signal: new AbortController().signal, toolCallId: "test-3" },
    );

    expect(resultToString(raw).split("\n")[0]).toBe("Wrote 1 lines to one.txt");
  });

  it("uses relative path from cwd", async () => {
    const tool = createWriteTool(tmpDir);
    const subDir = path.join("sub", "dir");
    const raw = await tool.execute(
      { file_path: `${subDir}/file.txt`, content: "test\n" },
      { signal: new AbortController().signal, toolCallId: "test-4" },
    );

    expect(resultToString(raw).split("\n")[0]).toBe(`Wrote 1 lines to ${subDir}/file.txt`);
  });

  it("content in result can be parsed by UI (trailing newline trimming)", async () => {
    const tool = createWriteTool(tmpDir);
    const content = "# Title\n\nSome content\nMore content\n";
    const raw = await tool.execute(
      { file_path: "readme.md", content },
      { signal: new AbortController().signal, toolCallId: "test-5" },
    );

    // Simulate the UI parsing logic from ToolExecution.tsx
    const result = resultToString(raw);
    const allLines = result.split("\n");
    const summary = allLines[0];
    let contentLines = allLines.slice(1);
    if (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
      contentLines = contentLines.slice(0, -1);
    }

    expect(summary).toBe("Wrote 4 lines to readme.md");
    expect(contentLines).toEqual(["# Title", "", "Some content", "More content"]);
    expect(contentLines.length).toBe(4);
  });

  it("UI truncation logic works for long files", async () => {
    const MAX_OUTPUT_LINES = 8;
    const tool = createWriteTool(tmpDir);
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`);
    const content = lines.join("\n") + "\n";
    const raw = await tool.execute(
      { file_path: "long.txt", content },
      { signal: new AbortController().signal, toolCallId: "test-6" },
    );

    const result = resultToString(raw);
    const allLines = result.split("\n");
    const summary = allLines[0];
    let contentLines = allLines.slice(1);
    if (contentLines.length > 0 && contentLines[contentLines.length - 1] === "") {
      contentLines = contentLines.slice(0, -1);
    }

    expect(summary).toBe("Wrote 20 lines to long.txt");
    expect(contentLines.length).toBe(20);

    // Simulate UI display
    const displayLines = contentLines.slice(0, MAX_OUTPUT_LINES);
    const totalLines = 1 + contentLines.length; // summary + content
    const renderedCount = 1 + displayLines.length; // summary + displayed content
    const hiddenCount = totalLines - renderedCount;

    expect(displayLines.length).toBe(8);
    expect(hiddenCount).toBe(12); // 21 - 9 = 12
  });
});
