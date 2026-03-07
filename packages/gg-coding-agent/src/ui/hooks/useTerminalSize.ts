import { useState, useEffect, useRef, useCallback } from "react";
import { useStdout } from "ink";

/**
 * Returns { columns, rows, resizeKey } and forces a React re-render whenever
 * the terminal is resized.
 *
 * `columns` and `rows` update immediately on every resize event so layout
 * stays responsive while the user drags.
 *
 * `resizeKey` increments once after resize events settle (300ms debounce).
 * Use it as a React `key` on the root content wrapper to force a full
 * remount — this is the only reliable way to make Ink re-render <Static>
 * content that was already printed to scrollback and got corrupted by
 * terminal text reflow.  Debounces 300ms then clears screen+scrollback
 * and remounts.
 */
export function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns ?? 80,
    rows: stdout?.rows ?? 24,
  });
  const [resizeKey, setResizeKey] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const onResize = useCallback(() => {
    if (!stdout) return;

    // Update dimensions immediately for responsive layout
    setSize({ columns: stdout.columns ?? 80, rows: stdout.rows ?? 24 });

    // Debounce the resizeKey bump — only fires after the user stops dragging
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      // Clear the visible screen and re-set the scroll region for the shimmer
      // line. Scrollback is preserved so mouse scroll continues to work.
      const newRows = stdout.rows ?? 24;
      stdout.write(
        "\x1b[r" + // reset scroll region
          "\x1b[2J" + // clear visible screen
          "\x1b[H" + // cursor home
          `\x1b[2;${newRows}r` + // restore scroll region (row 2 to bottom)
          "\x1b[2;1H", // cursor to row 2 for Ink
      );
      setResizeKey((k) => k + 1);
    }, 300);
  }, [stdout]);

  useEffect(() => {
    if (!stdout) return;
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [stdout, onResize]);

  return { ...size, resizeKey };
}
