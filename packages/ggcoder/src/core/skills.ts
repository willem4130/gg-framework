import fs from "node:fs/promises";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  content: string;
  source: string;
}

/**
 * Discover skills from global and project-local skill directories.
 */
export async function discoverSkills(options: {
  globalSkillsDir: string;
  projectDir?: string;
}): Promise<Skill[]> {
  const skills: Skill[] = [];

  // Global skills: ~/.gg/skills/*.md
  const globalSkills = await loadSkillsFromDir(options.globalSkillsDir, "global");
  skills.push(...globalSkills);

  // Project skills: {cwd}/.gg/skills/*.md
  if (options.projectDir) {
    const projectSkillsDir = path.join(options.projectDir, ".gg", "skills");
    const projectSkills = await loadSkillsFromDir(projectSkillsDir, "project");
    skills.push(...projectSkills);
  }

  return skills;
}

async function loadSkillsFromDir(dir: string, source: string): Promise<Skill[]> {
  const skills: Skill[] = [];

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch {
    return skills;
  }

  for (const file of files) {
    if (!file.endsWith(".md")) continue;
    const filePath = path.join(dir, file);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      const skill = parseSkillFile(content, source);
      if (!skill.name) {
        skill.name = path.basename(file, ".md");
      }
      skills.push(skill);
    } catch {
      // Skip unreadable files
    }
  }

  return skills;
}

/**
 * Parse a skill file with optional frontmatter.
 * Supports simple key: value frontmatter between --- delimiters.
 */
export function parseSkillFile(raw: string, source: string): Skill {
  let name = "";
  let description = "";
  let content = raw;

  // Check for frontmatter
  if (raw.startsWith("---")) {
    const endIndex = raw.indexOf("---", 3);
    if (endIndex !== -1) {
      const frontmatter = raw.slice(3, endIndex).trim();
      content = raw.slice(endIndex + 3).trim();

      for (const line of frontmatter.split("\n")) {
        const colonIndex = line.indexOf(":");
        if (colonIndex === -1) continue;
        const key = line.slice(0, colonIndex).trim().toLowerCase();
        const value = line.slice(colonIndex + 1).trim();
        if (key === "name") name = value;
        else if (key === "description") description = value;
      }
    }
  }

  return { name, description, content, source };
}

/**
 * Format skills into a system prompt section.
 */
export function formatSkillsForPrompt(skills: Skill[]): string {
  if (skills.length === 0) return "";

  const parts = ["## Skills\n"];
  for (const skill of skills) {
    parts.push(`### ${skill.name}${skill.description ? ` — ${skill.description}` : ""}`);
    parts.push(skill.content);
    parts.push("");
  }

  return parts.join("\n");
}
