import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function loadSkillsModule() {
  vi.resetModules();
  return await import("../src/copilot/skills.js");
}

describe("skill management helpers", () => {
  let previousHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "max-skills-"));
    process.env.HOME = tempHome;
    vi.resetModules();
  });

  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    rmSync(tempHome, { recursive: true, force: true });
    vi.resetModules();
  });

  it("creates, reads, and validates a local skill", async () => {
    const { createSkill, readSkill, validateSkill } = await loadSkillsModule();

    const result = createSkill(
      "release-notes",
      "Release Notes",
      "Summarize shipped changes",
      "Inspect the latest changelog and summarize the release."
    );

    expect(result).toContain("created");

    const detail = readSkill("release-notes", "local");
    expect(detail.ok).toBe(true);
    expect(detail.skill?.name).toBe("Release Notes");
    expect(detail.skill?.description).toBe("Summarize shipped changes");
    expect(detail.skill?.instructions).toContain("Inspect the latest changelog");

    expect(validateSkill("release-notes", "local")).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("updates a local skill while preserving unrelated frontmatter", async () => {
    const { readSkill, updateSkill } = await loadSkillsModule();
    const skillDir = join(tempHome, ".max", "skills", "browser-check");
    mkdirSync(skillDir, { recursive: true });
    writeFileSync(
      join(skillDir, "SKILL.md"),
      `---
name: Browser Check
description: Watch a page
metadata: {"emoji":"🕸️"}
---

Check the browser and report the page title.
`
    );

    const updated = updateSkill("browser-check", {
      name: "Browser Monitor",
      instructions: "Open the browser, inspect the page, and report the result.",
    });

    expect(updated.ok).toBe(true);
    expect(updated.skill?.name).toBe("Browser Monitor");
    expect(updated.skill?.description).toBe("Watch a page");
    expect(updated.skill?.instructions).toBe("Open the browser, inspect the page, and report the result.");

    const skillMd = readFileSync(join(skillDir, "SKILL.md"), "utf-8");
    expect(skillMd).toContain('metadata: {"emoji":"🕸️"}');
    expect(skillMd).toContain("name: Browser Monitor");
    expect(skillMd).toContain("description: Watch a page");

    const detail = readSkill("browser-check", "local");
    expect(detail.skill?.frontmatter.metadata).toBe('{"emoji":"🕸️"}');
  });

  it("rejects invalid updates that remove all instructions", async () => {
    const { createSkill, updateSkill } = await loadSkillsModule();

    createSkill(
      "daily-sync",
      "Daily Sync",
      "Run the daily summary",
      "Generate the daily sync summary for the operator."
    );

    const updated = updateSkill("daily-sync", {
      instructions: "   ",
    });

    expect(updated.ok).toBe(false);
    expect(updated.errors).toContain("Skill must include instructions after the frontmatter.");
  });
});
