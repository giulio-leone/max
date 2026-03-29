import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-capabilities-api-${Math.random().toString(36).slice(2)}`;
  const apiToken = "test-token";
  const apiTokenPath = `${tempHome}/api-token`;

  return {
    tempHome,
    apiToken,
    apiTokenPath,
    skillMocks: {
      listSkills: vi.fn(),
    },
    mcpMocks: {
      loadMcpConfig: vi.fn(),
      loadMaxMcpConfig: vi.fn(),
      readMcpConfig: vi.fn(),
    },
  };
});

vi.mock("../src/copilot/orchestrator.js", () => ({
  sendToOrchestrator: vi.fn(),
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
  removeSessionMemory: vi.fn(),
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
  listSkills: hoisted.skillMocks.listSkills,
  readSkill: vi.fn(),
  removeSkill: vi.fn(),
  updateSkill: vi.fn(),
}));

vi.mock("../src/copilot/mcp-config.js", () => ({
  createMcpServer: vi.fn(),
  loadMcpConfig: hoisted.mcpMocks.loadMcpConfig,
  loadMaxMcpConfig: hoisted.mcpMocks.loadMaxMcpConfig,
  readMcpConfig: hoisted.mcpMocks.readMcpConfig,
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

describe("capability registry API", () => {
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
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    }
    rmSync(hoisted.tempHome, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.clearAllMocks();
    hoisted.skillMocks.listSkills.mockReturnValue([
      {
        slug: "browser-check",
        name: "Browser Check",
        description: "Inspect a browser page and summarize issues.",
        directory: join(hoisted.tempHome, "skills", "browser-check"),
        source: "local",
      },
    ]);
    hoisted.mcpMocks.readMcpConfig.mockReturnValue({
      ok: true,
      message: "Loaded MCP config.",
      configPath: join(hoisted.tempHome, ".copilot", "mcp-config.json"),
      document: {
        mcpServers: {
          playwright: {
            command: "npx",
            args: ["-y", "playwright-mcp"],
            tools: ["browser_open", "browser_click"],
          },
          unknown: {
            command: "npx",
            args: ["-y", "unknown-mcp"],
            tools: ["alpha_tool"],
          },
        },
      },
    });
    hoisted.mcpMocks.loadMcpConfig.mockReturnValue({
      playwright: {
        command: "npx",
        args: ["-y", "playwright-mcp"],
        tools: ["browser_open", "browser_click"],
      },
      unknown: {
        command: "npx",
        args: ["-y", "unknown-mcp"],
        tools: ["alpha_tool"],
      },
    });
    hoisted.mcpMocks.loadMaxMcpConfig.mockReturnValue({
      playwright: {
        command: "npx",
        args: ["-y", "playwright-mcp"],
        tools: ["browser_open", "browser_click"],
      },
      unknown: {
        command: "npx",
        args: ["-y", "unknown-mcp"],
        tools: ["alpha_tool"],
      },
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

  it("returns the full capability registry from GET /capabilities", async () => {
    const response = await apiFetch("/capabilities");
    const json = await response.json() as {
      totals: { capabilities: number; unclassified: number };
      families: Array<{ id: string; capabilities: Array<{ id: string }> }>;
    };

    expect(response.status).toBe(200);
    expect(json.totals.capabilities).toBeGreaterThan(0);
    expect(json.totals.unclassified).toBe(1);
    expect(json.families.find((family) => family.id === "browser")?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skill:browser-check:local" }),
        expect.objectContaining({ id: "mcp:playwright" }),
      ]),
    );
  });

  it("filters the registry by family and query", async () => {
    const response = await apiFetch("/capabilities?family=browser&q=playwright");
    const json = await response.json() as {
      families: Array<{ id: string; capabilities: Array<{ id: string }> }>;
    };

    expect(response.status).toBe(200);
    expect(json.families).toHaveLength(1);
    expect(json.families[0].id).toBe("browser");
    expect(json.families[0].capabilities).toEqual([
      expect.objectContaining({ id: "mcp:playwright" }),
    ]);
  });

  it("rejects unknown families", async () => {
    const response = await apiFetch("/capabilities?family=unknown");
    const json = await response.json() as { error?: string };

    expect(response.status).toBe(400);
    expect(json.error).toContain("Invalid capability family");
  });

  it("returns the runtime adapter registry from GET /capability-adapters", async () => {
    const response = await apiFetch("/capability-adapters");
    const json = await response.json() as {
      totals: { adapters: number; unclassified: number };
      adapters: Array<{ id: string; family: string | null; sourceType: string }>;
    };

    expect(response.status).toBe(200);
    expect(json.totals.adapters).toBeGreaterThan(0);
    expect(json.totals.unclassified).toBe(1);
    expect(json.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skill:browser-check:local", family: "browser", sourceType: "skill" }),
        expect.objectContaining({ id: "mcp:playwright", family: "browser", sourceType: "mcp" }),
      ]),
    );
  });

  it("filters runtime adapters by family and query", async () => {
    const response = await apiFetch("/capability-adapters?family=browser&q=browser");
    const json = await response.json() as {
      adapters: Array<{ id: string; family: string | null }>;
    };

    expect(response.status).toBe(200);
    expect(json.adapters).toHaveLength(2);
    expect(json.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skill:browser-check:local", family: "browser" }),
        expect.objectContaining({ id: "mcp:playwright", family: "browser" }),
      ]),
    );
  });
});
