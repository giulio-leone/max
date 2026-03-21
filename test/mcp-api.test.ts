import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-mcp-api-${Math.random().toString(36).slice(2)}`;
  const apiToken = "test-token";
  const apiTokenPath = `${tempHome}/api-token`;

  return {
    tempHome,
    apiToken,
    apiTokenPath,
    mcpMocks: {
      createMcpServer: vi.fn(),
      readMcpConfig: vi.fn(),
      removeMcpServer: vi.fn(),
      updateMcpServer: vi.fn(),
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
  searchMemories: vi.fn(() => []),
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
  createMcpServer: hoisted.mcpMocks.createMcpServer,
  readMcpConfig: hoisted.mcpMocks.readMcpConfig,
  removeMcpServer: hoisted.mcpMocks.removeMcpServer,
  updateMcpServer: hoisted.mcpMocks.updateMcpServer,
}));

const configPath = join(hoisted.tempHome, ".copilot", "mcp-config.json");

describe("MCP API routes", () => {
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
    hoisted.mcpMocks.readMcpConfig.mockReturnValue({
      ok: true,
      message: `Loaded MCP config from ${configPath}.`,
      configPath,
      document: {
        mcpServers: {
          zebra: {
            type: "sse",
            url: "http://127.0.0.1:9999/sse",
            tools: ["read_page"],
          },
          alpha: {
            command: "npx",
            args: ["-y", "alpha-server"],
            tools: ["*"],
          },
        },
      },
    });
    hoisted.mcpMocks.createMcpServer.mockReturnValue({
      ok: true,
      message: "MCP server 'browser' created.",
      configPath,
      server: {
        command: "npx",
        args: ["-y", "browser-server"],
        tools: ["*"],
      },
    });
    hoisted.mcpMocks.updateMcpServer.mockReturnValue({
      ok: true,
      message: "MCP server 'alpha' updated.",
      configPath,
      server: {
        type: "http",
        url: "http://127.0.0.1:8080/mcp",
        tools: ["tool_a"],
      },
    });
    hoisted.mcpMocks.removeMcpServer.mockReturnValue({
      ok: true,
      message: "MCP server 'alpha' removed.",
      configPath,
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

  it("returns the MCP server list from GET /mcp", async () => {
    const response = await apiFetch("/mcp");
    const json = await response.json() as {
      configPath: string;
      servers: Array<{ name: string; config: Record<string, unknown> }>;
    };

    expect(response.status).toBe(200);
    expect(json.configPath).toBe(configPath);
    expect(json.servers.map((server) => server.name)).toEqual(["alpha", "zebra"]);
  });

  it("creates an MCP server through POST /mcp", async () => {
    const payload = {
      name: "browser",
      config: {
        command: "npx",
        args: ["-y", "browser-server"],
        tools: ["*"],
      },
    };

    const response = await apiFetch("/mcp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await response.json() as {
      ok: boolean;
      serverName: string;
      configPath: string;
    };

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.serverName).toBe("browser");
    expect(hoisted.mcpMocks.createMcpServer).toHaveBeenCalledWith("browser", payload.config);
  });

  it("updates an MCP server through PUT /mcp/:name", async () => {
    const payload = {
      config: {
        type: "http",
        url: "http://127.0.0.1:8080/mcp",
        tools: ["tool_a"],
      },
    };

    const response = await apiFetch("/mcp/alpha", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await response.json() as {
      ok: boolean;
      serverName: string;
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.serverName).toBe("alpha");
    expect(hoisted.mcpMocks.updateMcpServer).toHaveBeenCalledWith("alpha", payload.config);
  });

  it("removes an MCP server through DELETE /mcp/:name", async () => {
    const response = await apiFetch("/mcp/alpha", {
      method: "DELETE",
    });
    const json = await response.json() as {
      ok: boolean;
      serverName: string;
    };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.serverName).toBe("alpha");
    expect(hoisted.mcpMocks.removeMcpServer).toHaveBeenCalledWith("alpha");
  });
});
