import React, { useState, useRef, useEffect, useMemo } from "react";
import { Text, Box, useInput, useStdout } from "ink";
import { useTheme } from "../theme/theme.js";

const MAX_VISIBLE_LINES = 5;
const PROMPT = "❯ ";

interface InputAreaProps {
  onSubmit: (value: string) => void;
  onAbort: () => void;
  disabled?: boolean;
  isActive?: boolean;
  onDownAtEnd?: () => void;
}

// Border (1 each side) + padding (1 each side) = 4 characters of overhead
const BOX_OVERHEAD = 4;

/**
 * Split text into visual lines based on terminal width.
 * Accounts for the prompt prefix, border, and padding.
 */
function wrapLine(text: string, contentWidth: number): string[] {
  if (text.length === 0) return [""];
  const lines: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= contentWidth) {
      lines.push(remaining);
      break;
    }

    let breakAt = remaining.lastIndexOf(" ", contentWidth);
    if (breakAt <= 0) {
      breakAt = contentWidth;
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt);
    } else {
      lines.push(remaining.slice(0, breakAt));
      remaining = remaining.slice(breakAt + 1);
    }
  }

  return lines;
}

function getVisualLines(text: string, columns: number): string[] {
  const contentWidth = columns - PROMPT.length - BOX_OVERHEAD;
  if (contentWidth <= 0) return [text];
  if (text.length === 0) return [""];

  // Split on real newlines first, then wrap each
  const hardLines = text.split("\n");
  const result: string[] = [];
  for (const line of hardLines) {
    result.push(...wrapLine(line, contentWidth));
  }
  return result;
}

export function InputArea({
  onSubmit,
  onAbort,
  disabled = false,
  isActive = true,
  onDownAtEnd,
}: InputAreaProps) {
  const theme = useTheme();
  const [value, setValue] = useState("");
  const historyRef = useRef<string[]>([]);
  const historyIndexRef = useRef(-1);
  const lastEscRef = useRef(0);
  const { stdout } = useStdout();
  const columns = stdout?.columns ?? 80;

  // Border color pulse (when idle/waiting for input)
  const borderPulseColors = useMemo(
    () => [theme.primary, theme.accent, theme.secondary, theme.accent],
    [theme.primary, theme.accent, theme.secondary],
  );
  const [borderFrame, setBorderFrame] = useState(0);
  useEffect(() => {
    if (disabled) return;
    const timer = setInterval(() => {
      setBorderFrame((f) => (f + 1) % borderPulseColors.length);
    }, 800);
    return () => clearInterval(timer);
  }, [disabled, borderPulseColors]);

  // Cursor blink
  const [cursorVisible, setCursorVisible] = useState(true);
  useEffect(() => {
    if (disabled) {
      setCursorVisible(true);
      return;
    }
    const timer = setInterval(() => {
      setCursorVisible((v) => !v);
    }, 530);
    return () => clearInterval(timer);
  }, [disabled]);

  useInput(
    (input, key) => {
      if (disabled) {
        if ((key.ctrl && input === "c") || key.escape) {
          onAbort();
        }
        return;
      }

      if (key.return && key.shift) {
        setValue((v) => v + "\n");
        return;
      }

      if (key.return) {
        const trimmed = value.trim();
        if (trimmed) {
          historyRef.current.push(trimmed);
          historyIndexRef.current = -1;
          onSubmit(trimmed);
          setValue("");
        }
        return;
      }

      if (key.ctrl && input === "c") {
        if (value) {
          setValue("");
        } else {
          onAbort();
        }
        return;
      }

      if (key.ctrl && input === "d") {
        process.exit(0);
      }

      if (key.backspace || key.delete) {
        setValue((v) => v.slice(0, -1));
        return;
      }

      if (key.upArrow) {
        const history = historyRef.current;
        if (history.length === 0) return;
        const newIndex =
          historyIndexRef.current === -1
            ? history.length - 1
            : Math.max(0, historyIndexRef.current - 1);
        historyIndexRef.current = newIndex;
        setValue(history[newIndex]);
        return;
      }

      if (key.downArrow) {
        const history = historyRef.current;
        if (historyIndexRef.current === -1) {
          if (onDownAtEnd) onDownAtEnd();
          return;
        }
        const newIndex = historyIndexRef.current + 1;
        if (newIndex >= history.length) {
          historyIndexRef.current = -1;
          setValue("");
        } else {
          historyIndexRef.current = newIndex;
          setValue(history[newIndex]);
        }
        return;
      }

      if (key.escape) {
        const now = Date.now();
        if (value && now - lastEscRef.current < 400) {
          setValue("");
        }
        lastEscRef.current = now;
        return;
      }

      if (key.tab || key.leftArrow || key.rightArrow) {
        return;
      }

      if (input) {
        setValue((v) => v + input);
      }
    },
    { isActive },
  );

  // Calculate visual lines and cap at MAX_VISIBLE_LINES (scroll to bottom)
  const visualLines = getVisualLines(value, columns);
  const totalLines = visualLines.length;
  const startLine = totalLines > MAX_VISIBLE_LINES ? totalLines - MAX_VISIBLE_LINES : 0;
  const displayLines = visualLines.slice(startLine);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={disabled ? theme.textDim : borderPulseColors[borderFrame]}
      paddingLeft={1}
      paddingRight={1}
    >
      {displayLines.map((line, i) => (
        <Box key={i}>
          {/* Show prompt on first visible line only */}
          <Text color={disabled ? theme.textDim : theme.inputPrompt} bold>
            {i === 0 ? PROMPT : "  "}
          </Text>
          <Text color={theme.text}>
            {line}
            {/* Blinking cursor at end of last line */}
            {i === displayLines.length - 1 && !disabled ? (cursorVisible ? "\u2588" : " ") : ""}
          </Text>
        </Box>
      ))}
    </Box>
  );
}
