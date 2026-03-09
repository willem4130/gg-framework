import { type MarkedExtension, marked } from "marked";
import { markedTerminal } from "marked-terminal";
import chalk from "chalk";

// Force chalk to output ANSI codes — Ink manages the TTY so
// chalk's auto-detection may incorrectly disable colors.
chalk.level = 3;

marked.use(
  markedTerminal({
    code: chalk.yellow,
    codespan: chalk.yellow,
    strong: chalk.bold,
    em: chalk.italic,
    heading: chalk.bold.cyan,
    link: chalk.underline.blueBright,
    href: chalk.dim,
    tab: 2,
  }) as MarkedExtension,
);

/**
 * Render markdown string to ANSI-formatted terminal text.
 * Trims trailing whitespace/newlines.
 */
export function renderMarkdown(text: string): string {
  const rendered = marked.parse(text, { async: false }) as string;
  return rendered.trimEnd();
}
