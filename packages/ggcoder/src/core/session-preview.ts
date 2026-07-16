import type { Message } from "@kenkaiiii/gg-ai";

const COMPACTION_SUMMARY_PREFIX = "[Previous conversation summary]";
const AUTOPILOT_PROMPT_PREFIX =
  "[Autopilot] This turn was triggered by Ken, GG Coder's automated reviewer";
const STEERING_PREFIX_START = "[The user added this while you were working";

/** Extract visible text from a persisted message content value. */
export function extractSessionText(content: Message["content"] | unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => {
      if (!block || typeof block !== "object" || !("text" in block)) return "";
      const text = (block as { text?: unknown }).text;
      return typeof text === "string" ? text : "";
    })
    .filter(Boolean)
    .join(" ");
}

/**
 * Return user-authored prompt text suitable for a stable session title.
 * Compaction summaries and Ken's autopilot injections are model-owned context,
 * not new conversations, so they must never replace the user's title.
 */
export function getUserSessionPrompt(content: Message["content"] | unknown): string | null {
  let text = extractSessionText(content).trim();
  if (!text) return null;
  if (text.startsWith(COMPACTION_SUMMARY_PREFIX) || text.startsWith(AUTOPILOT_PROMPT_PREFIX)) {
    return null;
  }

  // A queued steering note is still user-authored; remove only its machine frame.
  if (text.startsWith(STEERING_PREFIX_START)) {
    const closing = text.indexOf("]\n\n");
    if (closing >= 0) text = text.slice(closing + 3).trim();
  }
  return text || null;
}

export function findUserSessionPrompt(messages: readonly Message[]): string {
  for (const message of messages) {
    if (message.role !== "user") continue;
    const text = getUserSessionPrompt(message.content);
    if (text) return text;
  }
  return "";
}
