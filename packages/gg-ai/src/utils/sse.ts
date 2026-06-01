export interface SseEvent {
  event?: string;
  data: string;
}

/**
 * Pure incremental SSE parser. Splits a buffer on blank lines (`\n\n`),
 * extracting `event:` names and joined `data:` payloads. Returns the parsed
 * events plus any trailing partial event still buffered.
 *
 * Input is expected to already be CRLF-normalized (`\r\n` → `\n`).
 */
export function parseSseBuffer(buffer: string): { events: SseEvent[]; remaining: string } {
  const events: SseEvent[] = [];
  let cursor = 0;

  while (true) {
    const next = buffer.indexOf("\n\n", cursor);
    if (next === -1) break;
    const raw = buffer.slice(cursor, next);
    cursor = next + 2;

    let eventName: string | undefined;
    const dataLines: string[] = [];
    for (const line of raw.split("\n")) {
      if (line.startsWith("event:")) {
        eventName = line.slice("event:".length).trim();
      } else if (line.startsWith("data:")) {
        dataLines.push(line.slice("data:".length).trimStart());
      }
    }

    if (dataLines.length > 0) {
      events.push({ event: eventName, data: dataLines.join("\n") });
    }
  }

  return { events, remaining: buffer.slice(cursor) };
}

/**
 * Stream wrapper over a web `ReadableStream`. Decodes bytes, normalizes CRLF,
 * yields each complete SSE event, and flushes the trailing buffer after the
 * stream ends (so a final event lacking a trailing blank line is not dropped).
 */
export async function* readSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<SseEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
      const parsed = parseSseBuffer(buffer);
      buffer = parsed.remaining;
      yield* parsed.events;
    }
    buffer += decoder.decode().replace(/\r\n/g, "\n");
    const parsed = parseSseBuffer(buffer + "\n\n");
    yield* parsed.events;
  } finally {
    reader.releaseLock();
  }
}
