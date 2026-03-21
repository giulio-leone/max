/**
 * Agent Harness — Anthropic-style two-phase harness for long-running projects.
 *
 * Phase 1 (Initializer): Scaffolds `.max-harness/` in the target project with
 * feature_list.json, progress.md, and init.sh. Does NOT implement features.
 *
 * Phase 2 (Coding Agent): Reads harness state, picks the next failing feature,
 * implements it, tests it, marks it passing, commits, and updates progress.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

// ── Types ────────────────────────────────────────────────────────────────────

export interface Feature {
  id: string;
  description: string;
  passes: boolean;
  /** Optional test command to verify this feature */
  testCommand?: string;
  /** Git commit SHA that implemented this feature */
  implementedAt?: string;
}

export interface FeatureList {
  projectGoal: string;
  features: Feature[];
  createdAt: string;
  updatedAt: string;
}

export interface ProgressEntry {
  timestamp: string;
  agent: "initializer" | "coding";
  action: string;
  details: string;
}

export type HarnessPhase = "init" | "coding" | "complete";

// ── Constants ────────────────────────────────────────────────────────────────

export const HARNESS_DIR = ".max-harness";
const FEATURE_LIST_FILE = "feature_list.json";
const PROGRESS_FILE = "progress.md";
const INIT_SCRIPT = "init.sh";

// ── Phase Detection ──────────────────────────────────────────────────────────

/**
 * Detect the current harness phase for a project directory.
 * - "init"     → no .max-harness/ directory exists yet
 * - "coding"   → harness exists, at least one feature is still failing
 * - "complete" → all features pass
 */
export function detectPhase(workingDir: string): HarnessPhase {
  const harnessPath = join(workingDir, HARNESS_DIR);
  const featureListPath = join(harnessPath, FEATURE_LIST_FILE);

  if (!existsSync(harnessPath) || !existsSync(featureListPath)) {
    return "init";
  }

  try {
    const featureList = readFeatureList(workingDir);
    const allPass = featureList.features.length > 0 && featureList.features.every((f) => f.passes);
    return allPass ? "complete" : "coding";
  } catch {
    return "init";
  }
}

// ── File I/O ─────────────────────────────────────────────────────────────────

/** Read and parse feature_list.json from a project's harness directory. */
export function readFeatureList(workingDir: string): FeatureList {
  const filePath = join(workingDir, HARNESS_DIR, FEATURE_LIST_FILE);
  const raw = readFileSync(filePath, "utf-8");
  return JSON.parse(raw) as FeatureList;
}

/** Read progress.md as a string. */
export function readProgress(workingDir: string): string {
  const filePath = join(workingDir, HARNESS_DIR, PROGRESS_FILE);
  if (!existsSync(filePath)) return "";
  return readFileSync(filePath, "utf-8");
}

/** Get the next failing feature (first one with passes=false). */
export function getNextFeature(workingDir: string): Feature | null {
  const featureList = readFeatureList(workingDir);
  return featureList.features.find((f) => !f.passes) ?? null;
}

/** Get a summary of harness status: total, passing, failing, next. */
export function getHarnessStatus(workingDir: string): {
  phase: HarnessPhase;
  total: number;
  passing: number;
  failing: number;
  percentComplete: number;
  nextFeature: Feature | null;
  projectGoal: string;
} {
  const phase = detectPhase(workingDir);

  if (phase === "init") {
    return {
      phase,
      total: 0,
      passing: 0,
      failing: 0,
      percentComplete: 0,
      nextFeature: null,
      projectGoal: "(not initialized)",
    };
  }

  const featureList = readFeatureList(workingDir);
  const passing = featureList.features.filter((f) => f.passes).length;
  const total = featureList.features.length;

  return {
    phase,
    total,
    passing,
    failing: total - passing,
    percentComplete: total > 0 ? Math.round((passing / total) * 100) : 0,
    nextFeature: featureList.features.find((f) => !f.passes) ?? null,
    projectGoal: featureList.projectGoal,
  };
}

// ── Prompt Generation ────────────────────────────────────────────────────────

/**
 * Generate the system prompt prefix for the Initializer Agent.
 * This agent's ONLY job is to decompose the user's goal into a feature list
 * and scaffold the harness directory. It must NOT implement any features.
 */
export function getInitializerPrompt(userGoal: string, workingDir: string): string {
  return `You are a **Project Initializer Agent**. Your job is to set up a structured project harness for long-running development.

## Your ONLY Goals

1. **Understand the project**: Read existing files in the working directory to understand what already exists.
2. **Decompose into features**: Break down the user's goal into small, independently testable features.
3. **Create the harness directory**: Create \`.max-harness/\` with the required files.
4. **Commit your work**: Make a git commit with the scaffolding.

## CRITICAL RULES

- **DO NOT implement any features.** You only scaffold and decompose.
- **DO NOT modify any existing source code.** Only create files in \`.max-harness/\`.
- Features should be small enough that a single agent session can implement one.
- Each feature must have a clear test criteria (how to verify it works).
- Order features by dependency — foundational features first.

## Files to Create in \`.max-harness/\`

### 1. \`feature_list.json\`
\`\`\`json
{
  "projectGoal": "<the user's goal in one sentence>",
  "features": [
    {
      "id": "feature-1",
      "description": "Short description of what this feature does",
      "passes": false,
      "testCommand": "optional shell command to verify"
    }
  ],
  "createdAt": "<ISO timestamp>",
  "updatedAt": "<ISO timestamp>"
}
\`\`\`

### 2. \`progress.md\`
\`\`\`markdown
# Project Progress

## Goal
<user's goal>

## Log
- [<timestamp>] Initializer: Created harness with N features
\`\`\`

### 3. \`init.sh\` (if needed)
A shell script that sets up the development environment (install dependencies, start dev server, etc.).
Make it executable (\`chmod +x\`).

## User's Goal

${userGoal}

## Working Directory

${workingDir}

Begin by reading the existing project structure, then create the harness files.`;
}

/**
 * Generate the system prompt prefix for the Coding Agent.
 * This agent implements ONE feature at a time, tests it, and commits.
 */
export function getCodingAgentPrompt(workingDir: string): string {
  const featureList = readFeatureList(workingDir);
  const progress = readProgress(workingDir);
  const nextFeature = featureList.features.find((f) => !f.passes);

  if (!nextFeature) {
    return `All features are passing! The project is complete. Review the feature list and progress log, then report back.`;
  }

  const passingCount = featureList.features.filter((f) => f.passes).length;
  const totalCount = featureList.features.length;

  // Build context about already-passing features
  const passingFeatures = featureList.features
    .filter((f) => f.passes)
    .map((f) => `  ✅ ${f.id}: ${f.description}`)
    .join("\n");

  const remainingFeatures = featureList.features
    .filter((f) => !f.passes)
    .map((f, i) => `  ${i === 0 ? "👉" : "⬚"} ${f.id}: ${f.description}`)
    .join("\n");

  return `You are a **Coding Agent** working on a structured project with a harness.

## Project Goal
${featureList.projectGoal}

## Current Status
Progress: ${passingCount}/${totalCount} features passing (${Math.round((passingCount / totalCount) * 100)}%)

### Passing Features
${passingFeatures || "  (none yet)"}

### Remaining Features
${remainingFeatures}

## Your Current Task

Implement **exactly one feature**: \`${nextFeature.id}\`

> ${nextFeature.description}

${nextFeature.testCommand ? `**Test command**: \`${nextFeature.testCommand}\`` : ""}

## Rules

1. **ONE feature only.** Do not work on other features.
2. **Test your work.** ${nextFeature.testCommand ? `Run \`${nextFeature.testCommand}\` to verify.` : "Verify the feature works correctly before marking it done."}
3. **Update harness files** after implementation:
   - Update \`.max-harness/feature_list.json\`: set \`passes: true\` for \`${nextFeature.id}\`, update \`updatedAt\`
   - Append to \`.max-harness/progress.md\`: log what you did
4. **Git commit** with a descriptive message: \`feat(${nextFeature.id}): <summary>\`
5. **Leave the codebase clean.** No debug logs, no commented-out code, no broken tests.
6. **Don't break existing features.** If you have test commands for passing features, verify they still work.

## Recent Progress
\`\`\`
${progress.slice(-2000) || "(no previous progress)"}
\`\`\`

## Working Directory
${workingDir}

Begin by reviewing the existing code and understanding the current state, then implement ${nextFeature.id}.`;
}

// ── Scaffold Helper (for programmatic creation) ──────────────────────────────

/**
 * Create the harness directory structure programmatically.
 * Used when the orchestrator wants to bootstrap without a full initializer session.
 */
export function scaffoldHarness(
  workingDir: string,
  projectGoal: string,
  features: Omit<Feature, "passes" | "implementedAt">[]
): void {
  const harnessPath = join(workingDir, HARNESS_DIR);
  mkdirSync(harnessPath, { recursive: true });

  const now = new Date().toISOString();

  const featureList: FeatureList = {
    projectGoal,
    features: features.map((f) => ({ ...f, passes: false })),
    createdAt: now,
    updatedAt: now,
  };

  writeFileSync(
    join(harnessPath, FEATURE_LIST_FILE),
    JSON.stringify(featureList, null, 2),
    "utf-8"
  );

  const progressContent = `# Project Progress

## Goal
${projectGoal}

## Log
- [${now}] Initializer: Created harness with ${features.length} features
`;

  writeFileSync(join(harnessPath, PROGRESS_FILE), progressContent, "utf-8");
}
