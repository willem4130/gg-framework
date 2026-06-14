/**
 * gg-app sidecar — bridges the full ggcoder AgentSession to the Tauri webview
 * over plain HTTP + Server-Sent Events (zero browser-side dependencies).
 *
 * Transport:
 *   GET  /state    → { provider, model, cwd, ready }
 *   GET  /events   → text/event-stream of forwarded agent + session events
 *   POST /prompt   → { text } ; runs AgentSession.prompt(text)
 *   POST /cancel   → aborts the in-flight run
 *
 * The agent spine (gg-ai → gg-agent → gg-core) and every tool are reused
 * unchanged via AgentSession — this file is only a network seam.
 */
import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Provider, ThinkingLevel } from "@kenkaiiii/gg-ai";
import { AgentSession } from "./core/agent-session.js";
import { AuthStorage } from "./core/auth-storage.js";
import { MOONSHOT_OAUTH_KEY } from "@kenkaiiii/gg-core";
import { loginAnthropic } from "./core/oauth/anthropic.js";
import { loginOpenAI } from "./core/oauth/openai.js";
import { loginGemini } from "./core/oauth/gemini.js";
import { loginKimi } from "./core/oauth/kimi.js";
import type { OAuthCredentials, OAuthLoginCallbacks } from "./core/oauth/types.js";
import { AUTH_PROVIDERS, type AuthProviderMeta } from "./core/auth-providers.js";
import { ensureAppDirs, loadSavedSettings } from "./config.js";
import {
  getDefaultModel,
  getModel,
  getMaxThinkingLevel,
  getContextWindow,
  MODELS,
} from "./core/model-registry.js";
import { getGitBranch } from "./utils/git.js";
import {
  getNextThinkingLevel,
  getSupportedThinkingLevels,
  isThinkingLevelSupported,
} from "./core/thinking-level.js";
import { PROMPT_COMMANDS } from "./core/prompt-commands.js";
import { loadCustomCommands } from "./core/custom-commands.js";
import { discoverProjects, listRecentSessions } from "./core/project-discovery.js";
import { initLogger, log } from "./core/logger.js";

const ALL_PROVIDERS: Provider[] = [
  "anthropic",
  "xiaomi",
  "openai",
  "gemini",
  "glm",
  "moonshot",
  "minimax",
  "deepseek",
  "openrouter",
];

interface ResolvedStart {
  provider: Provider;
  model: string;
}

// ── gg-app settings (~/.gg/gg-app.json) ────────────────────
// App-specific, separate from the shared ggcoder settings file so the desktop
// app's preferences never collide with the CLI's.

interface AppSettings {
  /** Folder new projects are created inside. Defaults to ~/gg-projects. */
  projectsRoot: string;
}

function appSettingsFile(): string {
  return path.join(os.homedir(), ".gg", "gg-app.json");
}

function defaultProjectsRoot(): string {
  return path.join(os.homedir(), "gg-projects");
}

async function loadAppSettings(): Promise<AppSettings> {
  try {
    const raw = JSON.parse(await fs.readFile(appSettingsFile(), "utf-8")) as Partial<AppSettings>;
    return {
      projectsRoot:
        typeof raw.projectsRoot === "string" && raw.projectsRoot.trim()
          ? raw.projectsRoot
          : defaultProjectsRoot(),
    };
  } catch {
    return { projectsRoot: defaultProjectsRoot() };
  }
}

async function saveAppSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(path.dirname(appSettingsFile()), { recursive: true });
  await fs.writeFile(appSettingsFile(), JSON.stringify(settings, null, 2), "utf-8");
}

/** Validate a project folder name: lowercase letters, digits, dashes only. */
function isValidProjectName(name: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name);
}

// ── Chat attachments (images / videos / files dropped into the input) ──────
// The webview sends base64 payloads; we persist each under .gg/uploads/ so the
// agent's tools can open files, then hand media to the model as native blocks.
interface AppAttachment {
  kind: "image" | "video" | "file";
  name: string;
  mediaType: string;
  /** base64 (no data: prefix). */
  data: string;
}

interface PreparedAttachment extends AppAttachment {
  path?: string;
}

async function prepareAttachments(
  cwd: string,
  attachments: AppAttachment[],
): Promise<PreparedAttachment[]> {
  const dir = path.join(cwd, ".gg", "uploads");
  await fs.mkdir(dir, { recursive: true }).catch(() => {});
  const out: PreparedAttachment[] = [];
  for (const a of attachments) {
    // Sanitize the filename and prefix with a short timestamp to avoid clobber.
    const safe = a.name.replace(/[^\w.-]+/g, "_").slice(-80) || "file";
    const fileName = `${Date.now().toString(36)}-${safe}`;
    const filePath = path.join(dir, fileName);
    try {
      await fs.writeFile(filePath, Buffer.from(a.data, "base64"));
      out.push({ ...a, path: filePath });
    } catch {
      out.push({ ...a });
    }
  }
  return out;
}

/**
 * Detect whether a restored user message is actually an injected self-correction
 * hook prompt, by its distinctive opening phrase. Returns the hook kind so the
 * webview can render the short notice line instead of the full prompt body.
 */
function detectHookKind(text: string): "ideal" | "loop_break" | "regrounding" | null {
  const t = text.trimStart();
  if (t.startsWith("Ideal? Review the actual work")) return "ideal";
  if (t.startsWith("Stuck? You've repeated essentially")) return "loop_break";
  if (t.startsWith("Re-ground. The conversation was just compacted")) return "regrounding";
  return null;
}

/**
 * Pick a provider/model the user is actually logged into, preferring the saved
 * defaults. Mirrors the CLI's resolveActiveProvider without exporting internals.
 */
async function resolveStart(
  auth: AuthStorage,
  preferred: Provider,
  savedModel: string | undefined,
): Promise<ResolvedStart> {
  const loggedIn: Provider[] = [];
  for (const p of ALL_PROVIDERS) {
    if (await auth.hasProviderAuth(p)) loggedIn.push(p);
  }
  if (loggedIn.length === 0) {
    throw new Error('Not logged in to any provider. Run "ggcoder login" to authenticate.');
  }
  if (loggedIn.includes(preferred)) {
    const saved = savedModel ? getModel(savedModel) : undefined;
    return {
      provider: preferred,
      model: saved?.provider === preferred ? saved.id : getDefaultModel(preferred).id,
    };
  }
  const provider = loggedIn[0]!;
  return { provider, model: getDefaultModel(provider).id };
}

interface SseClient {
  id: number;
  res: http.ServerResponse;
}

async function main(): Promise<void> {
  const cwd = process.env.GG_APP_CWD ?? process.cwd();
  // Default to an ephemeral port (0) so concurrent/orphaned instances never
  // collide on a fixed port. The actual port is reported via the
  // GG_APP_LISTENING handshake and consumed by the shell.
  const port = Number(process.env.GG_APP_PORT ?? 0);
  const host = "127.0.0.1";

  const paths = await ensureAppDirs();
  // Own log file so the app sidecar never clobbers the interactive CLI's
  // ~/.gg/debug.log (initLogger truncates on each start).
  const sidecarLog = path.join(paths.agentDir, "gg-app-sidecar.log");
  initLogger(sidecarLog);

  const auth = new AuthStorage(paths.authFile);
  await auth.load();

  const saved = loadSavedSettings(paths.settingsFile);
  const preferred: Provider = saved.provider ?? "anthropic";
  const { provider, model } = await resolveStart(auth, preferred, saved.model);

  const thinkingLevel: ThinkingLevel | undefined = saved.thinkingEnabled
    ? (saved.thinkingLevel ?? getMaxThinkingLevel(model))
    : undefined;

  // ── SSE fan-out (declared before the session so plan callbacks can use it) ─
  const clients = new Set<SseClient>();
  let clientSeq = 0;

  function broadcast(type: string, data: unknown): void {
    const frame = `data: ${JSON.stringify({ type, data })}\n\n`;
    for (const c of clients) c.res.write(frame);
  }

  // When the shell respawns this sidecar for a chosen project, it passes the
  // session file path to resume; empty/unset starts a fresh session.
  const resumeSessionPath = process.env.GG_APP_SESSION_ID || undefined;

  let abort = new AbortController();
  const session = new AgentSession({
    provider,
    model,
    cwd,
    thinkingLevel,
    sessionId: resumeSessionPath,
    signal: abort.signal,
    // Plan mode: the agent's enter_plan/exit_plan tools drive these. We flip
    // session plan state (rebuilds the system prompt + enforces read-only
    // tools) and surface the transition to the webview.
    onEnterPlan: async (reason) => {
      await session.setPlanMode(true);
      broadcast("plan_enter", { reason: reason ?? "" });
    },
    onExitPlan: async (planPath: string) => {
      await session.setPlanMode(false);
      // Surface the plan's path + markdown so the webview can show the review
      // modal (Accept / Feedback / Reject). Best-effort content read.
      let content: string;
      try {
        content = await fs.readFile(planPath, "utf-8");
      } catch {
        content = "";
      }
      broadcast("plan_exit", { planPath, content });
      return "Plan submitted for user review. Wait for the user to approve, reject, or dismiss it before implementing.";
    },
  });
  await session.initialize();
  log("INFO", "app-sidecar", "session ready", { provider, model, cwd });

  // Footer extras (context window, git branch, background tasks). The git
  // branch is resolved once at startup and refreshed lazily; the context
  // window follows the active model.
  let gitBranch: string | null = await getGitBranch(cwd).catch(() => null);
  function currentContextWindow(): number {
    const st = session.getState();
    return getContextWindow(st.model, { provider: st.provider });
  }
  // Shared shape merged into /state + the SSE `ready` frame so the footer can
  // render context %, branch, and tasks immediately on connect.
  function footerExtras(): {
    contextWindow: number;
    gitBranch: string | null;
    tasks: ReturnType<typeof session.listBackgroundProcesses>;
  } {
    return {
      contextWindow: currentContextWindow(),
      gitBranch,
      tasks: session.listBackgroundProcesses(),
    };
  }

  // Forward every relevant bus event to the webview.
  session.eventBus.on("text_delta", (d) => broadcast("text_delta", d));
  session.eventBus.on("thinking_delta", (d) => broadcast("thinking_delta", d));
  session.eventBus.on("tool_call_start", (d) => broadcast("tool_call_start", d));
  session.eventBus.on("tool_call_update", (d) => broadcast("tool_call_update", d));
  session.eventBus.on("tool_call_end", (d) => broadcast("tool_call_end", d));
  session.eventBus.on("turn_end", (d) => broadcast("turn_end", d));
  session.eventBus.on("agent_done", (d) => broadcast("agent_done", d));
  session.eventBus.on("error", (d) =>
    broadcast("error", { message: d.error instanceof Error ? d.error.message : String(d.error) }),
  );
  session.eventBus.on("model_change", (d) => broadcast("model_change", d));
  session.eventBus.on("hook", (d) => broadcast("hook", d));
  session.eventBus.on("compaction_start", (d) => broadcast("compaction_start", d));
  session.eventBus.on("compaction_end", (d) => broadcast("compaction_end", d));

  let running = false;
  let titleGenerated = false;

  // Resumed session: if it already has a conversation, generate its title now so
  // the title bar shows it immediately on load (not just after the next prompt).
  {
    const hasHistory = session
      .getMessages()
      .some((m) => m.role === "user" || m.role === "assistant");
    if (hasHistory) {
      titleGenerated = true;
      void session.generateTitle().then((title) => {
        if (title) broadcast("session_title", { title });
      });
    }
  }

  // ── Provider auth (login) bridge ───────────────────────────
  // OAuth login functions are interactive (open a URL, sometimes prompt for a
  // pasted code). We run one at a time and surface every step over SSE so the
  // webview can open the URL and collect a code via a modal. `pendingCode`
  // resolves when the webview POSTs /auth/oauth/code.
  let oauthInFlight = false;
  let pendingCode: ((code: string) => void) | null = null;

  function authCallbacks(): OAuthLoginCallbacks {
    return {
      onOpenUrl: (url) => broadcast("auth_url", { url }),
      onStatus: (message) => broadcast("auth_status", { message }),
      onPromptCode: (message) =>
        new Promise<string>((resolve) => {
          pendingCode = resolve;
          broadcast("auth_need_code", { message });
        }),
    };
  }

  async function authStatusPayload(): Promise<{
    providers: (AuthProviderMeta & { connected: boolean })[];
  }> {
    const providers = await Promise.all(
      AUTH_PROVIDERS.map(async (p) => ({
        ...p,
        connected: await auth.hasProviderAuth(p.value),
      })),
    );
    return { providers };
  }

  // Background tasks have no event source (the bash tool just spawns them), so
  // poll the process manager and broadcast only when the snapshot changes. This
  // keeps the webview footer live without a busy render loop. Adaptive cadence:
  // tasks can only change while a run is active (the bash tool spawns them), so
  // poll fast (1500ms) while running or while tasks exist, and back off to
  // 5000ms when fully idle — fewer wakeups per idle window.
  let lastTasksJson = "[]";
  let tasksPoll: NodeJS.Timeout | undefined;
  let tasksPollStopped = false;
  const scheduleTasksPoll = (delay: number): void => {
    if (tasksPollStopped) return;
    tasksPoll = setTimeout(() => {
      const tasks = session.listBackgroundProcesses();
      const next = JSON.stringify(tasks);
      if (next !== lastTasksJson) {
        lastTasksJson = next;
        broadcast("tasks", { tasks });
      }
      const active = running || tasks.length > 0;
      scheduleTasksPoll(active ? 1500 : 5000);
    }, delay);
    tasksPoll.unref?.();
  };
  scheduleTasksPoll(1500);

  function readBody(req: http.IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c as Buffer));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
      req.on("error", reject);
    });
  }

  function json(res: http.ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json",
      "access-control-allow-origin": "*",
    });
    res.end(payload);
  }

  const server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    const method = req.method ?? "GET";

    // CORS preflight — the webview origin differs from 127.0.0.1.
    if (method === "OPTIONS") {
      res.writeHead(204, {
        "access-control-allow-origin": "*",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "content-type",
      });
      res.end();
      return;
    }

    if (method === "GET" && url === "/state") {
      const st = session.getState();
      json(res, 200, {
        ...st,
        running,
        ready: true,
        thinkingLevel: session.getThinkingLevel() ?? null,
        supportedThinkingLevels: getSupportedThinkingLevels(st.provider, st.model),
        ...footerExtras(),
      });
      return;
    }

    if (method === "GET" && url === "/events") {
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
        "access-control-allow-origin": "*",
      });
      res.write(`retry: 1000\n\n`);
      const client: SseClient = { id: ++clientSeq, res };
      clients.add(client);
      const st = session.getState();
      res.write(
        `data: ${JSON.stringify({
          type: "ready",
          data: {
            ...st,
            running,
            thinkingLevel: session.getThinkingLevel() ?? null,
            supportedThinkingLevels: getSupportedThinkingLevels(st.provider, st.model),
            ...footerExtras(),
          },
        })}\n\n`,
      );
      const keepAlive = setInterval(() => res.write(`: ping\n\n`), 15000);
      req.on("close", () => {
        clearInterval(keepAlive);
        clients.delete(client);
      });
      return;
    }

    if (method === "GET" && url === "/settings") {
      // `configured` is true only when the user explicitly saved a projects root
      // (the gg-app.json file exists with a value) — not when we fall back to the
      // default. The home screen gates "Your Projects" on this.
      void (async () => {
        const s = await loadAppSettings();
        let configured: boolean;
        try {
          const raw = JSON.parse(await fs.readFile(appSettingsFile(), "utf-8")) as {
            projectsRoot?: string;
          };
          configured = typeof raw.projectsRoot === "string" && raw.projectsRoot.trim().length > 0;
        } catch {
          configured = false;
        }
        json(res, 200, { ...s, configured });
      })();
      return;
    }

    if (method === "POST" && url === "/settings") {
      void readBody(req).then(async (raw) => {
        let projectsRoot: string;
        try {
          projectsRoot = (JSON.parse(raw) as { projectsRoot?: string }).projectsRoot ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (!projectsRoot.trim()) {
          json(res, 400, { error: "projectsRoot is required" });
          return;
        }
        await saveAppSettings({ projectsRoot });
        json(res, 200, { projectsRoot });
      });
      return;
    }

    if (method === "POST" && url === "/create-project") {
      void readBody(req).then(async (raw) => {
        let name: string;
        try {
          name = (JSON.parse(raw) as { name?: string }).name ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        name = name.trim();
        if (!isValidProjectName(name)) {
          json(res, 400, {
            error: "Project name must be lowercase letters, digits, and dashes (e.g. my-project).",
          });
          return;
        }
        const { projectsRoot } = await loadAppSettings();
        const dir = path.join(projectsRoot, name);
        try {
          // Refuse to clobber an existing directory.
          const exists = await fs
            .stat(dir)
            .then(() => true)
            .catch(() => false);
          if (exists) {
            json(res, 409, { error: `A folder named "${name}" already exists.` });
            return;
          }
          await fs.mkdir(dir, { recursive: true });
          json(res, 200, { path: dir });
        } catch (err) {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      return;
    }

    if (method === "GET" && url === "/projects") {
      // Scan ggcoder + Claude Code + Codex session stores for known projects.
      void discoverProjects()
        .then((projects) => json(res, 200, { projects }))
        .catch((err) => {
          log("ERROR", "app-sidecar", "discoverProjects failed", {
            message: err instanceof Error ? err.message : String(err),
          });
          json(res, 200, { projects: [] });
        });
      return;
    }

    if (method === "GET" && url.startsWith("/sessions")) {
      const target = new URL(url, `http://${host}`).searchParams.get("cwd");
      if (!target) {
        json(res, 400, { error: "missing cwd query param" });
        return;
      }
      void listRecentSessions(target, 5)
        .then((sessions) => json(res, 200, { sessions }))
        .catch(() => json(res, 200, { sessions: [] }));
      return;
    }

    if (method === "GET" && url === "/history") {
      // Flatten the resumed conversation into the webview's transcript shape:
      // user + assistant TEXT only (tools live in the live panel, never the
      // transcript; system + tool-result messages are omitted). Self-correction
      // hook prompts (injected as user messages) are tagged with their `hook`
      // kind so the webview renders the short "Hook engaged" line, not the raw
      // prompt body — matching how they appear live.
      const history = session
        .getMessages()
        .filter((m) => m.role === "user" || m.role === "assistant")
        .map((m) => {
          // `m.content` is a union of differently-typed arrays (user vs
          // assistant parts), so a type-predicate filter won't narrow cleanly.
          // A structural `"text" in c` check extracts text from any text-bearing
          // part regardless of the surrounding union.
          const text =
            typeof m.content === "string"
              ? m.content
              : m.content
                  .map((c) =>
                    c.type === "text" && "text" in c && typeof c.text === "string" ? c.text : "",
                  )
                  .join("");
          const hook = m.role === "user" ? detectHookKind(text) : null;
          return { role: m.role as "user" | "assistant", text, hook };
        })
        .filter((m) => m.text.trim().length > 0);
      json(res, 200, { history });
      return;
    }

    if (method === "GET" && url === "/commands") {
      // Workflow commands with agent functionality: built-in prompt templates +
      // the user's own `.gg/commands/*.md`. UI commands (model/quit/etc.) are
      // handled webview-side and intentionally excluded.
      void (async () => {
        const builtins = PROMPT_COMMANDS.map((c) => ({
          name: c.name,
          aliases: c.aliases,
          description: c.description,
          source: "built-in" as const,
        }));
        const custom = (await loadCustomCommands(cwd))
          // A custom command can't shadow a built-in name.
          .filter((c) => !PROMPT_COMMANDS.some((b) => b.name === c.name))
          .map((c) => ({
            name: c.name,
            aliases: [] as string[],
            description: c.description,
            source: "custom" as const,
          }));
        json(res, 200, { commands: [...builtins, ...custom] });
      })();
      return;
    }

    if (method === "POST" && url === "/prompt") {
      void readBody(req).then(async (raw) => {
        let text: string;
        let attachments: AppAttachment[];
        try {
          const body = JSON.parse(raw) as { text?: string; attachments?: AppAttachment[] };
          text = body.text ?? "";
          attachments = Array.isArray(body.attachments) ? body.attachments : [];
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (!text.trim() && attachments.length === 0) {
          json(res, 400, { error: "empty prompt" });
          return;
        }
        if (running) {
          // Queue text prompts as mid-run steering (mirrors the CLI). Attachments
          // aren't supported mid-run — reject those so the user resends after.
          if (attachments.length > 0) {
            json(res, 409, { error: "cannot attach files while the agent is running" });
            return;
          }
          const count = session.queueMessage(text);
          broadcast("queued", { count });
          json(res, 202, { queued: true, count });
          return;
        }
        json(res, 202, { accepted: true });
        running = true;
        broadcast("run_start", { text });
        try {
          if (attachments.length > 0) {
            // Persist each attachment under .gg/uploads so files are inspectable
            // by the agent's tools, then prompt with the media as native blocks.
            const prepared = await prepareAttachments(cwd, attachments);
            await session.promptWithAttachments(text, prepared);
          } else {
            // Pass the raw text straight through. AgentSession.prompt() is the
            // single source of truth for slash-command expansion (built-in +
            // `.gg/commands/*.md` custom), so the agent gets the right body
            // while the webview keeps showing the short `/name`.
            await session.prompt(text);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          broadcast("error", { message });
          log("ERROR", "app-sidecar", "prompt failed", { message });
        } finally {
          running = false;
          // A run may have switched branches (git checkout) or spawned/finished
          // background tasks — refresh the footer extras once it settles.
          gitBranch = await getGitBranch(cwd).catch(() => gitBranch);
          broadcast("run_end", {});
          // Queue drains into the run as steering, so it's empty by run_end —
          // sync the webview indicator.
          broadcast("queued", { count: session.getQueuedCount() });
          broadcast("extras", footerExtras());
          // Generate a session title once, after the first run, for the title
          // bar (best-effort, async — don't block the response).
          if (!titleGenerated) {
            titleGenerated = true;
            void session.generateTitle().then((title) => {
              if (title) broadcast("session_title", { title });
            });
          }
        }
      });
      return;
    }

    if (method === "GET" && url === "/models") {
      void (async () => {
        const loggedIn: Provider[] = [];
        for (const p of ALL_PROVIDERS) {
          if (await auth.hasProviderAuth(p)) loggedIn.push(p);
        }
        // Just the names, grouped by provider in registry order — the UI shows
        // a clean multi-column list of model ids.
        const models = MODELS.filter((m) => loggedIn.includes(m.provider)).map((m) => ({
          id: m.id,
          name: m.name,
          provider: m.provider,
        }));
        json(res, 200, { models });
      })();
      return;
    }

    if (method === "POST" && url === "/model") {
      void readBody(req).then(async (raw) => {
        let modelId: string;
        try {
          modelId = (JSON.parse(raw) as { model?: string }).model ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const target = getModel(modelId);
        if (!target) {
          json(res, 404, { error: `unknown model: ${modelId}` });
          return;
        }
        if (running) {
          json(res, 409, { error: "cannot switch model while running" });
          return;
        }
        await session.switchModel(target.provider, target.id);
        // Clamp the reasoning level to what the new model supports (mirrors the
        // CLI): keep thinking on at the first supported tier if it was on but
        // the prior level is unsupported here; leave it off if it was off.
        const prevLevel = session.getThinkingLevel();
        if (prevLevel && !isThinkingLevelSupported(target.provider, target.id, prevLevel)) {
          session.setThinkingLevel(getNextThinkingLevel(target.provider, target.id, undefined));
        }
        const payload = {
          thinkingLevel: session.getThinkingLevel() ?? null,
          supportedThinkingLevels: getSupportedThinkingLevels(target.provider, target.id),
        };
        // model_change is emitted by switchModel; follow with thinking_change so
        // the footer toggle reflects the new model's supported levels.
        broadcast("thinking_change", payload);
        // The new model usually has a different context window — push extras so
        // the footer's context meter rescales immediately.
        broadcast("extras", footerExtras());
        json(res, 200, { provider: target.provider, model: target.id, ...payload });
      });
      return;
    }

    if (method === "POST" && url === "/kill") {
      void readBody(req).then(async (raw) => {
        let id: string;
        try {
          id = (JSON.parse(raw) as { id?: string }).id ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (!id.trim()) {
          json(res, 400, { error: "missing task id" });
          return;
        }
        const message = await session.killBackgroundProcess(id);
        // Push the updated task list right away rather than waiting for the poll.
        broadcast("tasks", { tasks: session.listBackgroundProcesses() });
        json(res, 200, { message });
      });
      return;
    }

    if (method === "POST" && url === "/thinking") {
      const st = session.getState();
      const next = getNextThinkingLevel(st.provider, st.model, session.getThinkingLevel());
      session.setThinkingLevel(next);
      const payload = {
        thinkingLevel: next ?? null,
        supportedThinkingLevels: getSupportedThinkingLevels(st.provider, st.model),
      };
      broadcast("thinking_change", payload);
      json(res, 200, payload);
      return;
    }

    if (method === "POST" && url === "/cancel") {
      abort.abort();
      abort = new AbortController();
      session.setSignal(abort.signal);
      running = false;
      // Drop any queued steering and return it so the webview can restore it to
      // the composer.
      const drained = session.drainQueue();
      broadcast("run_end", { cancelled: true });
      broadcast("queued", { count: 0 });
      json(res, 200, { cancelled: true, drained });
      return;
    }

    if (method === "POST" && url === "/new-session") {
      if (running) {
        json(res, 409, { error: "cannot start a new session while running" });
        return;
      }
      void session
        .newSession()
        .then(() => {
          broadcast("session_reset", {});
          json(res, 200, { ok: true });
        })
        .catch((err) => {
          json(res, 500, { error: err instanceof Error ? err.message : String(err) });
        });
      return;
    }

    // ── Provider auth (login) ───────────────────────────────
    if (method === "GET" && url === "/auth/status") {
      void authStatusPayload().then((payload) => json(res, 200, payload));
      return;
    }

    if (method === "POST" && url === "/auth/apikey") {
      void readBody(req).then(async (raw) => {
        let provider = "";
        let key: string;
        try {
          const body = JSON.parse(raw) as { provider?: string; key?: string };
          provider = body.provider ?? "";
          key = (body.key ?? "").trim();
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const meta = AUTH_PROVIDERS.find((p) => p.value === provider);
        if (!meta || !meta.methods.includes("apikey")) {
          json(res, 400, { error: "provider does not support API key auth" });
          return;
        }
        if (!key) {
          json(res, 400, { error: "API key is required" });
          return;
        }
        const creds: OAuthCredentials = {
          accessToken: key,
          refreshToken: "",
          expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000 * 100, // ~100y
          ...(meta.apiKeyBaseUrl ? { baseUrl: meta.apiKeyBaseUrl } : {}),
        };
        await auth.setCredentials(provider, creds);
        broadcast("auth_done", { provider });
        json(res, 200, { ok: true });
      });
      return;
    }

    if (method === "POST" && url === "/auth/oauth/start") {
      void readBody(req).then((raw) => {
        let provider = "";
        try {
          provider = (JSON.parse(raw) as { provider?: string }).provider ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        const meta = AUTH_PROVIDERS.find((p) => p.value === provider);
        if (!meta || !meta.methods.includes("oauth")) {
          json(res, 400, { error: "provider does not support OAuth" });
          return;
        }
        if (oauthInFlight) {
          json(res, 409, { error: "a login is already in progress" });
          return;
        }
        oauthInFlight = true;
        json(res, 202, { accepted: true });
        void (async () => {
          const cb = authCallbacks();
          try {
            let creds: OAuthCredentials;
            let storageKey = provider;
            if (provider === "anthropic") creds = await loginAnthropic(cb);
            else if (provider === "openai") creds = await loginOpenAI(cb);
            else if (provider === "gemini") creds = await loginGemini(cb);
            else if (provider === "moonshot") {
              creds = await loginKimi(cb);
              storageKey = MOONSHOT_OAUTH_KEY;
            } else {
              throw new Error(`OAuth not implemented for ${provider}`);
            }
            await auth.setCredentials(storageKey, creds);
            broadcast("auth_done", { provider });
          } catch (err) {
            broadcast("auth_error", {
              provider,
              message: err instanceof Error ? err.message : String(err),
            });
          } finally {
            oauthInFlight = false;
            pendingCode = null;
          }
        })();
      });
      return;
    }

    if (method === "POST" && url === "/auth/oauth/code") {
      void readBody(req).then((raw) => {
        let code: string;
        try {
          code = (JSON.parse(raw) as { code?: string }).code ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        if (!pendingCode) {
          json(res, 409, { error: "no login is awaiting a code" });
          return;
        }
        pendingCode(code.trim());
        pendingCode = null;
        json(res, 200, { ok: true });
      });
      return;
    }

    if (method === "POST" && url === "/auth/logout") {
      void readBody(req).then(async (raw) => {
        let provider: string;
        try {
          provider = (JSON.parse(raw) as { provider?: string }).provider ?? "";
        } catch {
          json(res, 400, { error: "invalid JSON body" });
          return;
        }
        await auth.clearCredentials(provider);
        // Moonshot's OAuth credential lives under a distinct key — clear both so
        // "disconnect" fully removes Kimi OAuth and the API key.
        if (provider === "moonshot") await auth.clearCredentials(MOONSHOT_OAUTH_KEY);
        broadcast("auth_done", { provider });
        json(res, 200, { ok: true });
      });
      return;
    }

    json(res, 404, { error: "not found" });
  });

  server.listen(port, host, () => {
    const addr = server.address() as AddressInfo;
    // The Rust shell reads this line to learn the port.
    process.stdout.write(`GG_APP_LISTENING ${addr.port}\n`);
    log("INFO", "app-sidecar", "listening", { port: String(addr.port), host });
  });

  const shutdown = async (): Promise<void> => {
    tasksPollStopped = true;
    if (tasksPoll) clearTimeout(tasksPoll);
    for (const c of clients) c.res.end();
    server.close();
    await session.dispose().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`GG_APP_FATAL ${message}\n`);
  process.exit(1);
});
