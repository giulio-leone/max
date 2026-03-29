import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-orchestrator-channels-${Math.random().toString(36).slice(2)}`;
  const sessionsDir = `${tempHome}/sessions`;
  return {
    tempHome,
    dbPath: `${tempHome}/max.db`,
    sessionsDir,
  };
});

vi.mock("../src/paths.js", () => ({
  MAX_HOME: hoisted.tempHome,
  DB_PATH: hoisted.dbPath,
  ENV_PATH: `${hoisted.tempHome}/.env`,
  SKILLS_DIR: `${hoisted.tempHome}/skills`,
  SESSIONS_DIR: hoisted.sessionsDir,
  HISTORY_PATH: `${hoisted.tempHome}/tui_history`,
  TUI_DEBUG_LOG_PATH: `${hoisted.tempHome}/tui-debug.log`,
  API_TOKEN_PATH: `${hoisted.tempHome}/api-token`,
  ensureMaxHome: () => {
    mkdirSync(hoisted.tempHome, { recursive: true });
    mkdirSync(hoisted.sessionsDir, { recursive: true });
  },
}));

vi.mock("../src/copilot/tools.js", () => ({
  createTools: vi.fn(() => []),
}));

vi.mock("../src/copilot/system-message.js", () => ({
  getOrchestratorSystemMessage: vi.fn(() => "test-system-message"),
}));

vi.mock("../src/config.js", () => ({
  config: {
    copilotModel: "test-model",
    apiPort: 7777,
  },
  DEFAULT_MODEL: "test-model",
}));

vi.mock("../src/copilot/mcp-config.js", () => ({
  loadMcpConfig: vi.fn(() => ({})),
  loadMaxMcpConfig: vi.fn(() => ({})),
}));

vi.mock("../src/copilot/skills.js", () => ({
  getSkillDirectories: vi.fn(() => []),
}));

vi.mock("../src/copilot/client.js", () => ({
  resetClient: vi.fn(),
}));

vi.mock("../src/copilot/router.js", () => ({
  resolveModel: vi.fn(),
}));

vi.mock("../src/copilot/harness.js", () => ({
  detectPhase: vi.fn(() => "coding"),
  getHarnessStatus: vi.fn(() => ({ passing: 0, total: 0, percentComplete: 0 })),
  getNextFeature: vi.fn(() => null),
  getCodingAgentPrompt: vi.fn(() => "coding-prompt"),
}));

describe("orchestrator channel enforcement", () => {
  beforeEach(() => {
    rmSync(hoisted.tempHome, { recursive: true, force: true });
    mkdirSync(hoisted.tempHome, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(hoisted.tempHome, { recursive: true, force: true });
  });

  it("returns allowlist denials through the callback and persists inbox history without starting a session", async () => {
    const db = await import("../src/store/db.js");
    const { sendToOrchestrator } = await import("../src/copilot/orchestrator.js");

    const account = db.createChannelAccount({
      type: "tui",
      name: "ops",
    });
    const channel = db.createChannel({
      accountId: account.id,
      name: "incident-room",
      settings: {
        routeHint: "incident-triage",
        allowlistMode: "allowlist",
        allowlist: ["operator-1"],
      },
    });

    const callback = vi.fn();

    await sendToOrchestrator(
      "Need help with production incident",
      {
        type: "tui",
        connectionId: "conn-blocked",
        routeHint: "incident-triage",
        senderId: "operator-2",
      },
      callback,
    );

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith(expect.stringMatching(/allowlist-only/i), true);
    expect(db.getState("orchestrator_session_id")).toBeUndefined();

    const inbox = db.listChannelInbox(channel.id);
    expect(inbox).toHaveLength(2);
    expect(inbox[0]).toMatchObject({
      direction: "in",
      role: "user",
      content: "Need help with production incident",
      metadata: {
        sourceType: "tui",
        connectionId: "conn-blocked",
        routeHint: "incident-triage",
        senderId: "operator-2",
      },
    });
    expect(inbox[1].direction).toBe("out");
    expect(inbox[1].role).toBe("system");
    expect(inbox[1].content).toMatch(/allowlist-only/i);

    const recentConversation = db.getRecentConversation(2);
    expect(recentConversation).toContain("Need help with production incident");
    expect(recentConversation).toMatch(/allowlist-only/i);
  });
});
