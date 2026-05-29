import fs from "node:fs";
import path from "node:path";
import type { LanguageId } from "../language-detector.js";
import { languagesToSortedArray } from "../language-detector.js";
import { PACKS } from "./packs.js";

/**
 * Load the style-pack content for a given language. Checks for a per-project
 * override at `<cwd>/.gg/styles/<id>.md` first, falling back to the bundled
 * pack. Returns `null` if neither exists (defensive — should not happen for
 * any LanguageId in PACKS).
 */
export function loadPack(id: LanguageId, cwd: string): string | null {
  const overridePath = path.join(cwd, ".gg", "styles", `${id}.md`);
  try {
    const stat = fs.statSync(overridePath);
    if (stat.isFile()) {
      return fs.readFileSync(overridePath, "utf-8").trim();
    }
  } catch {
    /* no override — fall through to bundled */
  }
  return PACKS[id] ?? null;
}

/**
 * Render the full "Language Style Packs" section that gets spliced into the
 * system prompt. Returns an empty string when the active set is empty so the
 * caller can skip the section entirely.
 *
 * The output is intentionally compact: a single header followed by each pack
 * separated by a blank line. Packs already include their own \`### <Language>\`
 * sub-headers.
 */
export function renderStylePacksSection(active: Set<LanguageId>, cwd: string): string {
  if (active.size === 0) return "";
  const ids = languagesToSortedArray(active);
  const parts: string[] = [];
  for (const id of ids) {
    const pack = loadPack(id, cwd);
    if (pack) parts.push(pack);
  }
  if (parts.length === 0) return "";
  return (
    `## Language Style Packs\n\n` +
    `Conventions for new code in active languages; library names are illustrative.\n\n` +
    `${AGENT_WRITTEN_CODE_PREAMBLE}\n\n` +
    parts.join("\n\n")
  );
}

/**
 * Cross-cutting rules that apply to every language pack. These are agent-native
 * concerns (determinism, observability, no hidden state, output stability) that
 * matter more for code written *by* and *read by* agents than for human-only
 * codebases. Kept terse — every line is a load-bearing constraint, not advice.
 *
 * Lives in the system prompt above the per-language packs so the model reads
 * universal rules first, then specializes per language.
 */
const AGENT_WRITTEN_CODE_PREAMBLE = `### Agent-Written Code (cross-cutting)

Universal rules for agent-written code:

- **Observe boundaries.** Use structured logging at external I/O; include inputs, outcome, and elapsed time. Do not commit debug prints.
- **Deterministic output.** Sort observable map/set iteration; use stable IDs; inject clocks; canonicalize serialized data used for hashes, persistence, comparisons, or diffs.
- **Explicit state.** Avoid module-level mutables, global state containers, and implicit DI. Pass dependencies through signatures or constructors.
- **Locally verifiable.** Prefer small pure functions and shallow composition over deep indirection.
- **Behavioral tests.** Arrange-Act-Assert, no shared mutable fixtures, table-driven where natural, independent test order.
- **Validate at boundaries.** Validate untrusted input as it enters; inside, rely on validated types and use local error values for expected failures.`;
