import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

async function loadMcpModule(tempHome: string) {
  process.env.HOME = tempHome;
  vi.resetModules();
  return await import("../src/copilot/mcp-config.js");
}

describe("mcp-config helpers", () => {
  let tempHome: string;
  const originalHome = process.env.HOME;

  beforeEach(() => {
    tempHome = mkdtempSync(join(tmpdir(), "max-mcp-config-"));
    process.env.HOME = tempHome;
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    rmSync(tempHome, { recursive: true, force: true });
  });

  it("reads an existing MCP config document and preserves top-level keys", async () => {
    const configDir = join(tempHome, ".copilot");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "mcp-config.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        mcpServers: {
          demo: {
            command: "npx",
            args: ["-y", "demo-server"],
            tools: ["*"],
          },
        },
      }, null, 2)}\n`,
      "utf-8"
    );

    const { loadMcpConfig, readMcpConfig } = await loadMcpModule(tempHome);
    const readResult = readMcpConfig();

    expect(readResult.ok).toBe(true);
    expect(readResult.document?.schemaVersion).toBe(2);
    expect(readResult.document?.mcpServers.demo).toMatchObject({
      command: "npx",
      args: ["-y", "demo-server"],
      tools: ["*"],
    });
    expect(loadMcpConfig().demo).toMatchObject({
      command: "npx",
      args: ["-y", "demo-server"],
      tools: ["*"],
    });
  });

  it("creates and updates MCP servers while preserving unrelated config data", async () => {
    const configDir = join(tempHome, ".copilot");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "mcp-config.json"),
      `${JSON.stringify({
        schemaVersion: 3,
        mcpServers: {
          existing: {
            command: "node",
            args: ["existing.js"],
            tools: [],
          },
        },
      }, null, 2)}\n`,
      "utf-8"
    );

    const { createMcpServer, readMcpConfig, updateMcpServer } = await loadMcpModule(tempHome);

    const createResult = createMcpServer("browser", {
      command: "npx",
      args: ["-y", "browser-server"],
      tools: ["*"],
      env: {
        BROWSER_HEADLESS: "1",
      },
    });
    expect(createResult.ok).toBe(true);

    const updateResult = updateMcpServer("browser", {
      type: "sse",
      url: "http://127.0.0.1:7779/sse",
      tools: ["read_page", "capture_screenshot"],
      headers: {
        Authorization: "Bearer test-token",
      },
    });
    expect(updateResult.ok).toBe(true);

    const readResult = readMcpConfig();
    expect(readResult.ok).toBe(true);
    expect(readResult.document?.schemaVersion).toBe(3);
    expect(readResult.document?.mcpServers.existing).toBeDefined();
    expect(readResult.document?.mcpServers.browser).toMatchObject({
      type: "sse",
      url: "http://127.0.0.1:7779/sse",
      tools: ["read_page", "capture_screenshot"],
    });
  });

  it("removes an MCP server from the persisted document", async () => {
    const configDir = join(tempHome, ".copilot");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, "mcp-config.json"),
      `${JSON.stringify({
        mcpServers: {
          removable: {
            command: "npx",
            args: ["-y", "removable-server"],
            tools: ["*"],
          },
        },
      }, null, 2)}\n`,
      "utf-8"
    );

    const { loadMcpConfig, removeMcpServer } = await loadMcpModule(tempHome);
    const result = removeMcpServer("removable");

    expect(result.ok).toBe(true);
    expect(loadMcpConfig().removable).toBeUndefined();
  });

  it("rejects invalid persisted server configs", async () => {
    const { createMcpServer, validateMcpServerConfig } = await loadMcpModule(tempHome);

    const memoryValidation = validateMcpServerConfig("memory-demo", {
      type: "memory",
      tools: ["*"],
    });
    expect(memoryValidation.valid).toBe(false);
    expect(memoryValidation.errors).toContain("In-memory MCP servers cannot be persisted to mcp-config.json.");

    const invalidResult = createMcpServer("bad-server", {
      command: "",
      args: [],
      tools: ["*"],
    });
    expect(invalidResult.ok).toBe(false);
    expect(invalidResult.errors).toContain("Local MCP servers must include a non-empty 'command'.");
  });
});
