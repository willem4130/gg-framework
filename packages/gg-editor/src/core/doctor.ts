/**
 * First-run doctor — environment probes + actionable install hints.
 *
 * The CLI runs onboarding on first launch (no `~/.gg/auth.json` and no
 * `~/.gg/onboarded-ggeditor` marker). The same checks are exposed via
 * `ggeditor doctor` so users can re-run it any time.
 *
 * Design rules:
 *   - Probes only. We never auto-install anything — surprise sudo
 *     prompts are worse than a missing dep.
 *   - Each check carries `severity`:
 *       block    — nothing meaningful works without it (none currently;
 *                  the agent can run with zero deps)
 *       required — most tools need it (ffmpeg / ffprobe)
 *       optional — unlocks a feature group (openai-key, resolve,
 *                  premiere, whisper-cpp, whisperx)
 *       info     — purely informational (auth status)
 *   - Each check tells the user EXACTLY what to do to fix it, including
 *     the platform-appropriate install command.
 *   - Pure module — no I/O writes, no side effects beyond `spawnSync` /
 *     `existsSync` probes.
 */

import { statSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { getStoredApiKey } from "./auth/api-keys.js";
import { checkFfmpeg, checkFfprobe } from "./media/ffmpeg.js";

const PROBE_TIMEOUT_MS = 1_000;

export type CheckSeverity = "block" | "required" | "optional" | "info";

export type CheckStatus = "ok" | "missing" | "warn";

/**
 * Structured install hint. When present, the doctor's interactive flow
 * can offer to spawn this command after a Y/N confirmation — no copy-
 * paste, no shell injection (we never run a string through `sh -c`).
 *
 * Only attached to checks where the install is a single packaged step
 * (Homebrew formula, winget id, apt package). Items that need manual
 * sign-up (API keys), license acceptance (Resolve installer), or
 * multi-step setup (whisperx + HF_TOKEN) carry a `fix` string instead.
 */
export interface InstallableHint {
  /** Human label shown in the prompt: "Install ffmpeg via Homebrew". */
  label: string;
  /** Executable on PATH. */
  command: string;
  /** Argument vector — NEVER a shell string. */
  args: string[];
  /**
   * What managed manager this uses. Used by the renderer to decide
   * whether to show "requires sudo" copy.
   */
  manager: "homebrew" | "winget" | "apt" | "pip" | "npm";
  /** True when the command requires elevated privileges (sudo / admin). */
  needsSudo?: boolean;
}

/**
 * Structured prompt action. When present, the doctor's interactive
 * screen can capture a secret (API key, token) directly and persist
 * it to the api-keys store — no "open another terminal and run
 * export X=..." busywork.
 *
 * Persistence is on the runner side; this struct just describes WHAT
 * to capture and WHERE to put it (`store` is a stable id used by
 * `setStoredApiKey`).
 */
export interface PromptHint {
  /** Title shown above the input: "Paste your OpenAI API key". */
  label: string;
  /** Optional one-line guidance under the title (URL where to get it). */
  hint?: string;
  /** ApiKeyName from auth/api-keys.ts — "openai" | "huggingface". */
  store: "openai" | "huggingface";
  /** Lightweight format check; rejects obviously-wrong input. */
  validate?: (value: string) => string | undefined;
}

export interface DoctorCheck {
  /** Stable id (also the check key). */
  id: string;
  /** ≤30 char display label. */
  label: string;
  status: CheckStatus;
  severity: CheckSeverity;
  /** One-line current state ("v6.1.1 found", "not on PATH", …). */
  detail: string;
  /**
   * What this check unlocks for the user. Always present, even when
   * status=ok — gives the user the mental model.
   */
  unlocks: string;
  /**
   * Optional structured install command for items where a single
   * package-manager invocation does the job. The CLI offers Y/N
   * confirmation and spawns it directly.
   */
  installable?: InstallableHint;
  /**
   * Optional inline secret prompt (API key / token). When the user hits
   * Enter on this item the doctor captures the value and persists it
   * to ~/.gg/api-keys.json. Mutually exclusive with `installable` per
   * action; if both are present, install runs first then prompt.
   */
  prompt?: PromptHint;
  /**
   * Free-form fix copy for the static `--all` / non-interactive path.
   * The interactive screen IGNORES this — it uses installable/prompt.
   * Multi-line is fine here; only `--all` renders it.
   */
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** True when no `severity=required` check is missing. */
  ready: boolean;
  /** Where the marker file was/should be written. */
  markerPath: string;
  /** Whether onboarding has been completed before. */
  onboarded: boolean;
}

const ONBOARDED_MARKER = "onboarded-ggeditor";

export function onboardedMarkerPath(home: string = homedir()): string {
  return join(home, ".gg", ONBOARDED_MARKER);
}

export function isOnboarded(home: string = homedir()): boolean {
  try {
    return statSync(onboardedMarkerPath(home)).isFile();
  } catch {
    return false;
  }
}

/**
 * Run every check. Synchronous and quick — only spawns short-lived
 * `--version` style probes.
 */
export function runDoctor(home: string = homedir()): DoctorReport {
  // Host (Resolve / Premiere) detection lives in the live banner +
  // footer at runtime — the doctor doesn't lecture users about which
  // NLE they have. They know.
  const checks: DoctorCheck[] = [
    checkFfmpegProbe(),
    checkFfprobeProbe(),
    checkAuthFile(home),
    checkOpenAIKey(),
    checkPython(),
    checkWhisperCpp(),
    checkWhisperX(),
    checkAnthropicKey(),
  ];

  const ready = checks.every((c) => c.severity !== "required" || c.status === "ok");
  return {
    checks,
    ready,
    markerPath: onboardedMarkerPath(home),
    onboarded: isOnboarded(home),
  };
}

// ── Individual probes ──────────────────────────────────────

function checkFfmpegProbe(): DoctorCheck {
  const ok = checkFfmpeg();
  return {
    id: "ffmpeg",
    label: "ffmpeg",
    status: ok ? "ok" : "missing",
    severity: "required",
    detail: ok ? versionLine("ffmpeg") : "not on PATH",
    unlocks:
      "Most tools (transcoding, captions, color grading, silence/filler cuts, transitions, " +
      "audio mixing, GIF/thumbnail generation). ~70% of the toolkit.",
    fix: ok ? undefined : ffmpegInstallHint(),
    installable: ok
      ? undefined
      : buildInstallable({
          pkg: { darwin: "ffmpeg", linux: "ffmpeg", win32: "Gyan.FFmpeg" },
          label: "Install ffmpeg",
        }),
  };
}

function checkFfprobeProbe(): DoctorCheck {
  const ok = checkFfprobe();
  return {
    id: "ffprobe",
    label: "ffprobe",
    status: ok ? "ok" : "missing",
    severity: "required",
    detail: ok ? versionLine("ffprobe") : "not on PATH",
    unlocks: "probe_media (fps / duration / codec detection — runs on every input file).",
    fix: ok ? undefined : ffmpegInstallHint(),
    // ffprobe ships in the same Homebrew/winget/apt package as ffmpeg.
    installable: ok
      ? undefined
      : buildInstallable({
          pkg: { darwin: "ffmpeg", linux: "ffmpeg", win32: "Gyan.FFmpeg" },
          label: "Install ffmpeg (includes ffprobe)",
        }),
  };
}

function checkOpenAIKey(): DoctorCheck {
  const fromEnv = !!process.env.OPENAI_API_KEY;
  const fromStore = !!getStoredApiKey("openai");
  const present = fromEnv || fromStore;
  return {
    id: "openai-key",
    label: "OpenAI API key",
    status: present ? "ok" : "missing",
    severity: "optional",
    detail: fromEnv ? "set (env)" : fromStore ? "set (saved)" : "not set",
    unlocks:
      "Vision tools: analyze_hook, score_shot, color_match, grade_skin_tones, " +
      "match_clip_color, and the OpenAI transcription backend.",
    prompt: present
      ? undefined
      : {
          label: "Paste your OpenAI API key",
          hint: "Get one at https://platform.openai.com/api-keys (free tier available)",
          store: "openai",
          validate: (v) => (v.startsWith("sk-") ? undefined : "OpenAI keys start with 'sk-'"),
        },
    fix: present
      ? undefined
      : "Press Enter to paste your key here — it'll be saved to ~/.gg/api-keys.json.",
  };
}

function checkAnthropicKey(): DoctorCheck {
  // Anthropic auth normally goes through OAuth (~/.gg/auth.json). The env
  // var only matters for users who prefer raw API keys. We mark it as
  // info — auth status is what really matters.
  const present = !!process.env.ANTHROPIC_API_KEY;
  return {
    id: "anthropic-key",
    label: "ANTHROPIC_API_KEY",
    status: present ? "ok" : "missing",
    severity: "info",
    detail: present ? "set" : "not set",
    unlocks: "Direct Anthropic API auth without OAuth. Most users should `ggeditor login` instead.",
    fix: undefined,
  };
}

function checkPython(): DoctorCheck {
  const candidates = platform() === "win32" ? ["py", "python", "python3"] : ["python3", "python"];
  for (const cmd of candidates) {
    const r = spawnSync(cmd, cmd === "py" ? ["-3", "--version"] : ["--version"], {
      encoding: "utf8",
      timeout: PROBE_TIMEOUT_MS,
    });
    if (r.status === 0) {
      const out = (r.stdout || r.stderr).trim();
      const m = /\b(\d+\.\d+(?:\.\d+)?)\b/.exec(out);
      return {
        id: "python",
        label: "Python 3",
        status: "ok",
        severity: "optional",
        detail: m ? `v${m[1]}` : "found",
        unlocks:
          "DaVinci Resolve scripting bridge (host integration). Without Python, file-only " +
          "mode still works.",
      };
    }
  }
  return {
    id: "python",
    label: "Python 3",
    status: "missing",
    severity: "optional",
    detail: "not on PATH",
    unlocks:
      "DaVinci Resolve scripting bridge (host integration). File-only mode works without it.",
    fix:
      platform() === "darwin"
        ? "brew install python   # latest 3.x (currently 3.14)"
        : platform() === "linux"
          ? "sudo apt install python3   # debian/ubuntu — your distro's package manager otherwise"
          : "winget install Python.Python.3   # or python.org installer",
    installable: buildInstallable({
      // 'python' is Homebrew's alias for the current default Python 3
      // bottle (currently 3.14). Tracks Homebrew's choice so we don't
      // pin a stale minor.
      pkg: { darwin: "python", linux: "python3", win32: "Python.Python.3" },
      label: "Install Python 3",
    }),
  };
}

function checkWhisperCpp(): DoctorCheck {
  for (const cmd of ["whisper-cli", "whisper", "main"]) {
    const r = spawnSync(cmd, ["--help"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
    if (r.status === 0 && (r.stdout + r.stderr).toLowerCase().includes("whisper")) {
      return {
        id: "whisper-cpp",
        label: "whisper.cpp",
        status: "ok",
        severity: "optional",
        detail: "installed",
        unlocks:
          "Local transcription (free, fast, private). Without it, transcribe falls back to " +
          "the OpenAI API (requires OPENAI_API_KEY).",
      };
    }
  }
  return {
    id: "whisper-cpp",
    label: "whisper.cpp",
    status: "missing",
    severity: "optional",
    detail: "not installed",
    unlocks:
      "Local transcription. Without it, transcribe uses the OpenAI API (requires OPENAI_API_KEY).",
    fix:
      platform() === "darwin"
        ? "brew install whisper-cpp   # then download a model from https://huggingface.co/ggerganov/whisper.cpp"
        : "Build from source: https://github.com/ggml-org/whisper.cpp",
    // Only Homebrew packages whisper.cpp cleanly. Linux / Windows users
    // need to build from source — we leave them with the `fix` string.
    installable: buildInstallable({
      pkg: { darwin: "whisper-cpp" },
      label: "Install whisper.cpp (you'll still need to download a model)",
    }),
  };
}

function checkWhisperX(): DoctorCheck {
  const r = spawnSync("whisperx", ["--help"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  const ok = r.status === 0;
  const fromEnv = !!process.env.HF_TOKEN;
  const fromStore = !!getStoredApiKey("huggingface");
  const hfToken = fromEnv || fromStore;
  if (ok && hfToken) {
    return {
      id: "whisperx",
      label: "whisperx",
      status: "ok",
      severity: "optional",
      detail: fromEnv ? "ready (env)" : "ready (saved)",
      unlocks:
        "Speaker diarization (transcribe with diarize=true). Required for read_transcript with " +
        "speaker filters.",
    };
  }
  if (ok && !hfToken) {
    return {
      id: "whisperx",
      label: "whisperx",
      status: "warn",
      severity: "optional",
      detail: "missing HF_TOKEN",
      unlocks: "Speaker diarization (transcribe with diarize=true).",
      prompt: {
        label: "Paste your Hugging Face token",
        hint:
          "Free at https://huggingface.co/settings/tokens — also accept " +
          "https://huggingface.co/pyannote/speaker-diarization-3.1 model terms.",
        store: "huggingface",
        validate: (v) => (v.startsWith("hf_") ? undefined : "Hugging Face tokens start with 'hf_'"),
      },
      fix: "Press Enter to paste your token here — it'll be saved to ~/.gg/api-keys.json.",
    };
  }
  return {
    id: "whisperx",
    label: "whisperx",
    status: "missing",
    severity: "optional",
    detail: "not installed",
    unlocks: "Speaker diarization (transcribe with diarize=true).",
    fix: whisperxFixHint(),
    installable: whisperxInstaller(),
    // After install succeeds the next doctor pass will see whisperx on
    // PATH and surface the warn-state with the HF_TOKEN prompt above.
    // We don't bundle the token prompt with the install action because
    // pipx output is verbose and we want a clean transition.
  };
}

/**
 * Install path for whisperx. We prefer `pipx` because modern Python on
 * Homebrew / most distros enforces PEP 668 — `pip install --user` is
 * refused unless you pass `--break-system-packages`. pipx solves this
 * by isolating each tool in its own venv and exposing the entry point
 * on PATH. Fallback chain:
 *   1. pipx — the recommended path on Homebrew/Linux distros (PEP 668-safe).
 *   2. pip3 with --break-system-packages — last resort when pipx isn't
 *      installed; the user can always install pipx manually first.
 *   3. nothing — falls back to the manual `fix` text.
 */
function whisperxInstaller(): InstallableHint | undefined {
  if (hasManager("pipx")) {
    return {
      label: "Install whisperx via pipx (you'll still need HF_TOKEN + accept model terms)",
      command: "pipx",
      args: ["install", "whisperx"],
      manager: "pip",
    };
  }
  // No pipx — don't try `pip3 install --user`; PEP 668 will reject it on
  // any sane Python install. Surface the manual fix instead so the user
  // sees the right next step (install pipx) rather than a wall of pip
  // error text.
  return undefined;
}

function whisperxFixHint(): string {
  const installPipx =
    platform() === "darwin"
      ? "brew install pipx"
      : platform() === "linux"
        ? "sudo apt install pipx   # or your distro's package manager"
        : "winget install pipx";
  return (
    `${installPipx}\n` +
    "pipx install whisperx\n" +
    "export HF_TOKEN=hf_...   # https://huggingface.co/settings/tokens\n" +
    "Then accept https://huggingface.co/pyannote/speaker-diarization-3.1 model terms."
  );
}

function checkAuthFile(home: string): DoctorCheck {
  const path = join(home, ".gg", "auth.json");
  const exists = (() => {
    try {
      return statSync(path).isFile();
    } catch {
      return false;
    }
  })();
  return {
    id: "auth",
    label: "Auth",
    status: exists ? "ok" : "missing",
    severity: "required",
    detail: exists ? "signed in" : "not configured",
    unlocks: "The agent itself. Without auth, ggeditor can't talk to a model provider.",
    fix: exists
      ? undefined
      : "Run `ggeditor login` and pick a provider (Anthropic OAuth recommended; OpenAI / GLM / " +
        "Moonshot also supported). Auth is shared with ggcoder via ~/.gg/auth.json — log in once.",
  };
}

// ── Helpers ────────────────────────────────────────────────

/**
 * Probe a `<cmd> -version` output and return ONLY the version number
 * (e.g. "v8.0.1"). Trims away program name + copyright noise so the
 * doctor's right-hand column stays a clean one-word status.
 */
function versionLine(cmd: string): string {
  const r = spawnSync(cmd, ["-version"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  if (r.status !== 0) return "found";
  const first = (r.stdout.split(/\r?\n/)[0] || "").trim();
  const m = /\b(\d+\.\d+(?:\.\d+)?)\b/.exec(first);
  return m ? `v${m[1]}` : "found";
}

function ffmpegInstallHint(): string {
  switch (platform()) {
    case "darwin":
      return "brew install ffmpeg";
    case "linux":
      return "sudo apt install ffmpeg   # debian/ubuntu — your distro's package manager otherwise";
    case "win32":
      return "winget install ffmpeg   # or scoop install ffmpeg";
    default:
      return "Install ffmpeg from https://ffmpeg.org/download.html";
  }
}

/**
 * True when `cmd --version` (or `--help` for managers that don't have
 * a version flag) exits 0. Cached for the lifetime of the process so we
 * don't re-spawn the same probe across multiple checks.
 */
const _managerCache = new Map<string, boolean>();
function hasManager(cmd: string): boolean {
  const cached = _managerCache.get(cmd);
  if (cached !== undefined) return cached;
  const r = spawnSync(cmd, ["--version"], { encoding: "utf8", timeout: PROBE_TIMEOUT_MS });
  const ok = r.status === 0;
  _managerCache.set(cmd, ok);
  return ok;
}

/**
 * Build an InstallableHint for a package whose name matches across the
 * common managers we support. Returns undefined when no supported
 * manager is available on this platform — in which case the check just
 * surfaces a `fix` string instead.
 */
function buildInstallable(opts: {
  pkg: { darwin?: string; linux?: string; win32?: string };
  label: string;
}): InstallableHint | undefined {
  const p = platform();
  if (p === "darwin" && opts.pkg.darwin && hasManager("brew")) {
    return {
      label: opts.label,
      command: "brew",
      args: ["install", opts.pkg.darwin],
      manager: "homebrew",
    };
  }
  if (p === "linux" && opts.pkg.linux && hasManager("apt")) {
    return {
      label: opts.label,
      command: "sudo",
      args: ["apt", "install", "-y", opts.pkg.linux],
      manager: "apt",
      needsSudo: true,
    };
  }
  if (p === "win32" && opts.pkg.win32 && hasManager("winget")) {
    return {
      label: opts.label,
      command: "winget",
      args: [
        "install",
        "--id",
        opts.pkg.win32,
        "-e",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ],
      manager: "winget",
    };
  }
  return undefined;
}
