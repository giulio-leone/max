import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  detectPhase,
  readFeatureList,
  readProgress,
  getNextFeature,
  getHarnessStatus,
  getInitializerPrompt,
  getCodingAgentPrompt,
  scaffoldHarness,
  HARNESS_DIR,
  type FeatureList,
} from "../src/copilot/harness.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `max-harness-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeFeatureList(dir: string, fl: FeatureList): void {
  const harnessPath = join(dir, HARNESS_DIR);
  mkdirSync(harnessPath, { recursive: true });
  writeFileSync(join(harnessPath, "feature_list.json"), JSON.stringify(fl, null, 2), "utf-8");
}

function writeProgress(dir: string, content: string): void {
  const harnessPath = join(dir, HARNESS_DIR);
  mkdirSync(harnessPath, { recursive: true });
  writeFileSync(join(harnessPath, "progress.md"), content, "utf-8");
}

function sampleFeatureList(overrides?: Partial<FeatureList>): FeatureList {
  return {
    projectGoal: "Build a REST API",
    features: [
      { id: "auth", description: "JWT authentication", passes: false },
      { id: "users-crud", description: "Users CRUD endpoints", passes: false },
      { id: "rate-limit", description: "Rate limiting middleware", passes: false },
    ],
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("harness — phase detection", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns 'init' when no .max-harness/ directory exists", () => {
    expect(detectPhase(dir)).toBe("init");
  });

  it("returns 'init' when .max-harness/ exists but no feature_list.json", () => {
    mkdirSync(join(dir, HARNESS_DIR));
    expect(detectPhase(dir)).toBe("init");
  });

  it("returns 'coding' when features exist with at least one failing", () => {
    writeFeatureList(dir, sampleFeatureList());
    expect(detectPhase(dir)).toBe("coding");
  });

  it("returns 'coding' when some features pass but not all", () => {
    const fl = sampleFeatureList();
    fl.features[0].passes = true;
    writeFeatureList(dir, fl);
    expect(detectPhase(dir)).toBe("coding");
  });

  it("returns 'complete' when all features pass", () => {
    const fl = sampleFeatureList();
    fl.features.forEach((f) => (f.passes = true));
    writeFeatureList(dir, fl);
    expect(detectPhase(dir)).toBe("complete");
  });

  it("returns 'init' when feature_list.json is corrupt", () => {
    const harnessPath = join(dir, HARNESS_DIR);
    mkdirSync(harnessPath, { recursive: true });
    writeFileSync(join(harnessPath, "feature_list.json"), "NOT JSON", "utf-8");
    expect(detectPhase(dir)).toBe("init");
  });
});

describe("harness — file I/O", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("readFeatureList parses valid JSON", () => {
    const expected = sampleFeatureList();
    writeFeatureList(dir, expected);
    const result = readFeatureList(dir);
    expect(result.projectGoal).toBe("Build a REST API");
    expect(result.features).toHaveLength(3);
    expect(result.features[0].id).toBe("auth");
  });

  it("readFeatureList throws on missing file", () => {
    expect(() => readFeatureList(dir)).toThrow();
  });

  it("readProgress returns empty string when no file", () => {
    expect(readProgress(dir)).toBe("");
  });

  it("readProgress reads content", () => {
    writeProgress(dir, "# Progress\n\n- did stuff");
    const content = readProgress(dir);
    expect(content).toContain("did stuff");
  });
});

describe("harness — getNextFeature", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns first failing feature", () => {
    writeFeatureList(dir, sampleFeatureList());
    const next = getNextFeature(dir);
    expect(next).not.toBeNull();
    expect(next!.id).toBe("auth");
  });

  it("skips passing features", () => {
    const fl = sampleFeatureList();
    fl.features[0].passes = true;
    writeFeatureList(dir, fl);
    const next = getNextFeature(dir);
    expect(next!.id).toBe("users-crud");
  });

  it("returns null when all pass", () => {
    const fl = sampleFeatureList();
    fl.features.forEach((f) => (f.passes = true));
    writeFeatureList(dir, fl);
    expect(getNextFeature(dir)).toBeNull();
  });
});

describe("harness — getHarnessStatus", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns zeroed status for uninitialized project", () => {
    const status = getHarnessStatus(dir);
    expect(status.phase).toBe("init");
    expect(status.total).toBe(0);
    expect(status.percentComplete).toBe(0);
  });

  it("calculates correct percentages", () => {
    const fl = sampleFeatureList();
    fl.features[0].passes = true; // 1 of 3
    writeFeatureList(dir, fl);

    const status = getHarnessStatus(dir);
    expect(status.phase).toBe("coding");
    expect(status.total).toBe(3);
    expect(status.passing).toBe(1);
    expect(status.failing).toBe(2);
    expect(status.percentComplete).toBe(33);
    expect(status.nextFeature!.id).toBe("users-crud");
  });

  it("reports 100% when complete", () => {
    const fl = sampleFeatureList();
    fl.features.forEach((f) => (f.passes = true));
    writeFeatureList(dir, fl);

    const status = getHarnessStatus(dir);
    expect(status.phase).toBe("complete");
    expect(status.percentComplete).toBe(100);
    expect(status.nextFeature).toBeNull();
  });
});

describe("harness — prompt generation", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("getInitializerPrompt includes user goal and working dir", () => {
    const prompt = getInitializerPrompt("Build a REST API", dir);
    expect(prompt).toContain("Build a REST API");
    expect(prompt).toContain(dir);
    expect(prompt).toContain("Project Initializer Agent");
    expect(prompt).toContain("feature_list.json");
    expect(prompt).toContain("DO NOT implement");
  });

  it("getCodingAgentPrompt targets next failing feature", () => {
    const fl = sampleFeatureList();
    fl.features[0].passes = true;
    writeFeatureList(dir, fl);
    writeProgress(dir, "# Progress\n- [2025] init done");

    const prompt = getCodingAgentPrompt(dir);
    expect(prompt).toContain("users-crud");
    expect(prompt).toContain("Coding Agent");
    expect(prompt).toContain("1/3 features passing");
    expect(prompt).toContain("✅ auth");
  });

  it("getCodingAgentPrompt returns complete message when all pass", () => {
    const fl = sampleFeatureList();
    fl.features.forEach((f) => (f.passes = true));
    writeFeatureList(dir, fl);

    const prompt = getCodingAgentPrompt(dir);
    expect(prompt).toContain("complete");
  });
});

describe("harness — scaffoldHarness", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates .max-harness/ with feature_list.json and progress.md", () => {
    scaffoldHarness(dir, "Test project", [
      { id: "feat-a", description: "Feature A" },
      { id: "feat-b", description: "Feature B" },
    ]);

    expect(existsSync(join(dir, HARNESS_DIR, "feature_list.json"))).toBe(true);
    expect(existsSync(join(dir, HARNESS_DIR, "progress.md"))).toBe(true);

    const fl = readFeatureList(dir);
    expect(fl.projectGoal).toBe("Test project");
    expect(fl.features).toHaveLength(2);
    expect(fl.features[0].passes).toBe(false);
    expect(fl.features[1].passes).toBe(false);
  });

  it("idempotent — can be called on existing harness dir", () => {
    scaffoldHarness(dir, "V1", [{ id: "a", description: "A" }]);
    scaffoldHarness(dir, "V2", [{ id: "b", description: "B" }]);

    const fl = readFeatureList(dir);
    expect(fl.projectGoal).toBe("V2");
    expect(fl.features[0].id).toBe("b");
  });

  it("sets all features to passes:false initially", () => {
    scaffoldHarness(dir, "Goal", [
      { id: "x", description: "X", testCommand: "npm test" },
    ]);

    const fl = readFeatureList(dir);
    expect(fl.features[0].passes).toBe(false);
    expect(fl.features[0].testCommand).toBe("npm test");
  });

  it("transitions phase from init to coding", () => {
    expect(detectPhase(dir)).toBe("init");
    scaffoldHarness(dir, "Goal", [{ id: "x", description: "X" }]);
    expect(detectPhase(dir)).toBe("coding");
  });
});
