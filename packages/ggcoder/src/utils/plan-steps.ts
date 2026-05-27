/**
 * Plan step extraction and [DONE:n] progress tracking.
 *
 * The agent outputs [DONE:n] markers in its text to signal that step n
 * of the approved plan has been completed.  The UI parses these markers
 * and renders a progress widget.
 */

export interface PlanStep {
  /** 1-based step number */
  step: number;
  /** Short description extracted from the plan */
  text: string;
  completed: boolean;
}

/**
 * Extract numbered steps from a plan markdown string.
 *
 * Prefers steps from a canonical `## Steps` section if present.
 * Falls back to scanning the entire document for top-level numbered items.
 *
 * Looks for lines like:
 *   1. Do something
 *   2) Do something else
 *   3. **Bold step**
 */
export function extractPlanSteps(planContent: string): PlanStep[] {
  // Try to find a canonical ## Steps section first
  const stepsSection = extractStepsSection(planContent);
  const source = stepsSection ?? planContent;

  const steps: PlanStep[] = [];
  // Only match non-indented numbered items (0-2 spaces max) to skip sub-items
  const pattern = /^(\d+)[.)]\s+\*{0,2}([^*\n]+)/gm;

  for (const match of source.matchAll(pattern)) {
    let text = match[2]
      .trim()
      .replace(/\*{1,2}$/, "")
      .trim();
    // Skip very short items, code snippets, or sub-items
    if (text.length <= 5 || text.startsWith("`") || text.startsWith("/") || text.startsWith("-")) {
      continue;
    }
    // Truncate long step descriptions
    if (text.length > 80) {
      text = text.slice(0, 77) + "...";
    }
    steps.push({ step: steps.length + 1, text, completed: false });
  }

  return steps;
}

/**
 * Extract the content under a `## Steps` heading, stopping at the next
 * heading of equal or higher level (or end of document).
 */
function extractStepsSection(planContent: string): string | undefined {
  const match = planContent.match(/^##\s+Steps\s*$/m);
  if (!match || match.index === undefined) return undefined;

  const start = match.index + match[0].length;
  // Find next heading of level 1-2 (or end of string)
  const rest = planContent.slice(start);
  const nextHeading = rest.match(/^#{1,2}\s/m);
  const sectionContent = nextHeading?.index !== undefined ? rest.slice(0, nextHeading.index) : rest;
  return sectionContent;
}

/**
 * Strip [DONE:n] markers from text for display purposes.
 * These markers are machine-readable signals for the progress widget,
 * not meant to be shown to the user.
 */
export function stripDoneMarkers(text: string): string {
  return text
    .replace(/\s*\[DONE:\d+\]\s*/gi, " ")
    .replace(/  +/g, " ")
    .replace(/^ /, "")
    .replace(/ $/, "");
}

/**
 * Segment of an assistant turn's text after [DONE:N] markers are split
 * out for inline rendering. Used by the chat to render "✓ Step N: <desc>"
 * markers in the same temporal order the agent emitted them, instead of
 * stripping markers to invisible whitespace.
 */
export type DisplaySegment =
  | { kind: "text"; text: string }
  | { kind: "done"; stepNum: number; description: string };

/**
 * Split text on [DONE:N] markers, returning an array of segments. Empty/
 * whitespace-only text segments are dropped. Step description is looked
 * up in `steps` (falls back to "" so the renderer can show just the step
 * number when the plan is no longer in scope, e.g. after onComplete
 * cleared planSteps).
 */
export function segmentDisplayText(text: string, steps: PlanStep[]): DisplaySegment[] {
  const segments: DisplaySegment[] = [];
  const pattern = /\[DONE:(\d+)\]/gi;
  let lastIdx = 0;
  for (const match of text.matchAll(pattern)) {
    const matchIdx = match.index ?? 0;
    const before = text.slice(lastIdx, matchIdx);
    if (before.trim()) {
      segments.push({ kind: "text", text: before });
    }
    const stepNum = parseInt(match[1], 10);
    const step = steps.find((s) => s.step === stepNum);
    segments.push({
      kind: "done",
      stepNum,
      description: step?.text ?? "",
    });
    lastIdx = matchIdx + match[0].length;
  }
  const after = text.slice(lastIdx);
  if (after.trim()) {
    segments.push({ kind: "text", text: after });
  }
  return segments;
}

/**
 * Scan text for [DONE:n] markers and return the set of completed step numbers.
 */
export function findCompletedMarkers(text: string): Set<number> {
  const completed = new Set<number>();
  const pattern = /\[DONE:(\d+)\]/gi;
  for (const match of text.matchAll(pattern)) {
    completed.add(parseInt(match[1], 10));
  }
  return completed;
}

/**
 * Apply completed markers to a steps array (immutable — returns new array).
 */
export function markStepsCompleted(steps: PlanStep[], completed: Set<number>): PlanStep[] {
  let changed = false;
  const result = steps.map((s) => {
    if (completed.has(s.step) && !s.completed) {
      changed = true;
      return { ...s, completed: true };
    }
    return s;
  });
  return changed ? result : steps;
}
