// Pull version from package.json so banner + boot output stay in sync with
// what npm sees — bumping package.json now updates the TUI automatically.
import pkg from "../package.json" with { type: "json" };

export const VERSION = pkg.version;
export const BRAND = "GG Boss";
export const AUTHOR = "Ken Kai";

export const LOGO_LINES: readonly string[] = [" ▄▀▀▀ ▄▀▀▀", " █ ▀█ █ ▀█", " ▀▄▄▀ ▀▄▄▀"];

export const LOGO_GAP = "   ";

/**
 * GG Boss brand gradient — crimson → fuchsia. Deliberately distinct:
 *   - gg-coder is cool blues/violets
 *   - gg-editor is warm oranges/yellows
 *   - gg-boss is fiery reds/pinks/magentas
 *
 * Palindromic 12-stop sequence so the banner gradient animates smoothly
 * (read forward, then back).
 */
export const GRADIENT: readonly string[] = [
  "#dc2626", // red-600
  "#e11d48", // rose-600
  "#be185d", // pink-700
  "#a21caf", // fuchsia-700
  "#c026d3", // fuchsia-600
  "#d946ef", // fuchsia-500
  "#c026d3", // fuchsia-600 (back)
  "#a21caf", // fuchsia-700 (back)
  "#be185d", // pink-700 (back)
  "#e11d48", // rose-600 (back)
  "#dc2626", // red-600 (back)
  "#b91c1c", // red-700 (slight darker tail)
];

/**
 * Pulse colors for the activity-indicator spinner. Tighter loop than GRADIENT
 * so the spinner pulses crisply through the brand palette.
 */
export const PULSE_COLORS: readonly string[] = [
  "#dc2626", // crimson
  "#e11d48", // rose
  "#be185d", // wine
  "#a21caf", // magenta
  "#c026d3", // fuchsia
  "#a21caf", // back
  "#be185d", // back
  "#e11d48", // back
];

export const COLORS = {
  primary: "#e11d48", // crimson-rose — main brand color
  accent: "#d946ef", // fuchsia — secondary
  text: "#e2e8f0",
  textDim: "#6b7280",
  success: "#4ade80",
  warning: "#fbbf24",
  error: "#f87171",
} as const;

/** Clear the visible screen and reset cursor to home without erasing scrollback. */
export function clearScreen(): void {
  process.stdout.write("\x1b[2J\x1b[H");
}
