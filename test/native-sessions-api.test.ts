import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-native-api-${Math.random().toString(36).slice(2)}`;
  const apiToken = "test-token";
  const apiTokenPath = `${tempHome}/api-token`;
  const workers = new Map();

  return {
    tempHome,
    apiToken,
    apiTokenPath,
    workers,
    nativeSessionMocks: {
      attachManagedSession: vi.fn(),
      detachManagedSession: vi.fn(),
      discoverMachineSessions: vi.fn(),
      findMachineSessionById: vi.fn(),
      getManagedSessionChatState: vi.fn(),
      listManagedMachineWorkers: vi.fn(),
      routeManagedSessions: vi.fn(),
      sendManagedSessionChatMessage: vi.fn(),
      updateManagedSessionMetadata: vi.fn(),
    },
    getClient: vi.fn(async () => ({ label: "client" })),
  };
});

vi.mock("../src/copilot/orchestrator.js", () => ({
  sendToOrchestrator: vi.fn(),
  getWorkers: vi.fn(() => hoisted.workers),
  cancelCurrentMessage: vi.fn(async () => false),
  getLastRouteResult: vi.fn(() => null),
}));

vi.mock("../src/copilot/client.js", () => ({
  getClient: hoisted.getClient,
}));

vi.mock("../src/copilot/worker-sessions.js", () => ({
  attachManagedSession: hoisted.nativeSessionMocks.attachManagedSession,
  detachManagedSession: hoisted.nativeSessionMocks.detachManagedSession,
  discoverMachineSessions: hoisted.nativeSessionMocks.discoverMachineSessions,
  findMachineSessionById: hoisted.nativeSessionMocks.findMachineSessionById,
  findManagedMachineWorker: vi.fn((name: string) => hoisted.workers.get(name)),
  getManagedSessionChatState: hoisted.nativeSessionMocks.getManagedSessionChatState,
  listManagedMachineWorkers: hoisted.nativeSessionMocks.listManagedMachineWorkers,
  routeManagedSessions: hoisted.nativeSessionMocks.routeManagedSessions,
  sendManagedSessionChatMessage: hoisted.nativeSessionMocks.sendManagedSessionChatMessage,
  updateManagedSessionMetadata: hoisted.nativeSessionMocks.updateManagedSessionMetadata,
}));

vi.mock("../src/telegram/bot.js", () => ({
  sendPhoto: vi.fn(async () => undefined),
}));

vi.mock("../src/config.js", () => ({
  config: {
    apiPort: 7777,
    copilotModel: "test-model",
  },
  persistModel: vi.fn(),
}));

vi.mock("../src/copilot/router.js", () => ({
  getRouterConfig: vi.fn(() => ({ enabled: false })),
  updateRouterConfig: vi.fn((body: unknown) => body),
}));

vi.mock("../src/copilot/models.js", () => ({
  listAvailableModels: vi.fn(async () => []),
}));

vi.mock("../src/store/db.js", () => ({
  CHANNEL_ACCOUNT_TYPES: ["telegram", "tui", "background"],
  addAgentMemory: vi.fn(),
  addSessionMemory: vi.fn(() => 1),
  createChannel: vi.fn(),
  createChannelAccount: vi.fn(),
  deleteChannel: vi.fn(),
  deleteChannelAccount: vi.fn(),
  getChannel: vi.fn(),
  getChannelAccount: vi.fn(),
  isChannelAccountType: (value: unknown) => ["telegram", "tui", "background"].includes(String(value)),
  listChannelAccounts: vi.fn(() => []),
  listChannelInbox: vi.fn(() => []),
  listChannels: vi.fn(() => []),
  removeAgentMemory: vi.fn(),
  removeSessionMemory: vi.fn(() => true),
  searchAgentMemories: vi.fn(() => []),
  searchMemories: vi.fn(() => []),
  searchSessionMemories: vi.fn(() => []),
  updateChannel: vi.fn(),
  updateChannelAccount: vi.fn(),
}));

vi.mock("../src/control-plane/store.js", () => ({
  createAgent: vi.fn(),
  deleteAgent: vi.fn(),
  deleteProject: vi.fn(),
  deleteSchedule: vi.fn(),
  deleteTask: vi.fn(),
  createProject: vi.fn(),
  createSchedule: vi.fn(),
  createTask: vi.fn(),
  getAgent: vi.fn(() => ({ id: 1 })),
  getControlPlaneOverview: vi.fn(() => ({})),
  listAgents: vi.fn(() => []),
  listHeartbeats: vi.fn(() => []),
  listProjects: vi.fn(() => []),
  listSchedules: vi.fn(() => []),
  listTasks: vi.fn(() => []),
  pingAgent: vi.fn(),
  setScheduleEnabled: vi.fn(),
  updateAgent: vi.fn(),
  updateProject: vi.fn(),
  updateSchedule: vi.fn(),
  updateTask: vi.fn(),
}));

vi.mock("../src/control-plane/runtime.js", () => ({
  forgetAgentRuntime: vi.fn(),
  getAgentChatState: vi.fn(() => ({ messages: [] })),
  runScheduleNow: vi.fn(),
  runTaskNow: vi.fn(),
  sendAgentChatMessage: vi.fn(),
}));

vi.mock("../src/daemon.js", () => ({
  restartDaemon: vi.fn(async () => undefined),
}));

vi.mock("../src/paths.js", () => ({
  API_TOKEN_PATH: hoisted.apiTokenPath,
  MAX_HOME: hoisted.tempHome,
  ensureMaxHome: vi.fn(),
}));

vi.mock("../src/copilot/harness.js", () => ({
  getHarnessStatus: vi.fn(),
  readProgress: vi.fn(() => []),
  readFeatureList: vi.fn(() => ({ features: [] })),
}));

vi.mock("../src/copilot/skills.js", () => ({
  createSkill: vi.fn(),
  listSkills: vi.fn(() => []),
  readSkill: vi.fn(),
  removeSkill: vi.fn(),
  updateSkill: vi.fn(),
}));

vi.mock("../src/copilot/mcp-config.js", () => ({
  createMcpServer: vi.fn(),
  readMcpConfig: vi.fn(() => ({ ok: true, configPath: "/tmp/mock.json", document: { mcpServers: {} } })),
  removeMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
}));

describe("native sessions API routes", () => {
  let server: Server;
  let baseUrl = "";

  beforeAll(async () => {
    mkdirSync(hoisted.tempHome, { recursive: true });
    writeFileSync(hoisted.apiTokenPath, `${hoisted.apiToken}\n`, "utf-8");
    const { app } = await import("../src/api/server.js");
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) reject(err);
        else resolve();
      });
    });
    rmSync(hoisted.tempHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.workers.clear();
    hoisted.nativeSessionMocks.discoverMachineSessions.mockReturnValue({
      ok: true,
      message: "Found 1 Copilot session(s).",
      sessions: [
        {
          id: "session-abc",
          workingDir: "/tmp/max",
          summary: "Docs session",
          updatedAt: "2025-01-01T10:00:00.000Z",
        },
      ],
    });
    hoisted.nativeSessionMocks.findMachineSessionById.mockReturnValue({
      id: "session-abc",
      workingDir: "/tmp/max",
      summary: "Docs session",
      updatedAt: "2025-01-01T10:00:00.000Z",
    });
    hoisted.nativeSessionMocks.attachManagedSession.mockResolvedValue({
      name: "machine-max",
      session: { destroy: vi.fn() },
      workingDir: "/tmp/max",
      status: "idle",
      originChannel: "tui",
      sessionSource: "machine",
      copilotSessionId: "session-abc",
      workspaceLabel: "max-core",
      activationMode: "manual",
      routingHint: "docs",
      queueHint: "docs-review",
    });
    hoisted.nativeSessionMocks.detachManagedSession.mockReturnValue({
      name: "machine-max",
      session: { destroy: vi.fn() },
      workingDir: "/tmp/max",
      status: "idle",
      originChannel: "tui",
      sessionSource: "machine",
      copilotSessionId: "session-abc",
      workspaceLabel: "max-core",
      activationMode: "manual",
      routingHint: "docs",
      queueHint: "docs-review",
    });
    hoisted.nativeSessionMocks.listManagedMachineWorkers.mockReturnValue([
      {
        name: "machine-max",
        session: { destroy: vi.fn() },
        workingDir: "/tmp/max",
        status: "idle",
        originChannel: "tui",
        sessionSource: "machine",
        copilotSessionId: "session-abc",
        workspaceLabel: "max-core",
        activationMode: "manual",
        routingHint: "docs",
        queueHint: "docs-review",
      },
    ]);
    hoisted.nativeSessionMocks.routeManagedSessions.mockReturnValue([
      {
        name: "machine-max",
        session: { destroy: vi.fn() },
        workingDir: "/tmp/max",
        status: "idle",
        originChannel: "tui",
        sessionSource: "machine",
        copilotSessionId: "session-abc",
        workspaceLabel: "max-core",
        activationMode: "pinned",
        routingHint: "docs",
        queueHint: "docs-review",
      },
    ]);
    hoisted.nativeSessionMocks.updateManagedSessionMetadata.mockReturnValue({
      name: "machine-max",
      session: { destroy: vi.fn() },
      workingDir: "/tmp/max",
      status: "idle",
      originChannel: "tui",
      sessionSource: "machine",
      copilotSessionId: "session-abc",
      workspaceLabel: "max-core",
      activationMode: "suggested",
      routingHint: "frontend triage",
      queueHint: "docs-review",
    });
    hoisted.nativeSessionMocks.getManagedSessionChatState.mockReturnValue({
      session: {
        name: "machine-max",
        session: { destroy: vi.fn() },
        workingDir: "/tmp/max",
        status: "idle",
        originChannel: "tui",
        sessionSource: "machine",
        copilotSessionId: "session-abc",
        workspaceLabel: "max-core",
        activationMode: "manual",
        routingHint: "docs",
        queueHint: "docs-review",
      },
      history: [
        {
          id: 1,
          sessionName: "machine-max",
          role: "user",
          content: "Hello",
          createdAt: "2025-01-01T10:00:00.000Z",
        },
      ],
    });
    hoisted.nativeSessionMocks.sendManagedSessionChatMessage.mockResolvedValue({
      session: {
        name: "machine-max",
        session: { destroy: vi.fn() },
        workingDir: "/tmp/max",
        status: "idle",
        originChannel: "tui",
        sessionSource: "machine",
        copilotSessionId: "session-abc",
        workspaceLabel: "max-core",
        activationMode: "manual",
        routingHint: "docs",
        queueHint: "docs-review",
      },
      reply: {
        id: 2,
        sessionName: "machine-max",
        role: "assistant",
        content: "Hi back",
        createdAt: "2025-01-01T10:01:00.000Z",
      },
      history: [
        {
          id: 1,
          sessionName: "machine-max",
          role: "user",
          content: "Hello",
          createdAt: "2025-01-01T10:00:00.000Z",
        },
        {
          id: 2,
          sessionName: "machine-max",
          role: "assistant",
          content: "Hi back",
          createdAt: "2025-01-01T10:01:00.000Z",
        },
      ],
    });
  });

  async function apiFetch(path: string, init: RequestInit = {}) {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${hoisted.apiToken}`);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  it("returns discovered Copilot sessions from GET /native-sessions/discover", async () => {
    const response = await apiFetch("/native-sessions/discover?cwdFilter=max&limit=50");
    const json = await response.json() as { sessions: Array<{ id: string }> };

    expect(response.status).toBe(200);
    expect(json.sessions.map((session) => session.id)).toEqual(["session-abc"]);
    expect(hoisted.nativeSessionMocks.discoverMachineSessions).toHaveBeenCalledWith({
      cwdFilter: "max",
      limit: 50,
    });
  });

  it("returns attached machine workers from GET /native-sessions", async () => {
    const response = await apiFetch("/native-sessions");
    const json = await response.json() as {
      sessions: Array<{ name: string; workspaceLabel: string; activationMode: string; originChannel: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(json.sessions.map((session) => session.name)).toEqual(["machine-max"]);
    expect(json.sessions[0]).toMatchObject({
      workspaceLabel: "max-core",
      activationMode: "manual",
      originChannel: "tui",
    });
    expect(hoisted.nativeSessionMocks.listManagedMachineWorkers).toHaveBeenCalled();
  });

  it("returns control-agent worker metadata from GET /status", async () => {
    hoisted.workers.set("control-agent-7", {
      name: "control-agent-7",
      session: { destroy: vi.fn() },
      workingDir: "/tmp/max",
      status: "running",
      lastOutput: "Processed latest channel event.",
      originChannel: "telegram",
    });

    const response = await apiFetch("/status");
    const json = await response.json() as {
      workers: Array<{ name: string; controlAgentId: number | null; originChannel: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(json.workers).toHaveLength(1);
    expect(json.workers[0]).toMatchObject({
      name: "control-agent-7",
      controlAgentId: 7,
      originChannel: "telegram",
    });
  });

  it("returns ranked native sessions from GET /native-sessions/route", async () => {
    const response = await apiFetch("/native-sessions/route?workspaceLabel=max&routingHint=docs&queueHint=review");
    const json = await response.json() as {
      sessions: Array<{ name: string; activationMode: string; originChannel: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(json.sessions).toHaveLength(1);
    expect(json.sessions[0]).toMatchObject({
      name: "machine-max",
      activationMode: "pinned",
      originChannel: "tui",
    });
    expect(hoisted.nativeSessionMocks.routeManagedSessions).toHaveBeenCalledWith(hoisted.workers, {
      workspaceLabel: "max",
      routingHint: "docs",
      queueHint: "review",
    });
  });

  it("attaches a native session through POST /native-sessions/attach", async () => {
    const response = await apiFetch("/native-sessions/attach", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sessionId: "session-abc",
        name: "machine-max",
      }),
    });
    const json = await response.json() as { ok: boolean; worker: { name: string; originChannel: string | null } };

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.worker.name).toBe("machine-max");
    expect(json.worker.originChannel).toBe("tui");
    expect(hoisted.getClient).toHaveBeenCalled();
    expect(hoisted.nativeSessionMocks.attachManagedSession).toHaveBeenCalledWith(
      expect.objectContaining({
        client: { label: "client" },
        sessionId: "session-abc",
        name: "machine-max",
        workingDir: "/tmp/max",
        sessionSource: "machine",
      })
    );
  });

  it("detaches a native session through DELETE /native-sessions/:name", async () => {
    const response = await apiFetch("/native-sessions/machine-max", {
      method: "DELETE",
    });
    const json = await response.json() as { ok: boolean; workerName: string };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.workerName).toBe("machine-max");
    expect(hoisted.nativeSessionMocks.detachManagedSession).toHaveBeenCalledWith("machine-max", hoisted.workers);
  });

  it("updates native session metadata through PATCH /native-sessions/:name/metadata", async () => {
    const response = await apiFetch("/native-sessions/machine-max/metadata", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        workspaceLabel: "max-core",
        activationMode: "suggested",
        routingHint: "frontend triage",
        queueHint: "docs-review",
      }),
    });
    const json = await response.json() as {
      ok: boolean;
      worker: { activationMode: string; routingHint: string; originChannel: string | null };
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.worker).toMatchObject({
      activationMode: "suggested",
      routingHint: "frontend triage",
      originChannel: "tui",
    });
    expect(hoisted.nativeSessionMocks.updateManagedSessionMetadata).toHaveBeenCalledWith("machine-max", hoisted.workers, {
      workspaceLabel: "max-core",
      activationMode: "suggested",
      routingHint: "frontend triage",
      queueHint: "docs-review",
    });
  });

  it("returns native session chat history through GET /native-sessions/:name/chat", async () => {
    const response = await apiFetch("/native-sessions/machine-max/chat?limit=50");
    const json = await response.json() as {
      history: Array<{ content: string }>;
      session: { name: string; originChannel: string | null };
    };

    expect(response.status).toBe(200);
    expect(json.session.name).toBe("machine-max");
    expect(json.session.originChannel).toBe("tui");
    expect(json.history.map((message) => message.content)).toEqual(["Hello"]);
    expect(hoisted.nativeSessionMocks.getManagedSessionChatState).toHaveBeenCalledWith("machine-max", hoisted.workers, 50);
  });

  it("sends native session chat turns through POST /native-sessions/:name/chat", async () => {
    const response = await apiFetch("/native-sessions/machine-max/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "Hello" }),
    });
    const json = await response.json() as { reply: { content: string }; history: Array<{ role: string }> };

    expect(response.status).toBe(200);
    expect(json.reply.content).toBe("Hi back");
    expect(json.history.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(hoisted.nativeSessionMocks.sendManagedSessionChatMessage).toHaveBeenCalledWith("machine-max", "Hello", hoisted.workers);
  });
});
