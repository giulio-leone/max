import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { homedir } from "os";
import type { MCPServerConfig } from "@github/copilot-sdk";

export interface McpConfigDocument {
  mcpServers: Record<string, MCPServerConfig>;
  [key: string]: unknown;
}

export interface McpConfigReadResult {
  ok: boolean;
  message: string;
  configPath: string;
  document?: McpConfigDocument;
}

export interface McpConfigValidationResult {
  valid: boolean;
  errors: string[];
}

export interface McpConfigMutationResult {
  ok: boolean;
  message: string;
  configPath: string;
  document?: McpConfigDocument;
  server?: MCPServerConfig;
  errors?: string[];
}

function getMcpConfigDir(): string {
  return join(homedir(), ".copilot");
}

function getMcpConfigPath(): string {
  return join(getMcpConfigDir(), "mcp-config.json");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((item) => typeof item === "string");
}

function isSafeServerName(name: string): boolean {
  return name.trim().length > 0
    && name.trim() === name
    && name !== "__proto__"
    && name !== "constructor"
    && name !== "prototype";
}

function cloneDocument(document: McpConfigDocument): McpConfigDocument {
  return {
    ...document,
    mcpServers: { ...document.mcpServers },
  };
}

function parseMcpDocument(raw: string, configPath: string): McpConfigReadResult {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!isPlainObject(parsed)) {
      return {
        ok: false,
        message: `Invalid MCP config at ${configPath}: root JSON value must be an object.`,
        configPath,
      };
    }

    const mcpServersRaw = parsed.mcpServers;
    if (mcpServersRaw !== undefined && !isPlainObject(mcpServersRaw)) {
      return {
        ok: false,
        message: `Invalid MCP config at ${configPath}: 'mcpServers' must be an object when present.`,
        configPath,
      };
    }

    return {
      ok: true,
      message: existsSync(configPath)
        ? `Loaded MCP config from ${configPath}.`
        : `Initialized empty MCP config at ${configPath}.`,
      configPath,
      document: {
        ...parsed,
        mcpServers: (mcpServersRaw as Record<string, MCPServerConfig> | undefined) ?? {},
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Invalid MCP config at ${configPath}: ${message}`,
      configPath,
    };
  }
}

function readExistingDocument(): McpConfigReadResult {
  const configPath = getMcpConfigPath();
  if (!existsSync(configPath)) {
    return {
      ok: true,
      message: `Initialized empty MCP config at ${configPath}.`,
      configPath,
      document: { mcpServers: {} },
    };
  }

  try {
    const raw = readFileSync(configPath, "utf-8");
    return parseMcpDocument(raw, configPath);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Failed to read MCP config at ${configPath}: ${message}`,
      configPath,
    };
  }
}

function writeDocument(document: McpConfigDocument): McpConfigMutationResult {
  const configDir = getMcpConfigDir();
  const configPath = getMcpConfigPath();
  const tempPath = join(configDir, `.mcp-config.${process.pid}.${Date.now()}.tmp`);

  try {
    mkdirSync(configDir, { recursive: true });
    const serialized = `${JSON.stringify(document, null, 2)}\n`;
    writeFileSync(tempPath, serialized, { mode: 0o600 });
    renameSync(tempPath, configPath);
    return {
      ok: true,
      message: `MCP config saved to ${configPath}.`,
      configPath,
      document,
    };
  } catch (err) {
    rmSync(tempPath, { force: true });
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Failed to write MCP config at ${configPath}: ${message}`,
      configPath,
    };
  }
}

/**
 * Load MCP server configs from ~/.copilot/mcp-config.json.
 * Returns an empty record if the file doesn't exist or is invalid.
 */
export function loadMcpConfig(): Record<string, MCPServerConfig> {
  const result = readExistingDocument();
  return result.ok && result.document ? result.document.mcpServers : {};
}

export function readMcpConfig(): McpConfigReadResult {
  return readExistingDocument();
}

export function validateMcpServerConfig(serverName: string, serverConfig: unknown): McpConfigValidationResult {
  const errors: string[] = [];

  if (!isSafeServerName(serverName)) {
    errors.push("Server name must be a non-empty trimmed string and cannot use reserved object keys.");
  }

  if (!isPlainObject(serverConfig)) {
    errors.push("Server config must be an object.");
    return { valid: false, errors };
  }

  if (!isStringArray(serverConfig.tools)) {
    errors.push("Server config must include a 'tools' array of strings.");
  }

  if (serverConfig.displayName !== undefined && typeof serverConfig.displayName !== "string") {
    errors.push("'displayName' must be a string when provided.");
  }
  if (serverConfig.type !== undefined && typeof serverConfig.type !== "string") {
    errors.push("'type' must be a string when provided.");
  }
  if (serverConfig.timeout !== undefined && typeof serverConfig.timeout !== "number") {
    errors.push("'timeout' must be a number when provided.");
  }
  if (serverConfig.source !== undefined && typeof serverConfig.source !== "string") {
    errors.push("'source' must be a string when provided.");
  }
  if (serverConfig.sourcePath !== undefined && typeof serverConfig.sourcePath !== "string") {
    errors.push("'sourcePath' must be a string when provided.");
  }

  const configType = serverConfig.type;
  if (configType === "memory") {
    errors.push("In-memory MCP servers cannot be persisted to mcp-config.json.");
  } else if (configType === "http" || configType === "sse") {
    if (typeof serverConfig.url !== "string" || serverConfig.url.trim().length === 0) {
      errors.push(`Remote '${configType}' MCP servers must include a non-empty 'url'.`);
    }
    if (serverConfig.headers !== undefined && !isStringRecord(serverConfig.headers)) {
      errors.push("'headers' must be an object of string values when provided.");
    }
    if (serverConfig.oauthClientId !== undefined && typeof serverConfig.oauthClientId !== "string") {
      errors.push("'oauthClientId' must be a string when provided.");
    }
    if (serverConfig.oauthPublicClient !== undefined && typeof serverConfig.oauthPublicClient !== "boolean") {
      errors.push("'oauthPublicClient' must be a boolean when provided.");
    }
  } else {
    if (typeof serverConfig.command !== "string" || serverConfig.command.trim().length === 0) {
      errors.push("Local MCP servers must include a non-empty 'command'.");
    }
    if (!isStringArray(serverConfig.args)) {
      errors.push("Local MCP servers must include an 'args' array of strings.");
    }
    if (serverConfig.env !== undefined && !isStringRecord(serverConfig.env)) {
      errors.push("'env' must be an object of string values when provided.");
    }
    if (serverConfig.cwd !== undefined && typeof serverConfig.cwd !== "string") {
      errors.push("'cwd' must be a string when provided.");
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function createMcpServer(
  serverName: string,
  serverConfig: MCPServerConfig,
): McpConfigMutationResult {
  const existing = readExistingDocument();
  if (!existing.ok || !existing.document) {
    return {
      ok: false,
      message: existing.message,
      configPath: existing.configPath,
    };
  }

  if (existing.document.mcpServers[serverName]) {
    return {
      ok: false,
      message: `MCP server '${serverName}' already exists.`,
      configPath: existing.configPath,
    };
  }

  const validation = validateMcpServerConfig(serverName, serverConfig);
  if (!validation.valid) {
    return {
      ok: false,
      message: `MCP server '${serverName}' failed validation.`,
      configPath: existing.configPath,
      errors: validation.errors,
    };
  }

  const document = cloneDocument(existing.document);
  document.mcpServers[serverName] = serverConfig;
  const written = writeDocument(document);
  return written.ok
    ? {
      ...written,
      server: document.mcpServers[serverName],
      message: `MCP server '${serverName}' created.`,
    }
    : written;
}

export function updateMcpServer(
  serverName: string,
  serverConfig: MCPServerConfig,
): McpConfigMutationResult {
  const existing = readExistingDocument();
  if (!existing.ok || !existing.document) {
    return {
      ok: false,
      message: existing.message,
      configPath: existing.configPath,
    };
  }

  if (!existing.document.mcpServers[serverName]) {
    return {
      ok: false,
      message: `MCP server '${serverName}' not found.`,
      configPath: existing.configPath,
    };
  }

  const validation = validateMcpServerConfig(serverName, serverConfig);
  if (!validation.valid) {
    return {
      ok: false,
      message: `MCP server '${serverName}' failed validation.`,
      configPath: existing.configPath,
      errors: validation.errors,
    };
  }

  const document = cloneDocument(existing.document);
  document.mcpServers[serverName] = serverConfig;
  const written = writeDocument(document);
  return written.ok
    ? {
      ...written,
      server: document.mcpServers[serverName],
      message: `MCP server '${serverName}' updated.`,
    }
    : written;
}

export function removeMcpServer(serverName: string): McpConfigMutationResult {
  const existing = readExistingDocument();
  if (!existing.ok || !existing.document) {
    return {
      ok: false,
      message: existing.message,
      configPath: existing.configPath,
    };
  }

  if (!existing.document.mcpServers[serverName]) {
    return {
      ok: false,
      message: `MCP server '${serverName}' not found.`,
      configPath: existing.configPath,
    };
  }

  const document = cloneDocument(existing.document);
  const server = document.mcpServers[serverName];
  delete document.mcpServers[serverName];
  const written = writeDocument(document);
  return written.ok
    ? {
      ...written,
      server,
      message: `MCP server '${serverName}' removed.`,
    }
    : written;
}
