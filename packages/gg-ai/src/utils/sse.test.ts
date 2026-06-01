import { describe, it, expect } from "vitest";
import { parseSseBuffer, readSseStream, type SseEvent } from "./sse.js";

function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(encoder.encode(chunks[i]));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

async function collect(chunks: string[]): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSseStream(streamFromChunks(chunks))) {
    events.push(event);
  }
  return events;
}

describe("parseSseBuffer", () => {
  it("parses a single data event and returns no remaining", () => {
    const { events, remaining } = parseSseBuffer("data: hello\n\n");
    expect(events).toEqual([{ event: undefined, data: "hello" }]);
    expect(remaining).toBe("");
  });

  it("joins multi-line data fields", () => {
    const { events } = parseSseBuffer("data: line1\ndata: line2\n\n");
    expect(events[0]?.data).toBe("line1\nline2");
  });

  it("captures event names", () => {
    const { events } = parseSseBuffer("event: ping\ndata: {}\n\n");
    expect(events[0]).toEqual({ event: "ping", data: "{}" });
  });

  it("returns a trailing partial event as remaining", () => {
    const { events, remaining } = parseSseBuffer("data: done\n\ndata: partial");
    expect(events).toEqual([{ event: undefined, data: "done" }]);
    expect(remaining).toBe("data: partial");
  });
});

describe("readSseStream", () => {
  it("normalizes CRLF line endings", async () => {
    const events = await collect(["data: hello\r\n\r\n"]);
    expect(events).toEqual([{ event: undefined, data: "hello" }]);
  });

  it("emits each event including [DONE] sentinel for the caller to skip", async () => {
    const events = await collect(["data: a\n\ndata: [DONE]\n\n"]);
    expect(events.map((e) => e.data)).toEqual(["a", "[DONE]"]);
  });

  it("reassembles an event split across two reads", async () => {
    const events = await collect(["data: hel", "lo\n\n"]);
    expect(events).toEqual([{ event: undefined, data: "hello" }]);
  });

  it("flushes a final event lacking a trailing blank line", async () => {
    const events = await collect(["data: first\n\ndata: last"]);
    expect(events.map((e) => e.data)).toEqual(["first", "last"]);
  });
});
