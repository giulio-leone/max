import type { Server } from "http";
import type { AddressInfo } from "net";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-skills-api-${Math.random().toString(36).slice(2)}`;
  const apiToken = "test-token";
  const apiTokenPath = `${tempHome}/api-token`;

  return {
    tempHome,
    apiToken,
    apiTokenPath,
    skillMocks: {
      createSkill: vi.fn(),
      listSkills: vi.fn(),
      readSkill: vi.fn(),
      removeSkill: vi.fn(),
      updateSkill: vi.fn(),
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
  createSkill: hoisted.skillMocks.createSkill,
  listSkills: hoisted.skillMocks.listSkills,
  readSkill: hoisted.skillMocks.readSkill,
  removeSkill: hoisted.skillMocks.removeSkill,
  updateSkill: hoisted.skillMocks.updateSkill,
}));

const baseSkill = {
  slug: "browser-check",
  name: "Browser Check",
  description: "Check a browser page and summarize issues.",
  directory: join(hoisted.tempHome, "skills", "browser-check"),
  source: "local" as const,
  content: `---\nname: Browser Check\ndescription: Check a browser page and summarize issues.\n---\n\nInspect the page and report issues.\n`,
  instructions: "Inspect the page and report issues.",
  frontmatter: {
    name: "Browser Check",
    description: "Check a browser page and summarize issues.",
  },
};

describe("skills API routes", () => {
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
    hoisted.skillMocks.listSkills.mockReturnValue([
      {
        slug: baseSkill.slug,
        name: baseSkill.name,
        description: baseSkill.description,
        directory: baseSkill.directory,
        source: baseSkill.source,
      },
    ]);
    hoisted.skillMocks.readSkill.mockImplementation((slug: string, source?: string) => {
      if (slug === baseSkill.slug && (source === undefined || source === "local")) {
        return { ok: true, message: `Skill '${slug}' loaded.`, skill: baseSkill };
      }
      return { ok: false, message: `Skill '${slug}' not found.` };
    });
    hoisted.skillMocks.createSkill.mockReturnValue(
      `Skill '${baseSkill.name}' created at ${baseSkill.directory}. It will be available on your next message.`
    );
    hoisted.skillMocks.updateSkill.mockReturnValue({
      ok: true,
      message: `Skill '${baseSkill.slug}' updated.`,
      skill: baseSkill,
    });
    hoisted.skillMocks.removeSkill.mockReturnValue({
      ok: true,
      message: `Skill '${baseSkill.slug}' removed.`,
    });
  });

  async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${hoisted.apiToken}`);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers,
    });
  }

  it("returns skill detail from GET /skills/:slug", async () => {
    const response = await apiFetch(`/skills/${baseSkill.slug}`);
    const json = await response.json() as typeof baseSkill;

    expect(response.status).toBe(200);
    expect(json.slug).toBe(baseSkill.slug);
    expect(json.instructions).toBe(baseSkill.instructions);
    expect(hoisted.skillMocks.readSkill).toHaveBeenCalledWith(baseSkill.slug);
  });

  it("creates a local skill through POST /skills", async () => {
    const createdSkill = {
      ...baseSkill,
      slug: "new-skill",
      name: "New Skill",
      directory: join(hoisted.tempHome, "skills", "new-skill"),
      content: `---\nname: New Skill\ndescription: A new local skill.\n---\n\nRun the new instructions.\n`,
      instructions: "Run the new instructions.",
      frontmatter: {
        name: "New Skill",
        description: "A new local skill.",
      },
      description: "A new local skill.",
    };

    let localReads = 0;
    hoisted.skillMocks.readSkill.mockImplementation((slug: string, source?: string) => {
      if (slug !== createdSkill.slug || source !== "local") {
        return { ok: false, message: `Skill '${slug}' not found.` };
      }
      localReads += 1;
      if (localReads === 1) {
        return { ok: false, message: `Skill '${slug}' not found.` };
      }
      return { ok: true, message: `Skill '${slug}' loaded.`, skill: createdSkill };
    });
    hoisted.skillMocks.createSkill.mockReturnValue(
      `Skill '${createdSkill.name}' created at ${createdSkill.directory}. It will be available on your next message.`
    );

    const response = await apiFetch("/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: createdSkill.slug,
        name: createdSkill.name,
        description: createdSkill.description,
        instructions: createdSkill.instructions,
      }),
    });
    const json = await response.json() as { ok: boolean; skill: typeof createdSkill };

    expect(response.status).toBe(201);
    expect(json.ok).toBe(true);
    expect(json.skill.slug).toBe(createdSkill.slug);
    expect(hoisted.skillMocks.createSkill).toHaveBeenCalledWith(
      createdSkill.slug,
      createdSkill.name,
      createdSkill.description,
      createdSkill.instructions
    );
  });

  it("updates a local skill through PUT /skills/:slug", async () => {
    const updatedSkill = {
      ...baseSkill,
      name: "Browser Check Updated",
      instructions: "Inspect the page, summarize issues, and suggest fixes.",
      frontmatter: {
        ...baseSkill.frontmatter,
        name: "Browser Check Updated",
      },
    };
    hoisted.skillMocks.updateSkill.mockReturnValue({
      ok: true,
      message: `Skill '${baseSkill.slug}' updated.`,
      skill: updatedSkill,
    });

    const response = await apiFetch(`/skills/${baseSkill.slug}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: updatedSkill.name,
        instructions: updatedSkill.instructions,
      }),
    });
    const json = await response.json() as { ok: boolean; skill: typeof updatedSkill };

    expect(response.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.skill.name).toBe(updatedSkill.name);
    expect(hoisted.skillMocks.updateSkill).toHaveBeenCalledWith(baseSkill.slug, {
      name: updatedSkill.name,
      instructions: updatedSkill.instructions,
    });
  });

  it("advertises PUT in the CORS preflight response", async () => {
    const response = await fetch(`${baseUrl}/skills/${baseSkill.slug}`, {
      method: "OPTIONS",
    });

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("PUT");
  });
});
