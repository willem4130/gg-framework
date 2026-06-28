import { existsSync } from "node:fs";
import path from "node:path";
import type { Message } from "@kenkaiiii/gg-ai";

export interface IdealReviewStats {
  changedLines: number;
  toolCalls: number;
  toolFailures: number;
  turns: number;
  writeCalls: number;
  editCalls: number;
  bashCalls: number;
}

export interface IdealReviewDecision {
  shouldReview: boolean;
  score: number;
  reasons: string[];
}

export const IDEAL_REVIEW_PROMPT =
  "Ideal? Review the actual work against the user's request before the final response. " +
  "Is it simple, focused, correct, and aligned? Did you over-edit, leave TODOs, miss an obvious " +
  "case the request called for, or introduce risk? Judge this by reading the code you changed \u2014 " +
  "do NOT run builds, typechecks, linters, or test suites now; that happens at commit time via " +
  "/commit. If anything is wrong, fix it now. If everything is good, respond with the final " +
  "answer only; do not mention this ideal review unless it changed the work.";

const RISKY_TOOL_NAMES = new Set(["bash", "write", "edit"]);

export function evaluateIdealReview(stats: IdealReviewStats): IdealReviewDecision {
  const reasons: string[] = [];
  let score = 0;

  if (stats.changedLines >= 120) {
    score += 2;
    reasons.push(`${stats.changedLines} changed lines`);
  } else if (stats.changedLines >= 60) {
    score += 1;
    reasons.push(`${stats.changedLines} changed lines`);
  }

  if (stats.toolCalls >= 8) {
    score += 1;
    reasons.push(`${stats.toolCalls} tool calls`);
  }

  if (stats.writeCalls + stats.editCalls >= 4) {
    score += 2;
    reasons.push(`${stats.writeCalls + stats.editCalls} file mutation calls`);
  } else if (stats.writeCalls + stats.editCalls >= 2) {
    score += 1;
    reasons.push(`${stats.writeCalls + stats.editCalls} file mutation calls`);
  }

  if (stats.bashCalls > 0 && stats.writeCalls + stats.editCalls > 0) {
    score += 1;
    reasons.push("shell command plus file mutation");
  }

  if (stats.toolFailures > 0) {
    score += 2;
    reasons.push(`${stats.toolFailures} failed tool calls`);
  }

  if (stats.turns >= 6) {
    score += 1;
    reasons.push(`${stats.turns} agent turns`);
  }

  return { shouldReview: score >= 4, score, reasons };
}

export function buildIdealReviewMessage(
  reasons: readonly string[],
  driftedFiles: readonly string[] = [],
): Message {
  const reasonText = reasons.length > 0 ? ` Triggered because: ${reasons.join(", ")}.` : "";
  const driftText =
    driftedFiles.length > 0
      ? ` Also: you changed ${driftedFiles.join(", ")} but the matching test file was not updated. ` +
        `Update the test to match the new behavior, or state plainly why the existing test is still valid. ` +
        `Edit the test only \u2014 do not run the suite now.`
      : "";
  return {
    role: "user",
    content: `${IDEAL_REVIEW_PROMPT}${reasonText}${driftText}`,
  };
}

// A test file: foo.test.ts, foo.spec.tsx, foo.test.mjs, etc.
const TEST_FILE_RE = /\.(test|spec)\.[cm]?[jt]sx?$/;
// A source code file we can pair with a sibling test.
const CODE_EXT_RE = /\.([cm]?[jt]sx?)$/;

/**
 * Test-drift detector \u2014 the one stranding signal a typechecker is blind to.
 * Given the set of files the run mutated, return the source files whose sibling
 * test exists on disk but was NOT touched this run (a green-but-stale test).
 *
 * Pure structural check: no sibling test on disk \u2192 no signal, so it stays
 * silent on projects (or files) without co-located tests. `fileExists` is
 * injectable for tests; paths are resolved against `cwd` so relative tool paths
 * and absolute ones compare consistently.
 */
export function detectTestDrift(
  touchedFiles: Iterable<string>,
  cwd: string,
  fileExists: (p: string) => boolean = existsSync,
): string[] {
  const resolved = new Map<string, string>(); // absolute -> original (as the model wrote it)
  for (const f of touchedFiles) resolved.set(path.resolve(cwd, f), f);
  const touchedSet = new Set(resolved.keys());

  const drifted: string[] = [];
  for (const [abs, original] of resolved) {
    const base = path.basename(abs);
    if (TEST_FILE_RE.test(base)) continue; // the file itself is a test
    const match = base.match(CODE_EXT_RE);
    if (!match) continue; // not a code file
    const ext = match[1];
    const dir = path.dirname(abs);
    const stem = base.slice(0, base.length - ext.length - 1);
    // Tests commonly drop the JSX `x` (Button.tsx -> Button.test.ts), so try the
    // source ext and its non-JSX variant against both .test and .spec.
    const testExts = ext.endsWith("x") ? [ext, ext.slice(0, -1)] : [ext];
    const candidates = testExts
      .flatMap((e) => [`${stem}.test.${e}`, `${stem}.spec.${e}`])
      .map((c) => path.join(dir, c));
    if (candidates.some((c) => touchedSet.has(c))) continue; // sibling test was updated
    if (candidates.some((c) => fileExists(c))) drifted.push(original);
  }
  return drifted;
}

export function shouldCountAsRiskyTool(toolName: string): boolean {
  return RISKY_TOOL_NAMES.has(toolName);
}
