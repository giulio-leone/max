/**
 * E2E integration tests for the harness tool flow.
 *
 * Mocks the Copilot SDK client and SQLite database, then exercises the actual
 * tool handlers through a realistic multi-phase harness scenario:
 *   1. create_worker_session with harness:true → init phase
 *   2. scaffoldHarness to simulate init agent output
 *   3. harness_status → shows progress
 *   4. continue_harness → coding phase
 *   5. Simulate feature completion → auto-continue detection
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// ── Mock the DB module before importing tools ────────────────────────────────

vi.mock("../src/store/db.js", () => {
  const stmtMock = { run: vi.fn(), all: vi.fn(() => []), get: vi.fn() };
  return {
    getDb: vi.fn(() => ({ prepare: vi.fn(() => stmtMock) })),
    addMemory: vi.fn(),
    searchMemories: vi.fn(() => []),
    removeMemory: vi.fn(),
    listPersistedWorkerSessions: vi.fn(() => []),
    upsertWorkerSession: vi.fn(),
    updateWorkerSessionStatus: vi.fn(),
    updateWorkerSessionMetadata: vi.fn(),
    deleteWorkerSession: vi.fn(),
  };
});

// Mock the orchestrator's getCurrentSourceChannel
vi.mock("../src/copilot/orchestrator.js", () => ({
  getCurrentSourceChannel: vi.fn(() => "tui"),
}));

// Mock the router module
vi.mock("../src/copilot/router.js", () => ({
  getRouterConfig: vi.fn(() => ({ enabled: false })),
  updateRouterConfig: vi.fn(),
}));

// Mock the config module
vi.mock("../src/config.js", () => ({
  config: {
    copilotModel: "test-model",
    workerTimeoutMs: 300_000,
    selfEditEnabled: false,
  },
  persistModel: vi.fn(),
}));

// Mock paths
vi.mock("../src/paths.js", () => ({
  SESSIONS_DIR: "/tmp/max-test-sessions",
}));

// Mock skills
vi.mock("../src/copilot/skills.js", () => ({
  listSkills: vi.fn(() => []),
  createSkill: vi.fn(),
  removeSkill: vi.fn(),
}));

import { createTools, type ToolDeps, type WorkerInfo } from "../src/copilot/tools.js";
import {
  scaffoldHarness,
  readFeatureList,
  getHarnessStatus,
  detectPhase,
  HARNESS_DIR,
  type FeatureList,
} from "../src/copilot/harness.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  const dir = join(tmpdir(), `max-e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Create a mock CopilotSession */
function mockSession() {
  let resolveWait: ((v: any) => void) | undefined;
  return {
    sessionId: `session-${Math.random().toString(36).slice(2)}`,
    sendAndWait: vi.fn(() => new Promise((resolve) => { resolveWait = resolve; })),
    destroy: vi.fn(async () => {}),
    _resolve(result: string) {
      resolveWait?.({ data: { content: result } });
    },
  };
}

/** Create a mock CopilotClient */
function mockClient() {
  const sessions: ReturnType<typeof mockSession>[] = [];
  return {
    createSession: vi.fn(async () => {
      const s = mockSession();
      sessions.push(s);
      return s;
    }),
    sessions,
  };
}

type ToolHandler = (args: Record<string, unknown>) => Promise<string>;

/** Extract a specific tool handler from the tools array */
function findTool(tools: ReturnType<typeof createTools>, name: string): ToolHandler {
  const tool = tools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool '${name}' not found`);
  return (tool as any).handler;
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("E2E: harness tool flow", () => {
  let dir: string;
  let client: ReturnType<typeof mockClient>;
  let workers: Map<string, WorkerInfo>;
  let completions: Array<{ name: string; result: string }>;
  let deps: ToolDeps;
  let tools: ReturnType<typeof createTools>;

  beforeEach(() => {
    dir = makeTmpDir();
    client = mockClient();
    workers = new Map();
    completions = [];
    deps = {
      client: client as any,
      workers,
      onWorkerComplete: (name, result) => completions.push({ name, result }),
    };
    tools = createTools(deps);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("create_worker_session with harness:true starts init phase in empty dir", async () => {
    const handler = findTool(tools, "create_worker_session");
    const resultPromise = handler({
      name: "harness-init",
      working_dir: dir,
      initial_prompt: "Build a todo app with auth",
      harness: true,
    });

    // The session should have been created
    expect(client.createSession).toHaveBeenCalledOnce();

    // Simulate the session completing
    const session = client.sessions[0];
    session._resolve("Initialized harness with 3 features");

    const result = await resultPromise;
    expect(result).toContain("harness-init");
    expect(result).toContain("harness:init");
  });

  it("create_worker_session with harness:true returns complete when all pass", async () => {
    // Pre-scaffold with all features passing
    scaffoldHarness(dir, "Done project", [
      { id: "a", description: "A" },
    ]);
    const fl = readFeatureList(dir);
    fl.features[0].passes = true;
    writeFileSync(
      join(dir, HARNESS_DIR, "feature_list.json"),
      JSON.stringify(fl, null, 2),
      "utf-8"
    );

    const handler = findTool(tools, "create_worker_session");
    const result = await handler({
      name: "test-complete",
      working_dir: dir,
      harness: true,
    });

    expect(result).toContain("complete");
    expect(result).toContain("all features pass");
    // Session IS created (before phase detection) but early-returns without sending work
    expect(client.createSession).toHaveBeenCalledOnce();
    expect(client.sessions[0].sendAndWait).not.toHaveBeenCalled();
  });

  it("harness_status shows progress after scaffolding", async () => {
    scaffoldHarness(dir, "Build API", [
      { id: "auth", description: "Auth module" },
      { id: "crud", description: "CRUD endpoints" },
      { id: "rate-limit", description: "Rate limiter" },
    ]);

    const handler = findTool(tools, "harness_status");
    const result = await handler({ working_dir: dir });

    expect(result).toContain("Harness Status");
    expect(result).toContain("Build API");
    expect(result).toContain("0/3");
    expect(result).toContain("auth");
  });

  it("harness_status returns helpful message for uninitialized dir", async () => {
    const handler = findTool(tools, "harness_status");
    const result = await handler({ working_dir: dir });

    expect(result).toContain("No harness found");
    expect(result).toContain("create_worker_session");
  });

  it("continue_harness dispatches coding agent for next feature", async () => {
    scaffoldHarness(dir, "Build API", [
      { id: "auth", description: "Auth module" },
      { id: "crud", description: "CRUD endpoints" },
    ]);

    const handler = findTool(tools, "continue_harness");
    const resultPromise = handler({ working_dir: dir });

    // A session should have been created for the coding agent
    expect(client.createSession).toHaveBeenCalledOnce();

    // Simulate the coding agent completing
    const session = client.sessions[0];
    session._resolve("Implemented auth module");

    const result = await resultPromise;
    expect(result).toContain("harness-auth");
    expect(result).toContain("Auth module");
    expect(result).toContain("0/2 features passing");

    // Worker should have been registered
    expect(workers.has("harness-auth")).toBe(true);
  });

  it("continue_harness returns complete when all features pass", async () => {
    scaffoldHarness(dir, "Done", [{ id: "x", description: "X" }]);
    const fl = readFeatureList(dir);
    fl.features[0].passes = true;
    writeFileSync(
      join(dir, HARNESS_DIR, "feature_list.json"),
      JSON.stringify(fl, null, 2),
      "utf-8"
    );

    const handler = findTool(tools, "continue_harness");
    const result = await handler({ working_dir: dir });

    expect(result).toContain("🎉");
    expect(result).toContain("1");
    expect(result).toContain("complete");
    expect(client.createSession).not.toHaveBeenCalled();
  });

  it("continue_harness refuses when no harness exists", async () => {
    const handler = findTool(tools, "continue_harness");
    const result = await handler({ working_dir: dir });

    expect(result).toContain("No harness found");
  });

  it("full lifecycle: init → scaffold → coding → complete", async () => {
    // Phase 1: Start init
    const createHandler = findTool(tools, "create_worker_session");
    const initPromise = createHandler({
      name: "my-project",
      working_dir: dir,
      initial_prompt: "Build a calculator with add and multiply",
      harness: true,
    });

    expect(detectPhase(dir)).toBe("init");
    const initSession = client.sessions[0];
    initSession._resolve("Created harness");
    await initPromise;

    // Simulate what the init agent would do
    scaffoldHarness(dir, "Build a calculator", [
      { id: "add", description: "Addition function" },
      { id: "multiply", description: "Multiplication function" },
    ]);

    expect(detectPhase(dir)).toBe("coding");

    // Phase 2a: First coding agent (add)
    const continueHandler = findTool(tools, "continue_harness");
    const coding1Promise = continueHandler({ working_dir: dir });

    const codingSession1 = client.sessions[1];
    codingSession1._resolve("Implemented add function");
    const coding1Result = await coding1Promise;
    expect(coding1Result).toContain("harness-add");

    // Simulate feature completion
    const fl = readFeatureList(dir);
    fl.features[0].passes = true;
    fl.updatedAt = new Date().toISOString();
    writeFileSync(
      join(dir, HARNESS_DIR, "feature_list.json"),
      JSON.stringify(fl, null, 2),
      "utf-8"
    );

    // Check status mid-way
    const statusHandler = findTool(tools, "harness_status");
    const midStatus = await statusHandler({ working_dir: dir });
    expect(midStatus).toContain("1/2");
    expect(midStatus).toContain("50%");

    // Clean up the first worker so continue_harness can create a new one
    workers.delete("harness-add");

    // Phase 2b: Second coding agent (multiply)
    const coding2Promise = continueHandler({ working_dir: dir });

    const codingSession2 = client.sessions[2];
    codingSession2._resolve("Implemented multiply function");
    const coding2Result = await coding2Promise;
    expect(coding2Result).toContain("harness-multiply");

    // Simulate final feature completion
    const fl2 = readFeatureList(dir);
    fl2.features[1].passes = true;
    fl2.updatedAt = new Date().toISOString();
    writeFileSync(
      join(dir, HARNESS_DIR, "feature_list.json"),
      JSON.stringify(fl2, null, 2),
      "utf-8"
    );

    // Final status
    expect(detectPhase(dir)).toBe("complete");
    const finalStatus = await statusHandler({ working_dir: dir });
    expect(finalStatus).toContain("2/2");
    expect(finalStatus).toContain("100%");

    // continue_harness should say done
    workers.delete("harness-multiply");
    const doneResult = await continueHandler({ working_dir: dir });
    expect(doneResult).toContain("🎉");
  });

  it("worker limit is enforced for harness workers", async () => {
    scaffoldHarness(dir, "Big project", [
      { id: "a", description: "A" },
    ]);

    // Fill up workers to the limit
    for (let i = 0; i < 5; i++) {
      workers.set(`worker-${i}`, {
        name: `worker-${i}`,
        session: {} as any,
        workingDir: "/tmp",
        status: "running",
      });
    }

    const handler = findTool(tools, "continue_harness");
    const result = await handler({ working_dir: dir });

    expect(result).toContain("Worker limit reached");
  });

  it("duplicate harness worker name is rejected", async () => {
    scaffoldHarness(dir, "Project", [
      { id: "auth", description: "Auth" },
    ]);

    // Pre-register a worker with the expected name
    workers.set("harness-auth", {
      name: "harness-auth",
      session: {} as any,
      workingDir: dir,
      status: "running",
    });

    const handler = findTool(tools, "continue_harness");
    const result = await handler({ working_dir: dir });

    expect(result).toContain("already exists");
  });
});

describe("E2E: auto-continue detection", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("feedBackgroundResult appends auto-continue when features remain", async () => {
    // This tests the orchestrator auto-continue logic indirectly via
    // the harness status functions it calls
    scaffoldHarness(dir, "API", [
      { id: "auth", description: "Auth" },
      { id: "crud", description: "CRUD" },
    ]);

    const status = getHarnessStatus(dir);
    expect(status.phase).toBe("coding");
    expect(status.failing).toBe(2);

    // Simulate what feedBackgroundResult would build
    const prompt = `[Background task completed] Worker 'harness-auth' finished:\n\nImplemented auth`;
    const phase = detectPhase(dir);
    expect(phase).toBe("coding");

    // The orchestrator would append this:
    const next = status.nextFeature;
    expect(next).not.toBeNull();
    expect(next!.id).toBe("auth");

    const autoContinueHint = `[Harness auto-continue] ${status.passing}/${status.total} features passing (${status.percentComplete}%). ` +
      `Next feature: \`${next!.id}\` — ${next!.description}. ` +
      `Use \`continue_harness\` with working_dir="${dir}" to proceed.`;

    expect(autoContinueHint).toContain("continue_harness");
    expect(autoContinueHint).toContain("0/2");
  });

  it("feedBackgroundResult detects completion", async () => {
    scaffoldHarness(dir, "Done", [
      { id: "only", description: "Only feature" },
    ]);

    // Mark the only feature as passing
    const fl = readFeatureList(dir);
    fl.features[0].passes = true;
    writeFileSync(
      join(dir, HARNESS_DIR, "feature_list.json"),
      JSON.stringify(fl, null, 2),
      "utf-8"
    );

    const phase = detectPhase(dir);
    expect(phase).toBe("complete");

    const status = getHarnessStatus(dir);
    expect(status.percentComplete).toBe(100);
  });
});
