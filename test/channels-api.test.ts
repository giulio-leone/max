import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-channels-api-${Math.random().toString(36).slice(2)}`;
  const apiToken = "test-token";
  const apiTokenPath = `${tempHome}/api-token`;

  return {
    tempHome,
    apiToken,
    apiTokenPath,
    orchestratorMocks: {
      sendToOrchestrator: vi.fn(),
    },
    channelMocks: {
      createChannel: vi.fn(),
      createChannelAccount: vi.fn(),
      deleteChannel: vi.fn(),
      deleteChannelAccount: vi.fn(),
      getChannel: vi.fn(),
      getChannelAccount: vi.fn(),
      listChannelAccounts: vi.fn(),
      listChannelInbox: vi.fn(),
      listChannels: vi.fn(),
      updateChannel: vi.fn(),
      updateChannelAccount: vi.fn(),
    },
  };
});

vi.mock("../src/copilot/orchestrator.js", () => ({
  sendToOrchestrator: hoisted.orchestratorMocks.sendToOrchestrator,
  getWorkers: vi.fn(() => new Map()),
  cancelCurrentMessage: vi.fn(async () => false),
  getLastRouteResult: vi.fn(() => null),
}));

vi.mock("../src/telegram/bot.js", () => ({
  sendPhoto: vi.fn(async () => undefined),
}));

vi.mock("../src/copilot/client.js", () => ({
  getClient: vi.fn(async () => ({})),
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
  addSessionMemory: vi.fn(),
  createChannel: hoisted.channelMocks.createChannel,
  createChannelAccount: hoisted.channelMocks.createChannelAccount,
  deleteChannel: hoisted.channelMocks.deleteChannel,
  deleteChannelAccount: hoisted.channelMocks.deleteChannelAccount,
  getChannel: hoisted.channelMocks.getChannel,
  getChannelAccount: hoisted.channelMocks.getChannelAccount,
  isChannelAccountType: (value: unknown) => ["telegram", "tui", "background"].includes(String(value)),
  listChannelAccounts: hoisted.channelMocks.listChannelAccounts,
  listChannelInbox: hoisted.channelMocks.listChannelInbox,
  listChannels: hoisted.channelMocks.listChannels,
  removeAgentMemory: vi.fn(),
  removeSessionMemory: vi.fn(),
  searchAgentMemories: vi.fn(() => []),
  searchMemories: vi.fn(() => []),
  searchSessionMemories: vi.fn(() => []),
  updateChannel: hoisted.channelMocks.updateChannel,
  updateChannelAccount: hoisted.channelMocks.updateChannelAccount,
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

vi.mock("../src/copilot/worker-sessions.js", () => ({
  attachManagedSession: vi.fn(),
  detachManagedSession: vi.fn(),
  discoverMachineSessions: vi.fn(() => ({ ok: true, message: "", sessions: [] })),
  findMachineSessionById: vi.fn(),
  findManagedMachineWorker: vi.fn(() => undefined),
  formatMachineSessionAge: vi.fn(() => "just now"),
  getManagedSessionChatState: vi.fn(() => ({ session: null, history: [] })),
  listManagedMachineWorkers: vi.fn(() => []),
  routeManagedSessions: vi.fn(() => []),
  sendManagedSessionChatMessage: vi.fn(),
  updateManagedSessionMetadata: vi.fn(),
}));

describe("channels API routes", () => {
  let server: Server;
  let baseUrl = "";

  const account = {
    id: 1,
    type: "tui" as const,
    name: "ops",
    metadata: { owner: "ops-team" },
    createdAt: "2026-03-22T00:00:00.000Z",
    updatedAt: "2026-03-22T00:00:00.000Z",
    deletedAt: null,
  };

  const channel = {
    id: 11,
    accountId: 1,
    accountType: "tui" as const,
    accountName: "ops",
    name: "triage",
    displayName: "Ops Triage",
    icon: null,
    settings: { priority: "high" },
    createdAt: "2026-03-22T00:00:00.000Z",
    updatedAt: "2026-03-22T00:00:00.000Z",
    deletedAt: null,
  };

  const inboxMessage = {
    id: 101,
    channelId: 11,
    direction: "in" as const,
    role: "user" as const,
    content: "hello channel",
    metadata: { sourceType: "tui" },
    createdAt: "2026-03-22T00:01:00.000Z",
    channel: {
      id: 11,
      name: "triage",
      displayName: "Ops Triage",
      icon: null,
    },
    account: {
      id: 1,
      type: "tui" as const,
      name: "ops",
    },
  };

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
    hoisted.channelMocks.listChannelAccounts.mockReturnValue([account]);
    hoisted.channelMocks.createChannelAccount.mockReturnValue(account);
    hoisted.channelMocks.getChannelAccount.mockReturnValue(account);
    hoisted.channelMocks.listChannels.mockReturnValue([channel]);
    hoisted.channelMocks.createChannel.mockReturnValue(channel);
    hoisted.channelMocks.getChannel.mockReturnValue(channel);
    hoisted.channelMocks.updateChannel.mockReturnValue(channel);
    hoisted.channelMocks.updateChannelAccount.mockReturnValue(account);
    hoisted.channelMocks.deleteChannel.mockReturnValue(true);
    hoisted.channelMocks.deleteChannelAccount.mockReturnValue(true);
    hoisted.channelMocks.listChannelInbox.mockReturnValue([inboxMessage]);
  });

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${hoisted.apiToken}`);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  it("lists channel accounts with optional type filtering", async () => {
    const response = await apiFetch("/channels/accounts?type=tui");
    const json = await response.json() as { accounts: unknown[] };

    expect(response.status).toBe(200);
    expect(json.accounts).toEqual([account]);
    expect(hoisted.channelMocks.listChannelAccounts).toHaveBeenCalledWith({ type: "tui" });
  });

  it("creates channel accounts via POST /channels/accounts", async () => {
    const response = await apiFetch("/channels/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tui",
        name: "ops",
        metadata: { owner: "ops-team" },
      }),
    });
    const json = await response.json() as { account: typeof account };

    expect(response.status).toBe(201);
    expect(json.account).toEqual(account);
    expect(hoisted.channelMocks.createChannelAccount).toHaveBeenCalledWith({
      type: "tui",
      name: "ops",
      metadata: { owner: "ops-team" },
    });
  });

  it("updates channel accounts via PATCH /channels/accounts/:accountId", async () => {
    const response = await apiFetch("/channels/accounts/1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "ops-updated",
        metadata: { owner: "ops-team", escalation: "p1" },
      }),
    });
    const json = await response.json() as { account: typeof account };

    expect(response.status).toBe(200);
    expect(json.account).toEqual(account);
    expect(hoisted.channelMocks.updateChannelAccount).toHaveBeenCalledWith(1, {
      name: "ops-updated",
      metadata: { owner: "ops-team", escalation: "p1" },
    });
  });

  it("creates account-scoped channels", async () => {
    const response = await apiFetch("/channels/accounts/1/channels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "triage",
        displayName: "Ops Triage",
        settings: { priority: "high" },
      }),
    });
    const json = await response.json() as { channel: typeof channel };

    expect(response.status).toBe(201);
    expect(json.channel).toEqual(channel);
    expect(hoisted.channelMocks.createChannel).toHaveBeenCalledWith({
      accountId: 1,
      name: "triage",
      displayName: "Ops Triage",
      settings: { priority: "high" },
    });
  });

  it("updates channels via PATCH /channels/:channelId", async () => {
    const response = await apiFetch("/channels/11", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        displayName: "Ops Inbox",
        icon: "inbox",
        settings: { priority: "urgent" },
      }),
    });
    const json = await response.json() as { channel: typeof channel };

    expect(response.status).toBe(200);
    expect(json.channel).toEqual(channel);
    expect(hoisted.channelMocks.updateChannel).toHaveBeenCalledWith(11, {
      displayName: "Ops Inbox",
      icon: "inbox",
      settings: { priority: "urgent" },
    });
  });

  it("returns channel inbox history with pagination args", async () => {
    const response = await apiFetch("/channels/11/inbox?limit=50&beforeId=200");
    const json = await response.json() as {
      channel: typeof channel;
      messages: typeof inboxMessage[];
    };

    expect(response.status).toBe(200);
    expect(json.channel).toEqual(channel);
    expect(json.messages).toEqual([inboxMessage]);
    expect(hoisted.channelMocks.listChannelInbox).toHaveBeenCalledWith(11, {
      limit: 50,
      beforeId: 200,
    });
  });

  it("returns 404 for missing channels on delete", async () => {
    hoisted.channelMocks.deleteChannel.mockReturnValueOnce(false);

    const response = await apiFetch("/channels/99", {
      method: "DELETE",
    });
    const json = await response.json() as { error: string };

    expect(response.status).toBe(404);
    expect(json.error).toContain("Channel '99' was not found");
  });

  it("forwards optional channelId through /message", async () => {
    const response = await apiFetch("/stream?token=test-token");
    const connectionId = response.headers.get("X-Connection-Id");

    try {
      expect(connectionId).toBeTruthy();

      const messageResponse = await apiFetch("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "hello",
          connectionId,
          channelId: 11,
          routeHint: "incident-triage",
          senderId: "operator-1",
        }),
      });

      expect(messageResponse.status).toBe(200);
      expect(hoisted.orchestratorMocks.sendToOrchestrator).toHaveBeenCalledWith(
        "hello",
        {
          type: "tui",
          connectionId,
          channelId: 11,
          routeHint: "incident-triage",
          senderId: "operator-1",
        },
        expect.any(Function),
      );
    } finally {
      await response.body?.cancel();
    }
  });

  it("rejects non-string senderId on /message before enqueueing", async () => {
    const response = await apiFetch("/stream?token=test-token");
    const connectionId = response.headers.get("X-Connection-Id");

    try {
      expect(connectionId).toBeTruthy();

      const messageResponse = await apiFetch("/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "hello",
          connectionId,
          senderId: 42,
        }),
      });
      const json = await messageResponse.json() as { error: string };

      expect(messageResponse.status).toBe(400);
      expect(json.error).toBe("'senderId' must be a string");
      expect(hoisted.orchestratorMocks.sendToOrchestrator).not.toHaveBeenCalled();
    } finally {
      await response.body?.cancel();
    }
  });
});
