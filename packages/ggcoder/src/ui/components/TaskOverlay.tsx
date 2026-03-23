import React, { useState, useEffect, useRef, useCallback } from "react";
import { Box, Text, useInput } from "ink";
import { useTheme } from "../theme/theme.js";
import { useTerminalSize } from "../hooks/useTerminalSize.js";
import { useAnimationTick, deriveFrame } from "./AnimationContext.js";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { basename, join } from "node:path";

// ── Types ────────────────────────────────────────────────

interface Task {
  id: string;
  title: string;
  prompt: string;
  /** @deprecated Old field — migrated to title+prompt on load */
  text?: string;
  details?: string;
  status: "pending" | "in-progress" | "done";
  createdAt: string;
}

// ── Persistence (inline — avoids cross-package dep) ──────

const TASKS_BASE = join(homedir(), ".gg-tasks", "projects");

function hashPath(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").slice(0, 16);
}

async function loadTasks(cwd: string): Promise<Task[]> {
  try {
    const data = await readFile(join(TASKS_BASE, hashPath(cwd), "tasks.json"), "utf-8");
    const raw = JSON.parse(data) as Task[];
    // Migrate old tasks that only have `text` (no title/prompt split)
    return raw.map((t) => {
      if (!t.prompt && t.text) {
        return { ...t, title: t.text, prompt: t.text, text: undefined };
      }
      return t;
    });
  } catch {
    return [];
  }
}

async function saveTasks(cwd: string, tasks: Task[]): Promise<void> {
  const dir = join(TASKS_BASE, hashPath(cwd));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "tasks.json"), JSON.stringify(tasks, null, 2) + "\n", "utf-8");

  // Also write meta so gg-tasks standalone can find this project
  const metaPath = join(dir, "meta.json");
  const meta = JSON.stringify({ path: cwd, name: basename(cwd) }, null, 2) + "\n";
  await writeFile(metaPath, meta, "utf-8");
}

// ── Banner ───────────────────────────────────────────────

const TASK_LOGO = [
  " \u2584\u2580\u2580\u2580 \u2584\u2580\u2580\u2580",
  " \u2588 \u2580\u2588 \u2588 \u2580\u2588",
  " \u2580\u2584\u2584\u2580 \u2580\u2584\u2584\u2580",
];

const GRADIENT = [
  "#4ade80",
  "#5ad89a",
  "#6fd2b4",
  "#85ccce",
  "#60a5fa",
  "#85ccce",
  "#6fd2b4",
  "#5ad89a",
];

const GAP = "   ";
const LOGO_WIDTH = 9;
const SIDE_BY_SIDE_MIN = LOGO_WIDTH + GAP.length + 20;

function TaskGradientText({ text }: { text: string }) {
  const chars: React.ReactNode[] = [];
  let colorIdx = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === " ") {
      chars.push(ch);
    } else {
      const color = GRADIENT[colorIdx % GRADIENT.length];
      chars.push(
        <Text key={i} color={color}>
          {ch}
        </Text>,
      );
      colorIdx++;
    }
  }
  return <Text>{chars}</Text>;
}

// ── Component ────────────────────────────────────────────

interface TaskOverlayProps {
  cwd: string;
  onClose: () => void;
  onWorkOnTask: (title: string, prompt: string, id: string) => void;
  onRunAllTasks: () => void;
  agentRunning?: boolean;
}

export function TaskOverlay({
  cwd,
  onClose,
  onWorkOnTask,
  onRunAllTasks,
  agentRunning,
}: TaskOverlayProps) {
  const theme = useTheme();
  const { columns } = useTerminalSize();
  const tick = useAnimationTick();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [mode, setMode] = useState<"normal" | "adding" | "editing" | "editing-prompt">("normal");
  const cursorVisible = mode !== "normal" && deriveFrame(tick, 530, 2) === 0;
  const [editor, setEditor] = useState({ text: "", cursor: 0 });
  const editorRef = useRef({ text: "", cursor: 0 });
  const updateEditor = useCallback((text: string, cursor: number) => {
    editorRef.current = { text, cursor };
    setEditor({ text, cursor });
  }, []);
  const [loaded, setLoaded] = useState(false);
  const [status, setStatus] = useState("");
  const [showPrompt, setShowPrompt] = useState(false);
  const statusTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showStatus = useCallback((msg: string) => {
    setStatus(msg);
    if (statusTimer.current) clearTimeout(statusTimer.current);
    statusTimer.current = setTimeout(() => setStatus(""), 2500);
  }, []);

  // Load tasks on mount and poll for external changes (e.g. from the tasks tool)
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      void loadTasks(cwd).then((t) => {
        if (cancelled) return;
        setTasks((prev) => {
          // Only update if the data actually changed (avoid clobbering user edits mid-flight)
          const prevJson = JSON.stringify(prev);
          const newJson = JSON.stringify(t);
          if (prevJson === newJson) return prev;
          return t;
        });
        setLoaded(true);
      });
    };
    load();
    const interval = setInterval(load, 1000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cwd]);

  // Persist on user-initiated change (debounced to avoid racing with poll)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!loaded) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void saveTasks(cwd, tasks);
    }, 100);
  }, [tasks, cwd, loaded]);

  // Clamp index
  useEffect(() => {
    if (tasks.length === 0) {
      setSelectedIndex(0);
    } else if (selectedIndex >= tasks.length) {
      setSelectedIndex(tasks.length - 1);
    }
  }, [tasks.length, selectedIndex]);

  useInput((input, key) => {
    // ── Input mode ──
    if (mode === "adding" || mode === "editing" || mode === "editing-prompt") {
      const { text: txt, cursor: pos } = editorRef.current;

      if (key.escape) {
        setMode("normal");
        updateEditor("", 0);
        return;
      }
      if (key.return) {
        const text = txt.trim();
        if (text) {
          if (mode === "adding") {
            const newTask: Task = {
              id: randomUUID(),
              title: text,
              prompt: text,
              status: "pending",
              createdAt: new Date().toISOString(),
            };
            setTasks((prev) => [...prev, newTask]);
            setSelectedIndex(tasks.length);
          } else if (mode === "editing") {
            setTasks((prev) =>
              prev.map((t, i) => (i === selectedIndex ? { ...t, title: text } : t)),
            );
          } else {
            setTasks((prev) =>
              prev.map((t, i) => (i === selectedIndex ? { ...t, prompt: text } : t)),
            );
          }
        }
        setMode("normal");
        updateEditor("", 0);
        return;
      }

      // ── Cursor navigation ──

      // Word jump backward: Option+Left (macOS sends ESC b → meta+"b")
      if ((key.meta && input === "b") || (key.leftArrow && (key.ctrl || key.meta))) {
        const before = txt.slice(0, pos);
        const m = before.match(/\S+\s*$/);
        updateEditor(txt, m ? pos - m[0].length : 0);
        return;
      }
      // Word jump forward: Option+Right (macOS sends ESC f → meta+"f")
      if ((key.meta && input === "f") || (key.rightArrow && (key.ctrl || key.meta))) {
        const after = txt.slice(pos);
        const m = after.match(/^\s*\S+/);
        updateEditor(txt, m ? pos + m[0].length : txt.length);
        return;
      }

      // Line jump backward: Up — jump to previous newline
      if (key.upArrow) {
        const before = txt.slice(0, pos);
        const nl = before.lastIndexOf("\n");
        updateEditor(txt, nl === -1 ? 0 : nl);
        return;
      }
      // Line jump forward: Down — jump to next newline
      if (key.downArrow) {
        const nl = txt.indexOf("\n", pos);
        updateEditor(txt, nl === -1 ? txt.length : nl + 1);
        return;
      }

      if (key.leftArrow) {
        updateEditor(txt, Math.max(0, pos - 1));
        return;
      }
      if (key.rightArrow) {
        updateEditor(txt, Math.min(txt.length, pos + 1));
        return;
      }

      // Backspace — delete before cursor
      if (key.backspace || key.delete) {
        if (pos > 0) {
          updateEditor(txt.slice(0, pos - 1) + txt.slice(pos), pos - 1);
        }
        return;
      }

      // Insert character at cursor
      if (input && !key.ctrl && !key.meta) {
        updateEditor(txt.slice(0, pos) + input + txt.slice(pos), pos + input.length);
      }
      return;
    }

    // ── Normal mode ──

    // Close overlay
    if (key.escape) {
      onClose();
      return;
    }

    // Jump to top (g) / bottom (G)
    if (input === "g") {
      setSelectedIndex(0);
      return;
    }
    if (input === "G") {
      setSelectedIndex(tasks.length - 1);
      return;
    }

    if (key.upArrow || input === "k") {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }

    if (key.downArrow || input === "j") {
      setSelectedIndex((i) => Math.min(tasks.length - 1, i + 1));
      return;
    }

    if (input === "a") {
      setMode("adding");
      updateEditor("", 0);
      return;
    }

    if (input === "e" && tasks.length > 0) {
      const task = tasks[selectedIndex];
      if (task) {
        setMode("editing");
        updateEditor(task.title, task.title.length);
      }
      return;
    }

    if (input === "p" && tasks.length > 0) {
      setShowPrompt((prev) => !prev);
      return;
    }

    if (input === "P" && tasks.length > 0) {
      const task = tasks[selectedIndex];
      if (task) {
        setMode("editing-prompt");
        updateEditor(task.prompt, task.prompt.length);
      }
      return;
    }

    if (input === "d" && tasks.length > 0) {
      setTasks((prev) => prev.filter((_, i) => i !== selectedIndex));
      showStatus("Deleted");
      return;
    }

    if (input === "t" && tasks.length > 0) {
      setTasks((prev) =>
        prev.map((t, i) => {
          if (i !== selectedIndex) return t;
          return { ...t, status: t.status === "done" ? "pending" : "done" };
        }),
      );
      return;
    }

    // Work on it — send to agent loop and close overlay
    if (key.return && tasks.length > 0) {
      if (agentRunning) {
        showStatus("Agent is busy — wait for it to finish");
        return;
      }
      const task = tasks[selectedIndex];
      if (task) {
        setTasks((prev) =>
          prev.map((t, i) => (i === selectedIndex ? { ...t, status: "in-progress" } : t)),
        );
        onWorkOnTask(task.title, task.prompt, task.id);
      }
      return;
    }

    // Run all pending tasks sequentially
    if (input === "r") {
      if (agentRunning) {
        showStatus("Agent is busy — wait for it to finish");
        return;
      }
      const hasPending = tasks.some((t) => t.status === "pending");
      if (!hasPending) {
        showStatus("No pending tasks to run");
        return;
      }
      onRunAllTasks();
      return;
    }
  });

  const maxVisible = 15;
  const startIdx = Math.max(0, selectedIndex - maxVisible + 1);
  const visibleTasks = tasks.slice(startIdx, startIdx + maxVisible);

  const home = process.env.HOME ?? "";
  const displayPath = home && cwd.startsWith(home) ? "~" + cwd.slice(home.length) : cwd;
  const doneCount = tasks.filter((t) => t.status === "done").length;
  const pendingCount = tasks.filter((t) => t.status === "pending").length;
  const inProgressCount = tasks.filter((t) => t.status === "in-progress").length;

  return (
    <Box flexDirection="column">
      {/* Banner */}
      {columns < SIDE_BY_SIDE_MIN ? (
        <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
          <TaskGradientText text={TASK_LOGO[0]} />
          <TaskGradientText text={TASK_LOGO[1]} />
          <TaskGradientText text={TASK_LOGO[2]} />
          <Box marginTop={1}>
            <Text color="#4ade80" bold>
              Task Pane
            </Text>
            {agentRunning && <Text color="#fbbf24"> (agent running)</Text>}
          </Box>
          <Text color={theme.textDim} wrap="truncate">
            {displayPath}
          </Text>
          <Text>
            <Text color="#4ade80">{doneCount} done</Text>
            <Text color={theme.textDim}> · </Text>
            <Text color="#fbbf24">{inProgressCount} active</Text>
            <Text color={theme.textDim}> · </Text>
            <Text color={theme.text}>{pendingCount} pending</Text>
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1} marginBottom={1} width={columns}>
          <Box>
            <TaskGradientText text={TASK_LOGO[0]} />
            <Text>{GAP}</Text>
            <Text color="#4ade80" bold>
              Task Pane
            </Text>
            {agentRunning && <Text color="#fbbf24"> (agent running)</Text>}
          </Box>
          <Box>
            <TaskGradientText text={TASK_LOGO[1]} />
            <Text>{GAP}</Text>
            <Text color={theme.textDim} wrap="truncate">
              {displayPath}
            </Text>
          </Box>
          <Box>
            <TaskGradientText text={TASK_LOGO[2]} />
            <Text>{GAP}</Text>
            <Text>
              <Text color="#4ade80">{doneCount} done</Text>
              <Text color={theme.textDim}> · </Text>
              <Text color="#fbbf24">{inProgressCount} active</Text>
              <Text color={theme.textDim}> · </Text>
              <Text color={theme.text}>{pendingCount} pending</Text>
            </Text>
          </Box>
        </Box>
      )}

      {tasks.length === 0 && mode === "normal" && (
        <Text color={theme.textDim}>
          {"  No tasks. Press "}
          <Text color={theme.primary}>a</Text>
          {" to add one."}
        </Text>
      )}

      {visibleTasks.map((task, vi) => {
        const realIdx = startIdx + vi;
        const selected = realIdx === selectedIndex;
        const prefix = selected ? "❯ " : "  ";
        const check = task.status === "done" ? "✓" : task.status === "in-progress" ? "~" : " ";
        const color = selected
          ? theme.primary
          : task.status === "done"
            ? "#4ade80"
            : task.status === "in-progress"
              ? "#fbbf24"
              : theme.text;
        return (
          <Box key={task.id} flexDirection="column">
            <Text color={color} bold={selected}>
              {prefix}[{check}] {task.title}
            </Text>
            {selected && showPrompt && mode !== "editing-prompt" && task.prompt !== task.title && (
              <Text color={theme.textDim} wrap="truncate-end">
                {"    ↳ "}
                {task.prompt}
              </Text>
            )}
          </Box>
        );
      })}

      {mode !== "normal" && (
        <Box flexDirection="column">
          <Text>
            <Text color={theme.primary}>
              {mode === "adding" ? " + " : mode === "editing-prompt" ? " ✎ prompt: " : " ✎ "}
            </Text>
            {editor.text.slice(0, editor.cursor)}
            {(() => {
              const ch = editor.cursor < editor.text.length ? editor.text[editor.cursor] : "";
              const isWhitespace = !ch || ch === " " || ch === "\n" || ch === "\t";
              return isWhitespace ? (
                <Text color={theme.primary} dimColor={!cursorVisible}>
                  █
                </Text>
              ) : (
                <Text color={theme.text} inverse={cursorVisible}>
                  {ch}
                </Text>
              );
            })()}
            {editor.text.slice(editor.cursor + 1)}
          </Text>
        </Box>
      )}

      {status && <Text color="#4ade80">{" " + status}</Text>}

      <Box marginTop={1}>
        {mode === "normal" ? (
          <Text color={theme.textDim}>
            <Text color={theme.primary}>↑↓</Text>
            {" move · "}
            <Text color={theme.primary}>g/G</Text>
            {" jump · ("}
            <Text color={theme.primary}>a</Text>
            {")dd · ("}
            <Text color={theme.primary}>e</Text>
            {")dit · ("}
            <Text color={theme.primary}>p</Text>
            {")rompt · "}
            <Text color={theme.primary}>P</Text>
            {" edit prompt · ("}
            <Text color={theme.primary}>d</Text>
            {")elete · ("}
            <Text color={theme.primary}>t</Text>
            {")oggle · "}
            <Text color={theme.primary}>Enter</Text>
            {" start · ("}
            <Text color={theme.primary}>r</Text>
            {")un all · "}
            <Text color={theme.primary}>ESC</Text>
            {" close"}
          </Text>
        ) : (
          <Text color={theme.textDim}>
            <Text color={theme.primary}>←→</Text>
            {" move · "}
            <Text color={theme.primary}>⌥←→</Text>
            {" word · "}
            <Text color={theme.primary}>↑↓</Text>
            {" line · "}
            <Text color={theme.primary}>Enter</Text>
            {" save · "}
            <Text color={theme.primary}>ESC</Text>
            {" cancel"}
          </Text>
        )}
      </Box>
    </Box>
  );
}
