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
    `Conventions for new code in each active language. Library names below are ` +
    `illustrative — use whatever the project already imports.\n\n` +
    parts.join("\n\n")
  );
}
