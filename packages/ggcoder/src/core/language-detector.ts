import fs from "node:fs";
import path from "node:path";

/**
 * Supported language identifiers for style packs.
 * Adding a new language: add the id here, add a marker entry to MARKERS,
 * and add the pack content in `style-packs/packs.ts`.
 */
export type LanguageId =
  | "typescript"
  | "javascript"
  | "python"
  | "go"
  | "rust"
  | "java"
  | "kotlin"
  | "csharp"
  | "cpp"
  | "c"
  | "ruby"
  | "php"
  | "swift"
  | "scala"
  | "elixir"
  | "haskell"
  | "ocaml"
  | "fsharp"
  | "clojure"
  | "dart"
  | "lua"
  | "zig"
  | "sql"
  | "bash"
  | "terraform";

/**
 * Each marker entry is either:
 *   - a filename present at the cwd root (cheap, deterministic)
 *   - a file extension that appears in any of a few top-level source dirs
 *
 * Detection runs cheap filesystem stats only — no recursive walks. The goal is
 * to surface obvious project types; missed detection just means the relevant
 * style pack isn't injected, which is a no-op degradation.
 */
interface Marker {
  /** Manifest/config files whose presence definitively implies the language. */
  manifests?: readonly string[];
  /** Source-file extensions. We only check the first ~50 entries of cwd + a few common subdirs. */
  extensions?: readonly string[];
}

const MARKERS: Readonly<Record<LanguageId, Marker>> = {
  typescript: { manifests: ["tsconfig.json"], extensions: [".ts", ".tsx", ".mts", ".cts"] },
  // JS is only flagged when there's a package.json AND no tsconfig — pure JS projects.
  // Handled specially in detectLanguages.
  javascript: { manifests: ["package.json"], extensions: [".js", ".jsx", ".mjs", ".cjs"] },
  python: {
    manifests: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt", "Pipfile"],
    extensions: [".py"],
  },
  go: { manifests: ["go.mod"], extensions: [".go"] },
  rust: { manifests: ["Cargo.toml"], extensions: [".rs"] },
  java: { manifests: ["pom.xml", "build.gradle", "build.gradle.kts"], extensions: [".java"] },
  kotlin: { manifests: ["build.gradle.kts"], extensions: [".kt", ".kts"] },
  csharp: { manifests: [], extensions: [".cs", ".csproj", ".sln"] },
  cpp: {
    manifests: ["CMakeLists.txt"],
    extensions: [".cpp", ".cc", ".cxx", ".hpp", ".hh"],
  },
  c: { manifests: [], extensions: [".c", ".h"] },
  ruby: { manifests: ["Gemfile", "Rakefile", ".ruby-version"], extensions: [".rb"] },
  php: { manifests: ["composer.json"], extensions: [".php"] },
  swift: { manifests: ["Package.swift"], extensions: [".swift"] },
  scala: { manifests: ["build.sbt"], extensions: [".scala", ".sc"] },
  elixir: { manifests: ["mix.exs"], extensions: [".ex", ".exs"] },
  haskell: { manifests: ["stack.yaml", "cabal.project"], extensions: [".hs"] },
  ocaml: { manifests: ["dune-project"], extensions: [".ml", ".mli"] },
  fsharp: { manifests: [], extensions: [".fs", ".fsx", ".fsproj"] },
  clojure: { manifests: ["project.clj", "deps.edn"], extensions: [".clj", ".cljs", ".cljc"] },
  dart: { manifests: ["pubspec.yaml"], extensions: [".dart"] },
  lua: { manifests: [".luarc.json"], extensions: [".lua"] },
  zig: { manifests: ["build.zig"], extensions: [".zig"] },
  sql: { manifests: [], extensions: [".sql"] },
  bash: { manifests: [], extensions: [".sh", ".bash"] },
  terraform: { manifests: [], extensions: [".tf", ".tfvars"] },
};

const ALL_LANGUAGES = Object.keys(MARKERS) as LanguageId[];

/**
 * Subdirectories scanned for source-file extensions, in addition to cwd root.
 * Kept short to bound cost. Detection is intentionally biased toward
 * marker-file presence over extension scans.
 */
const SCAN_DIRS = ["src", "lib", "app", "scripts", "internal", "cmd", "pkg"] as const;

/** Cap on entries read per directory — prevents pathological cost on huge dirs. */
const MAX_ENTRIES_PER_DIR = 50;

/**
 * Detect active languages in a project root.
 *
 * Pure, synchronous, side-effect free. Cheap: a bounded number of fs stats
 * and one directory listing per scanned subdir. Safe to call after every
 * tool result — see `App.tsx` integration.
 */
export function detectLanguages(cwd: string): Set<LanguageId> {
  const detected = new Set<LanguageId>();

  // Pass 1: manifest files at cwd root — cheap, deterministic.
  for (const lang of ALL_LANGUAGES) {
    const manifests = MARKERS[lang].manifests;
    if (!manifests || manifests.length === 0) continue;
    for (const manifest of manifests) {
      if (fileExists(path.join(cwd, manifest))) {
        detected.add(lang);
        break;
      }
    }
  }

  // Pass 2: extension scan in root + select subdirs — covers languages without
  // a canonical manifest (C, C#, SQL, Bash, Terraform, etc.).
  const dirsToScan = [cwd, ...SCAN_DIRS.map((d) => path.join(cwd, d))];
  for (const dir of dirsToScan) {
    let entries: string[];
    try {
      entries = fs.readdirSync(dir).slice(0, MAX_ENTRIES_PER_DIR);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const ext = path.extname(entry).toLowerCase();
      if (!ext) continue;
      for (const lang of ALL_LANGUAGES) {
        if (detected.has(lang)) continue;
        const exts = MARKERS[lang].extensions;
        if (exts && exts.includes(ext)) {
          detected.add(lang);
        }
      }
    }
  }

  // Disambiguate JS vs TS — if both are flagged, prefer TypeScript only.
  // A package.json + tsconfig.json + .ts files is a TS project, not "both".
  if (detected.has("typescript") && detected.has("javascript")) {
    detected.delete("javascript");
  }

  // Disambiguate Java vs Kotlin — `build.gradle.kts` triggers both. Keep both
  // when there are actual .kt source files; otherwise treat as Java.
  if (detected.has("java") && detected.has("kotlin")) {
    const hasKotlinSources = dirsToScan.some((d) => hasExtensionAt(d, [".kt"]));
    if (!hasKotlinSources) detected.delete("kotlin");
  }

  // Disambiguate C vs C++ — if both flagged from extensions, and a CMakeLists
  // exists, prefer C++. Otherwise keep whichever has source files present.
  if (detected.has("c") && detected.has("cpp")) {
    // .h files alone trigger C; if there are any .cpp/.cc/.cxx files, drop C.
    const hasCppSources = dirsToScan.some((d) =>
      hasExtensionAt(d, [".cpp", ".cc", ".cxx", ".hpp"]),
    );
    if (hasCppSources) detected.delete("c");
  }

  return detected;
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function hasExtensionAt(dir: string, exts: readonly string[]): boolean {
  try {
    const entries = fs.readdirSync(dir).slice(0, MAX_ENTRIES_PER_DIR);
    for (const entry of entries) {
      if (exts.includes(path.extname(entry).toLowerCase())) return true;
    }
  } catch {
    /* directory missing — fine */
  }
  return false;
}

/**
 * Stable, deterministic ordering of a language set — used for cache-key
 * equality checks and consistent style-pack section ordering.
 */
export function languagesToSortedArray(set: Set<LanguageId>): LanguageId[] {
  const sorted = [...set];
  sorted.sort();
  return sorted;
}

/**
 * Human-facing display names for each language id. Used by the TUI badge
 * (`StylePackItem` in App.tsx) so the user sees "TypeScript" rather than
 * `typescript`. Keep these short — they're rendered inline.
 */
export const LANGUAGE_DISPLAY_NAMES: Readonly<Record<LanguageId, string>> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  python: "Python",
  go: "Go",
  rust: "Rust",
  java: "Java",
  kotlin: "Kotlin",
  csharp: "C#",
  cpp: "C++",
  c: "C",
  ruby: "Ruby",
  php: "PHP",
  swift: "Swift",
  scala: "Scala",
  elixir: "Elixir",
  haskell: "Haskell",
  ocaml: "OCaml",
  fsharp: "F#",
  clojure: "Clojure",
  dart: "Dart",
  lua: "Lua",
  zig: "Zig",
  sql: "SQL",
  bash: "Bash",
  terraform: "Terraform",
};

/**
 * Returns true iff `next` contains every member of `prev` plus at least one
 * additional language. Used to gate system-prompt rebuilds: we only re-inject
 * when the active set grows, never when it merely changes order.
 */
export function isStrictSuperset(next: Set<LanguageId>, prev: Set<LanguageId>): boolean {
  if (next.size <= prev.size) return false;
  for (const id of prev) {
    if (!next.has(id)) return false;
  }
  return true;
}
