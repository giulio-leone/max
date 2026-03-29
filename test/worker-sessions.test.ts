import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

async function loadModules() {
  vi.resetModules();
  const workerSessions = await import("../src/copilot/worker-sessions.js");
  const db = await import("../src/store/db.js");
  return { workerSessions, db };
}

describe("worker session helpers", () => {
  let previousHome: string | undefined;
  let tempHome: string;

  beforeEach(() => {
    previousHome = process.env.HOME;
    tempHome = mkdtempSync(join(tmpdir(), "max-worker-sessions-"));
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

  it("discovers Copilot machine sessions from the session-state directory", async () => {
    const sessionStateDir = join(tempHome, ".copilot", "session-state");
    mkdirSync(join(sessionStateDir, "session-a"), { recursive: true });
    mkdirSync(join(sessionStateDir, "session-b"), { recursive: true });

    writeFileSync(
      join(sessionStateDir, "session-a", "workspace.yaml"),
      `id: session-a\ncwd: /tmp/project-a\nsummary: Project A\nupdated_at: 2025-01-03T10:00:00.000Z\n`,
      "utf-8"
    );
    writeFileSync(
      join(sessionStateDir, "session-b", "workspace.yaml"),
      `id: session-b\ncwd: /tmp/project-b\nsummary: Project B\nupdated_at: 2025-01-02T10:00:00.000Z\n`,
      "utf-8"
    );

    const { workerSessions } = await loadModules();
    const result = workerSessions.discoverMachineSessions({ cwdFilter: "project-a", limit: 10 });

    expect(result.ok).toBe(true);
    expect(result.sessions).toEqual([
      {
        id: "session-a",
        workingDir: "/tmp/project-a",
        summary: "Project A",
        updatedAt: "2025-01-03T10:00:00.000Z",
      },
    ]);
  });

  it("recovers persisted worker sessions and marks them idle", async () => {
    const { workerSessions, db } = await loadModules();
    db.upsertWorkerSession({
      name: "machine-main",
      copilotSessionId: "session-123",
      workingDir: "/tmp/max",
      status: "running",
      lastOutput: "Previously attached",
      sessionSource: "machine",
      workspaceLabel: "max-core",
      activationMode: "pinned",
      routingHint: "frontend triage",
      queueHint: "docs-review",
    });

    const workers = new Map();
    const client = {
      resumeSession: vi.fn(async () => ({ destroy: vi.fn() })),
    } as any;

    const result = await workerSessions.recoverPersistedWorkerSessions({
      client,
      workers,
    });

    expect(result.recovered).toBe(1);
    expect(result.cleared).toBe(0);
    expect(client.resumeSession).toHaveBeenCalledWith(
      "session-123",
      expect.objectContaining({ model: expect.any(String) })
    );
    expect(workers.get("machine-main")).toMatchObject({
      name: "machine-main",
      workingDir: "/tmp/max",
      status: "idle",
      lastOutput: "Previously attached",
      sessionSource: "machine",
      copilotSessionId: "session-123",
      workspaceLabel: "max-core",
      activationMode: "pinned",
      routingHint: "frontend triage",
      queueHint: "docs-review",
    });
    expect(db.listPersistedWorkerSessions()).toEqual([
      expect.objectContaining({
        name: "machine-main",
        status: "idle",
        sessionSource: "machine",
        workspaceLabel: "max-core",
        activationMode: "pinned",
        routingHint: "frontend triage",
        queueHint: "docs-review",
      }),
    ]);
  });

  it("clears stale persisted worker sessions that can no longer be resumed", async () => {
    const { workerSessions, db } = await loadModules();
    db.upsertWorkerSession({
      name: "stale-worker",
      copilotSessionId: "session-stale",
      workingDir: "/tmp/stale",
      status: "idle",
      sessionSource: "max",
    });

    const client = {
      resumeSession: vi.fn(async () => {
        throw new Error("session missing");
      }),
    } as any;

    const result = await workerSessions.recoverPersistedWorkerSessions({
      client,
      workers: new Map(),
    });

    expect(result.recovered).toBe(0);
    expect(result.cleared).toBe(1);
    expect(result.failures).toEqual([
      expect.objectContaining({
        name: "stale-worker",
        error: "session missing",
      }),
    ]);
    expect(db.listPersistedWorkerSessions()).toEqual([]);
  });

  it("keeps originChannel runtime-only across managed session attach and recovery", async () => {
    const { workerSessions, db } = await loadModules();
    const liveWorkers = new Map<string, any>();
    const attachClient = {
      resumeSession: vi.fn(async () => ({ destroy: vi.fn() })),
    } as any;

    const attached = await workerSessions.attachManagedSession({
      client: attachClient,
      workers: liveWorkers,
      sessionId: "session-channel",
      name: "machine-channel",
      workingDir: "/tmp/max/channel",
      originChannel: "tui",
      sessionSource: "machine",
    });

    expect(attached).toMatchObject({
      name: "machine-channel",
      originChannel: "tui",
      sessionSource: "machine",
    });
    expect(liveWorkers.get("machine-channel")).toMatchObject({
      originChannel: "tui",
    });

    const persisted = db.listPersistedWorkerSessions();
    expect(persisted).toEqual([
      expect.objectContaining({
        name: "machine-channel",
        copilotSessionId: "session-channel",
        sessionSource: "machine",
      }),
    ]);
    expect(persisted[0]).not.toHaveProperty("originChannel");

    const recoveredWorkers = new Map<string, any>();
    const recoverClient = {
      resumeSession: vi.fn(async () => ({ destroy: vi.fn() })),
    } as any;

    const recovered = await workerSessions.recoverPersistedWorkerSessions({
      client: recoverClient,
      workers: recoveredWorkers,
    });

    expect(recovered.recovered).toBe(1);
    expect(recoveredWorkers.get("machine-channel")).toMatchObject({
      name: "machine-channel",
      sessionSource: "machine",
    });
    expect(recoveredWorkers.get("machine-channel")?.originChannel).toBeUndefined();
  });

  it("updates persisted metadata and ranks managed sessions by routing hints", async () => {
    const { workerSessions, db } = await loadModules();
    db.upsertWorkerSession({
      name: "machine-docs",
      copilotSessionId: "session-docs",
      workingDir: "/tmp/max/docs",
      status: "idle",
      sessionSource: "machine",
      workspaceLabel: "docs",
      activationMode: "manual",
      routingHint: "documentation",
      queueHint: "docs-review",
    });

    const workers = new Map<string, any>([
      ["machine-docs", {
        name: "machine-docs",
        session: { destroy: vi.fn() },
        workingDir: "/tmp/max/docs",
        status: "idle",
        sessionSource: "machine",
        copilotSessionId: "session-docs",
        workspaceLabel: "docs",
        activationMode: "manual",
        routingHint: "documentation",
        queueHint: "docs-review",
      }],
      ["machine-app", {
        name: "machine-app",
        session: { destroy: vi.fn() },
        workingDir: "/tmp/max/app",
        status: "idle",
        sessionSource: "machine",
        copilotSessionId: "session-app",
        workspaceLabel: "app",
        activationMode: "pinned",
        routingHint: "frontend triage",
        queueHint: "ui-review",
      }],
    ]);

    const updated = workerSessions.updateManagedSessionMetadata("machine-docs", workers, {
      workspaceLabel: "docs-core",
      activationMode: "suggested",
      routingHint: "frontend triage",
      queueHint: "docs-review",
    });

    expect(updated).toMatchObject({
      workspaceLabel: "docs-core",
      activationMode: "suggested",
      routingHint: "frontend triage",
      queueHint: "docs-review",
    });
    expect(db.listPersistedWorkerSessions()).toEqual([
      expect.objectContaining({
        name: "machine-docs",
        workspaceLabel: "docs-core",
        activationMode: "suggested",
        routingHint: "frontend triage",
        queueHint: "docs-review",
      }),
    ]);

    const ranked = workerSessions.routeManagedSessions(workers, {
      workspaceLabel: "docs",
      routingHint: "frontend",
      queueHint: "docs",
    });

    expect(ranked.map((worker: { name: string }) => worker.name)).toEqual([
      "machine-docs",
      "machine-app",
    ]);
  });

  it("persists direct operator chat for attached native sessions", async () => {
    const { workerSessions, db } = await loadModules();
    db.upsertWorkerSession({
      name: "machine-chat",
      copilotSessionId: "session-chat",
      workingDir: "/tmp/max/chat",
      status: "idle",
      sessionSource: "machine",
    });
    db.addSessionMemory("machine-chat", "project", "This session owns the docs workspace.");

    const sendAndWait = vi.fn(async () => ({ data: { content: "Native session reply" } }));

    const workers = new Map<string, any>([
      ["machine-chat", {
        name: "machine-chat",
        session: {
          sendAndWait,
          destroy: vi.fn(),
        },
        workingDir: "/tmp/max/chat",
        status: "idle",
        sessionSource: "machine",
        copilotSessionId: "session-chat",
      }],
    ]);

    expect(workerSessions.getManagedSessionChatState("machine-chat", workers, 100)).toMatchObject({
      history: [],
    });

    const result = await workerSessions.sendManagedSessionChatMessage("machine-chat", "Hello native session", workers);

    expect(result.reply).toMatchObject({
      sessionName: "machine-chat",
      role: "assistant",
      content: "Native session reply",
    });
    expect(result.history.map((message: { role: string; content: string }) => [message.role, message.content])).toEqual([
      ["user", "Hello native session"],
      ["assistant", "Native session reply"],
    ]);
    expect(db.listNativeSessionMessages("machine-chat").map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(sendAndWait).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt: expect.stringContaining("This session owns the docs workspace."),
      }),
      expect.any(Number)
    );
    expect(workers.get("machine-chat")).toMatchObject({
      status: "idle",
      lastOutput: "Native session reply",
    });
  });

  it("keeps agent-scoped memories isolated from session-scoped memories", async () => {
    const { db } = await loadModules();
    const agentMemoryId = db.addAgentMemory(7, "project", "Docs Agent owns release note publishing.");
    const sessionMemoryId = db.addSessionMemory("machine-chat", "project", "Native chat owns docs triage.");

    expect(db.searchAgentMemories(7)).toEqual([
      expect.objectContaining({
        id: agentMemoryId,
        scopeType: "agent",
        scopeId: "7",
        content: "Docs Agent owns release note publishing.",
      }),
    ]);
    expect(db.searchSessionMemories("machine-chat")).toEqual([
      expect.objectContaining({
        id: sessionMemoryId,
        scopeType: "session",
        scopeId: "machine-chat",
        content: "Native chat owns docs triage.",
      }),
    ]);
    expect(db.getAgentMemorySummary(7)).toContain("Docs Agent owns release note publishing.");
    expect(db.getSessionMemorySummary("machine-chat")).toContain("Native chat owns docs triage.");
    expect(db.searchSessionMemories("machine-chat", "release")).toEqual([]);
    expect(db.removeAgentMemory(7, agentMemoryId)).toBe(true);
    expect(db.searchAgentMemories(7)).toEqual([]);
  });
});
