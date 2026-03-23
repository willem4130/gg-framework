import type { ActivityPhase } from "./hooks/useAgentLoop.js";

// ── Phrase lists ────────────────────────────────────────────

const CONTEXTUAL_PHRASES = [
  {
    keywords: /\b(bug|fix|error|issue|broken|crash|fail|wrong)\b/i,
    phrases: [
      "Investigating",
      "Diagnosing",
      "Tracing the issue",
      "Hunting the bug",
      "Analyzing the problem",
      "Narrowing it down",
    ],
  },
  {
    keywords: /\b(refactor|clean|improve|optimize|simplify|restructure)\b/i,
    phrases: [
      "Studying the code",
      "Planning improvements",
      "Mapping dependencies",
      "Finding patterns",
      "Designing the approach",
    ],
  },
  {
    keywords: /\b(test|spec|coverage|assert|expect|describe|it\()\b/i,
    phrases: [
      "Designing tests",
      "Thinking about edge cases",
      "Planning test coverage",
      "Considering scenarios",
    ],
  },
  {
    keywords: /\b(build|deploy|ci|cd|pipeline|docker|config)\b/i,
    phrases: [
      "Checking the config",
      "Analyzing the pipeline",
      "Working through setup",
      "Reviewing the build",
    ],
  },
  {
    keywords: /\b(style|css|ui|layout|design|color|theme|display|render)\b/i,
    phrases: [
      "Visualizing the layout",
      "Crafting the design",
      "Considering the aesthetics",
      "Sketching it out",
      "Polishing the pixels",
    ],
  },
  {
    keywords: /\b(add|create|new|implement|feature|make|build)\b/i,
    phrases: [
      "Architecting",
      "Drafting the approach",
      "Planning the implementation",
      "Mapping it out",
      "Designing the solution",
    ],
  },
  {
    keywords: /\b(explain|how|why|what|understand|describe)\b/i,
    phrases: [
      "Reading through the code",
      "Connecting the dots",
      "Building understanding",
      "Tracing the logic",
      "Piecing it together",
    ],
  },
  {
    keywords: /\b(delete|remove|drop|clean\s*up|prune|trim)\b/i,
    phrases: ["Identifying dead code", "Marking for removal", "Cleaning house", "Pruning the tree"],
  },
  {
    keywords: /\b(move|rename|reorganize|restructure|migrate)\b/i,
    phrases: ["Planning the move", "Mapping the migration", "Tracing dependencies", "Reorganizing"],
  },
  {
    keywords: /\b(fetch|url|http|api|request|web|download|scrape)\b/i,
    phrases: ["Checking the docs", "Looking it up", "Pulling references", "Gathering info"],
  },
  {
    keywords: /\b(debug|log|trace|inspect|breakpoint|stack\s*trace)\b/i,
    phrases: [
      "Following the trail",
      "Inspecting the stack",
      "Chasing the bug",
      "Tracing execution",
      "Zeroing in",
    ],
  },
  {
    keywords: /\b(type|types|interface|generic|typescript|schema)\b/i,
    phrases: [
      "Mapping the types",
      "Checking the signatures",
      "Modeling the data",
      "Tracing the type graph",
    ],
  },
  {
    keywords: /\b(commit|push|pull|merge|rebase|branch|git|pr)\b/i,
    phrases: [
      "Reviewing the history",
      "Checking the diff",
      "Preparing changes",
      "Sorting out the branch",
    ],
  },
  {
    keywords: /\b(install|dependency|package|upgrade|update|version)\b/i,
    phrases: [
      "Checking dependencies",
      "Reviewing versions",
      "Sorting out packages",
      "Mapping the dep tree",
    ],
  },
];

export const PLANNING_PHRASES = [
  "Studying the codebase",
  "Mapping the architecture",
  "Drafting the plan",
  "Analyzing dependencies",
  "Charting the course",
  "Surveying the landscape",
  "Building the blueprint",
];

export const GENERAL_PHRASES = [
  "Thinking",
  "Reasoning",
  "Processing",
  "Mulling it over",
  "Working on it",
  "Contemplating",
  "Figuring it out",
  "Crunching",
  "Assembling thoughts",
  "Cooking up a plan",
  "Brewing ideas",
  "Spinning up neurons",
  "Loading wisdom",
  "Parsing the universe",
  "Channeling clarity",
];

export const THINKING_PHRASES = [
  "Deep in thought",
  "Reasoning",
  "Contemplating",
  "Pondering",
  "Reflecting",
  "Working through it",
  "Analyzing",
  "Deliberating",
];

export const GENERATING_PHRASES = [
  "Writing",
  "Composing",
  "Generating",
  "Crafting a response",
  "Drafting",
  "Putting it together",
  "Formulating",
];

export const TOOLS_GENERIC = [
  "Running tools",
  "Executing",
  "Working",
  "Processing",
  "Operating",
  "Carrying out tasks",
];

export const TOOL_PHRASES: Record<string, string[]> = {
  bash: ["Running a command", "Executing in the shell", "Running a process"],
  read: ["Reading a file", "Scanning the source", "Studying the code"],
  write: ["Writing a file", "Creating a file", "Laying down code"],
  edit: ["Editing a file", "Applying changes", "Patching the code"],
  grep: ["Searching the codebase", "Scanning for matches", "Grepping"],
  find: ["Locating files", "Searching the tree", "Scanning the directory"],
  ls: ["Listing files", "Browsing the directory", "Scanning contents"],
  subagent: ["Dispatching a subagent", "Delegating work", "Spinning up an agent"],
  "web-fetch": ["Fetching from the web", "Pulling a page", "Downloading content"],
  tasks: ["Managing tasks", "Updating the task list", "Organizing work"],
  "task-output": ["Checking task output", "Reading task results"],
  "task-stop": ["Stopping a task", "Halting a running task"],
};

function selectToolPhrases(activeToolNames: string[]): string[] {
  if (activeToolNames.length === 0) return TOOLS_GENERIC;

  const phrases: string[] = [];
  for (const name of activeToolNames) {
    const specific = TOOL_PHRASES[name];
    if (specific) phrases.push(...specific);
  }
  return phrases.length > 0 ? phrases : TOOLS_GENERIC;
}

export function selectPhrases(
  phase: ActivityPhase,
  userMessage: string,
  activeToolNames: string[],
): string[] {
  switch (phase) {
    case "thinking":
      return THINKING_PHRASES;
    case "generating":
      return GENERATING_PHRASES;
    case "tools":
      return selectToolPhrases(activeToolNames);
    default: {
      // waiting / idle — use contextual phrases based on user message
      for (const set of CONTEXTUAL_PHRASES) {
        if (set.keywords.test(userMessage)) {
          return [...set.phrases, ...GENERAL_PHRASES.slice(0, 3)];
        }
      }
      return GENERAL_PHRASES;
    }
  }
}

export function shuffleArray<T>(arr: T[]): T[] {
  const shuffled = [...arr];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}
