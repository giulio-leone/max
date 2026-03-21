import { readdirSync, readFileSync, mkdirSync, writeFileSync, existsSync, rmSync } from "fs";
import { join, dirname, resolve, sep } from "path";
import { homedir } from "os";
import { fileURLToPath } from "url";
import { SKILLS_DIR } from "../paths.js";

/** User-local skills directory (~/.max/skills/) */
const LOCAL_SKILLS_DIR = SKILLS_DIR;

/** Global shared skills directory */
const GLOBAL_SKILLS_DIR = join(homedir(), ".agents", "skills");

/** Skills bundled with the Max package (e.g. find-skills) */
const BUNDLED_SKILLS_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills"
);

/** Returns all skill directories that exist on disk. */
export function getSkillDirectories(): string[] {
  const dirs: string[] = [];
  if (existsSync(BUNDLED_SKILLS_DIR)) dirs.push(BUNDLED_SKILLS_DIR);
  if (existsSync(LOCAL_SKILLS_DIR)) dirs.push(LOCAL_SKILLS_DIR);
  if (existsSync(GLOBAL_SKILLS_DIR)) dirs.push(GLOBAL_SKILLS_DIR);
  return dirs;
}

export interface SkillInfo {
  slug: string;
  name: string;
  description: string;
  directory: string;
  source: "bundled" | "local" | "global";
}

export interface SkillDetail extends SkillInfo {
  content: string;
  instructions: string;
  frontmatter: Record<string, string>;
}

export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
}

function isValidSkillSlug(slug: string): boolean {
  return slug.length > 0
    && slug.trim() === slug
    && slug !== "."
    && slug !== ".."
    && !slug.includes("/")
    && !slug.includes("\\")
    && !slug.includes("\0");
}

function resolveSkillDir(baseDir: string, slug: string): string | undefined {
  if (!isValidSkillSlug(slug)) return undefined;
  const base = resolve(baseDir);
  const skillDir = resolve(base, slug);
  return skillDir.startsWith(base + sep) ? skillDir : undefined;
}

function parseSkillDocument(content: string): {
  frontmatterText: string;
  body: string;
  fields: Record<string, string>;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) {
    return {
      frontmatterText: "",
      body: content,
      fields: {},
    };
  }

  const frontmatterText = match[1];
  const body = match[2] ?? "";
  const fields: Record<string, string> = {};

  for (const line of frontmatterText.split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) fields[key] = value;
  }

  return { frontmatterText, body, fields };
}

function buildSkillDocument(frontmatterText: string, instructions: string): string {
  const normalizedFrontmatter = frontmatterText.trim();
  const normalizedInstructions = instructions.trim();
  return `---\n${normalizedFrontmatter}\n---\n\n${normalizedInstructions}\n`;
}

function upsertFrontmatterLine(frontmatterText: string, key: string, value: string): string {
  const replacement = `${key}: ${value.trim()}`;
  const lines = frontmatterText.trim().length > 0
    ? frontmatterText.trim().split(/\r?\n/)
    : [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    if (line.slice(0, idx).trim() === key) {
      lines[i] = replacement;
      return lines.join("\n");
    }
  }

  lines.push(replacement);
  return lines.join("\n");
}

function findSkillInfo(slug: string, source?: SkillInfo["source"]): SkillInfo | undefined {
  const matches = listSkills().filter((skill) => skill.slug === slug && (source ? skill.source === source : true));
  if (matches.length === 0) return undefined;

  const priority: Record<SkillInfo["source"], number> = {
    local: 0,
    global: 1,
    bundled: 2,
  };
  matches.sort((a, b) => priority[a.source] - priority[b.source]);
  return matches[0];
}

/** Scan all skill directories and return metadata for each skill found. */
export function listSkills(): SkillInfo[] {
  const skills: SkillInfo[] = [];

  for (const [dir, source] of [
    [BUNDLED_SKILLS_DIR, "bundled"] as const,
    [LOCAL_SKILLS_DIR, "local"] as const,
    [GLOBAL_SKILLS_DIR, "global"] as const,
  ]) {
    if (!existsSync(dir)) continue;

    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillDir = join(dir, entry);
      const skillMd = join(skillDir, "SKILL.md");
      if (!existsSync(skillMd)) continue;

      try {
        const content = readFileSync(skillMd, "utf-8");
        const { fields } = parseSkillDocument(content);
        skills.push({
          slug: entry,
          name: fields.name || entry,
          description: fields.description || "(no description)",
          directory: skillDir,
          source,
        });
      } catch {
        skills.push({
          slug: entry,
          name: entry,
          description: "(could not read SKILL.md)",
          directory: skillDir,
          source,
        });
      }
    }
  }

  return skills;
}

export function readSkill(slug: string, source?: SkillInfo["source"]): { ok: boolean; message: string; skill?: SkillDetail } {
  const skill = findSkillInfo(slug, source);
  if (!skill) {
    return { ok: false, message: `Skill '${slug}' not found.` };
  }

  const skillMd = join(skill.directory, "SKILL.md");
  if (!existsSync(skillMd)) {
    return { ok: false, message: `Skill '${slug}' is missing SKILL.md.` };
  }

  const content = readFileSync(skillMd, "utf-8");
  const parsed = parseSkillDocument(content);
  return {
    ok: true,
    message: `Skill '${slug}' loaded.`,
    skill: {
      ...skill,
      content,
      instructions: parsed.body.trim(),
      frontmatter: parsed.fields,
    },
  };
}

export function validateSkillContent(content: string): SkillValidationResult {
  const parsed = parseSkillDocument(content);
  const errors: string[] = [];

  if (!parsed.frontmatterText) {
    errors.push("Skill must include YAML frontmatter delimited by --- markers.");
  }
  if (!parsed.fields.name) {
    errors.push("Skill frontmatter must include a 'name' field.");
  }
  if (!parsed.fields.description) {
    errors.push("Skill frontmatter must include a 'description' field.");
  }
  if (!parsed.body.trim()) {
    errors.push("Skill must include instructions after the frontmatter.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function validateSkill(slug: string, source?: SkillInfo["source"]): SkillValidationResult {
  const result = readSkill(slug, source);
  if (!result.ok || !result.skill) {
    return { valid: false, errors: [result.message] };
  }
  return validateSkillContent(result.skill.content);
}

/** Create a new skill in the local skills directory. */
export function createSkill(slug: string, name: string, description: string, instructions: string): string {
  const skillDir = resolveSkillDir(LOCAL_SKILLS_DIR, slug);
  if (!skillDir) {
    return `Invalid slug '${slug}': must be a simple kebab-case name without path separators.`;
  }
  if (existsSync(skillDir)) {
    return `Skill '${slug}' already exists at ${skillDir}. Edit it directly or delete it first.`;
  }

  const content = buildSkillDocument(
    `name: ${name.trim()}\ndescription: ${description.trim()}`,
    instructions
  );
  const validation = validateSkillContent(content);
  if (!validation.valid) {
    return `Invalid skill '${slug}': ${validation.errors.join(" ")}`;
  }

  mkdirSync(skillDir, { recursive: true });

  writeFileSync(
    join(skillDir, "_meta.json"),
    JSON.stringify({ slug, version: "1.0.0" }, null, 2) + "\n"
  );

  writeFileSync(join(skillDir, "SKILL.md"), content);

  return `Skill '${name}' created at ${skillDir}. It will be available on your next message.`;
}

export function updateSkill(
  slug: string,
  input: {
    name?: string;
    description?: string;
    instructions?: string;
  }
): { ok: boolean; message: string; skill?: SkillDetail; errors?: string[] } {
  const skillDir = resolveSkillDir(LOCAL_SKILLS_DIR, slug);
  if (!skillDir) {
    return {
      ok: false,
      message: `Invalid slug '${slug}': must be a simple kebab-case name without path separators.`,
    };
  }

  const skillMd = join(skillDir, "SKILL.md");
  if (!existsSync(skillMd)) {
    return {
      ok: false,
      message: `Skill '${slug}' not found in ${LOCAL_SKILLS_DIR}.`,
    };
  }

  const current = readFileSync(skillMd, "utf-8");
  const parsed = parseSkillDocument(current);
  const nextName = input.name?.trim() || parsed.fields.name;
  const nextDescription = input.description?.trim() || parsed.fields.description;
  const nextInstructions = input.instructions !== undefined ? input.instructions : parsed.body;

  let nextFrontmatter = parsed.frontmatterText;
  nextFrontmatter = upsertFrontmatterLine(nextFrontmatter, "name", nextName ?? "");
  nextFrontmatter = upsertFrontmatterLine(nextFrontmatter, "description", nextDescription ?? "");

  const nextContent = buildSkillDocument(nextFrontmatter, nextInstructions);
  const validation = validateSkillContent(nextContent);
  if (!validation.valid) {
    return {
      ok: false,
      message: `Skill '${slug}' failed validation.`,
      errors: validation.errors,
    };
  }

  writeFileSync(skillMd, nextContent);
  const updated = readSkill(slug, "local");
  if (!updated.ok || !updated.skill) {
    return {
      ok: false,
      message: `Skill '${slug}' was updated but could not be reloaded.`,
    };
  }

  return {
    ok: true,
    message: `Skill '${slug}' updated.`,
    skill: updated.skill,
  };
}

/** Remove a skill from the local skills directory (~/.max/skills/). */
export function removeSkill(slug: string): { ok: boolean; message: string } {
  const skillDir = resolveSkillDir(LOCAL_SKILLS_DIR, slug);
  if (!skillDir) {
    return { ok: false, message: `Invalid slug '${slug}': must be a simple kebab-case name without path separators.` };
  }
  if (!existsSync(skillDir)) {
    return { ok: false, message: `Skill '${slug}' not found in ${LOCAL_SKILLS_DIR}.` };
  }

  rmSync(skillDir, { recursive: true, force: true });
  return { ok: true, message: `Skill '${slug}' removed from ${skillDir}. It will no longer be available on your next message.` };
}
