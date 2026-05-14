import path from "node:path";
import { z } from "zod";
import type { AgentTool } from "@kenkaiiii/gg-agent";
import { resolvePath, rejectSymlink } from "./path-utils.js";
import {
  fuzzyFindText,
  countOccurrences,
  generateDiff,
  findClosestSnippet,
  findOccurrenceLines,
} from "./edit-diff.js";
import { localOperations, type ToolOperations } from "./operations.js";
import { assertFresh, recordWrite, type ReadTracker } from "./read-tracker.js";

const EditItem = z.object({
  old_text: z.string().describe("The exact text to find and replace"),
  new_text: z.string().describe("The replacement text"),
  replace_all: z
    .boolean()
    .optional()
    .describe(
      "Replace every occurrence of old_text instead of requiring a unique match. " +
        "Use for renames or repeated tokens. Defaults to false.",
    ),
});

// Some models (Opus 4.6, GLM-5.1) occasionally send `edits` as a JSON string
// instead of a real array, which trips Zod and makes the model fall back to
// sed/python. Coerce the string back into an array before validation.
const coerceStringifiedEdits = (v: unknown): unknown => {
  if (typeof v !== "string") return v;
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed : v;
  } catch {
    return v;
  }
};

const EditParams = z.object({
  file_path: z.string().describe("The file path to edit"),
  edits: z
    .preprocess(coerceStringifiedEdits, z.array(EditItem).min(1))
    .describe(
      "One or more edits applied in order. Each edit operates on the result of the previous one. " +
        "Every old_text must uniquely match exactly one location in the file at the time it is applied.",
    ),
});

export function createEditTool(
  cwd: string,
  readFiles?: ReadTracker,
  ops: ToolOperations = localOperations,
  planModeRef?: { current: boolean },
): AgentTool<typeof EditParams> {
  return {
    name: "edit",
    description:
      "Replace one or more text strings in a file. The file must be read first before editing. " +
      "Pass `edits` as an array of { old_text, new_text, replace_all? } items; edits are applied " +
      "sequentially so each subsequent match runs against the result of the prior edits. " +
      "Each old_text must uniquely match exactly one location when applied — if it matches more, " +
      "either include surrounding context to make the match unique or set replace_all: true to " +
      "swap every occurrence (useful for renames). Returns a unified diff of the combined change.",
    parameters: EditParams,
    async execute({ file_path, edits }) {
      if (planModeRef?.current) {
        return "Error: edit is restricted in plan mode. Use read-only tools to explore the codebase, then write your plan to .gg/plans/.";
      }
      const resolved = resolvePath(cwd, file_path);
      await rejectSymlink(resolved);

      await assertFresh(readFiles, resolved, ops);

      const original = await ops.readFile(resolved);
      const hasCRLF = original.includes("\r\n");
      const originalNormalized = hasCRLF ? original.replace(/\r\n/g, "\n") : original;

      let working = originalNormalized;
      const fileName = path.basename(resolved);
      const errors: string[] = [];

      for (let i = 0; i < edits.length; i++) {
        const { old_text, new_text, replace_all } = edits[i];
        const normalizedOld = hasCRLF ? old_text.replace(/\r\n/g, "\n") : old_text;
        const normalizedNew = hasCRLF ? new_text.replace(/\r\n/g, "\n") : new_text;

        const label = edits.length > 1 ? ` (edit ${i + 1}/${edits.length})` : "";

        // replace_all path: if there is at least one literal match, swap them
        // all at once and skip the uniqueness check. Falls through to the
        // normal not-found error when no exact matches exist (so the model
        // gets the closest-snippet hint instead of a silent no-op).
        if (replace_all && normalizedOld.length > 0 && working.includes(normalizedOld)) {
          working = working.split(normalizedOld).join(normalizedNew);
          continue;
        }

        const occurrences = countOccurrences(working, normalizedOld);
        if (occurrences === 0) {
          const hint = findClosestSnippet(working, normalizedOld);
          const hintLine = hint ? `\nClosest match in file:\n${hint}` : "";
          errors.push(
            `old_text not found in ${fileName}${label}. ` +
              "Text must match verbatim — do not paraphrase. Re-read the file if unsure." +
              hintLine,
          );
          continue;
        }
        if (occurrences > 1) {
          const matches = findOccurrenceLines(working, normalizedOld);
          const matchLines = matches.map((m) => `  line ${m.line}: ${m.preview}`).join("\n");
          const more =
            occurrences > matches.length ? `\n  …and ${occurrences - matches.length} more` : "";
          errors.push(
            `old_text found ${occurrences} times in ${fileName}${label}. ` +
              "Include more surrounding context to make the match unique, " +
              "or set replace_all: true to swap every occurrence.\n" +
              "Matches at:\n" +
              matchLines +
              more,
          );
          continue;
        }

        const match = fuzzyFindText(working, normalizedOld);
        if (!match.found) {
          errors.push(`old_text not found in ${fileName}${label}.`);
          continue;
        }

        working =
          working.slice(0, match.index) +
          normalizedNew +
          working.slice(match.index + match.matchLength);
      }

      if (errors.length > 0) {
        const header =
          errors.length === 1
            ? errors[0]
            : `${errors.length} of ${edits.length} edits failed; no changes written.\n\n` +
              errors.map((e, i) => `[${i + 1}] ${e}`).join("\n\n");
        throw new Error(header);
      }

      const finalContent = hasCRLF ? working.replace(/\n/g, "\r\n") : working;
      await ops.writeFile(resolved, finalContent);
      await recordWrite(readFiles, resolved, finalContent, ops);

      const relPath = path.relative(cwd, resolved);
      const diff = generateDiff(originalNormalized, working, relPath);
      const summary =
        edits.length > 1
          ? `Successfully applied ${edits.length} edits to ${relPath}.`
          : `Successfully replaced text in ${relPath}.`;
      return {
        content: summary,
        details: { diff },
      };
    },
  };
}
