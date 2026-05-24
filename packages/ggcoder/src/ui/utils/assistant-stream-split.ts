export interface AssistantStreamSplit {
  flushedText: string;
  remainingText: string;
}

const DEFAULT_MIN_REMAINING_CHARS = 120;

function isInsideCodeFence(text: string): boolean {
  const fenceMatches = text.match(/^\s*(`{3,}|~{3,})/gm);
  return (fenceMatches?.length ?? 0) % 2 === 1;
}

function findSafeSplitIndex(text: string, minRemainingChars: number): number {
  const latestAllowedIndex = text.length - minRemainingChars;
  if (latestAllowedIndex <= 0) return 0;

  const candidates = ["\n\n", "\n- ", "\n* ", "\n1. ", "\n2. ", "\n3. ", ". ", "! ", "? "];
  let best = 0;

  for (const marker of candidates) {
    let searchFrom = 0;
    while (searchFrom < latestAllowedIndex) {
      const index = text.indexOf(marker, searchFrom);
      if (index === -1 || index > latestAllowedIndex) break;
      const splitIndex = index + marker.length;
      if (splitIndex > best && !isInsideCodeFence(text.slice(0, splitIndex))) {
        best = splitIndex;
      }
      searchFrom = index + marker.length;
    }
  }

  return best;
}

export function splitAssistantStreamingText(
  text: string,
  minRemainingChars = DEFAULT_MIN_REMAINING_CHARS,
): AssistantStreamSplit {
  const splitIndex = findSafeSplitIndex(text, minRemainingChars);
  if (splitIndex <= 0) {
    return { flushedText: "", remainingText: text };
  }

  return {
    flushedText: text.slice(0, splitIndex).replace(/\s+$/u, ""),
    remainingText: text.slice(splitIndex).replace(/^\s+/u, ""),
  };
}
