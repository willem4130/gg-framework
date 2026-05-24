import { describe, expect, it } from "vitest";
import { splitAssistantStreamingText } from "./assistant-stream-split.js";

function normalize(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

describe("splitAssistantStreamingText", () => {
  it("produces chunks that callers can append as one visual response", () => {
    const text =
      "The first complete stanza can move into history while streaming keeps its original response marker. " +
      "The second complete stanza can also move without creating a new assistant bubble. " +
      "The final line remains as the live tail until the turn ends.";

    const first = splitAssistantStreamingText(text, 80);
    const second = splitAssistantStreamingText(first.remainingText, 40);

    expect(first.flushedText.length).toBeGreaterThan(0);
    expect(second.flushedText.length).toBeGreaterThan(0);
    expect(normalize(`${first.flushedText} ${second.flushedText} ${second.remainingText}`)).toBe(
      normalize(text),
    );
  });

  it("does not split short streaming text", () => {
    const text = "A short answer should stay live while it streams.";

    expect(splitAssistantStreamingText(text)).toEqual({
      flushedText: "",
      remainingText: text,
    });
  });

  it("splits long prose at a safe sentence boundary and preserves all text", () => {
    const text =
      "First, the terminal should keep the composer stable while words arrive. " +
      "Second, completed prose can be moved into scrollback before the final render. " +
      "Third, only a small tail should remain in the live Ink tree so the controls do not jump. " +
      "Fourth, the entire answer must still be readable in terminal history after the turn finishes.";

    const split = splitAssistantStreamingText(text, 100);

    expect(split.flushedText).toContain("First");
    expect(split.flushedText.length).toBeGreaterThan(0);
    expect(split.remainingText.length).toBeGreaterThanOrEqual(100);
    expect(normalize(`${split.flushedText} ${split.remainingText}`)).toBe(normalize(text));
  });

  it("prefers paragraph boundaries over keeping a huge live tail", () => {
    const text =
      "Paragraph one has enough detail to be safely moved into terminal history once it is complete.\n\n" +
      "Paragraph two is still being written and should remain as the visible live tail for Ink.";

    const split = splitAssistantStreamingText(text, 60);

    expect(split.flushedText).toBe(
      "Paragraph one has enough detail to be safely moved into terminal history once it is complete.",
    );
    expect(split.remainingText).toBe(
      "Paragraph two is still being written and should remain as the visible live tail for Ink.",
    );
    expect(normalize(`${split.flushedText} ${split.remainingText}`)).toBe(normalize(text));
  });

  it("does not split inside an open code fence", () => {
    const text =
      "Here is code:\n\n" +
      "```ts\n" +
      "const one = 1;\n" +
      "const two = 2;\n" +
      "const three = 3;\n" +
      "const four = 4;\n" +
      "```\n\n" +
      "Now the explanation can continue safely after the closed fence.";

    const split = splitAssistantStreamingText(text, 45);

    expect(split.flushedText).toContain("```");
    expect(split.flushedText.match(/```/gu)?.length).toBe(2);
    expect(normalize(`${split.flushedText} ${split.remainingText}`)).toBe(normalize(text));
  });
});
