import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { MaxMcpServerConfig } from "./mcp-config.js";

const DEFAULT_DISCOVERY_TIMEOUT_MS = 20_000;

export interface DiscoverableMcpServerConfig extends Omit<MaxMcpServerConfig, "tools"> {
  tools?: string[];
}

export interface DiscoveredMcpTool {
  name: string;
  description: string;
}

export interface McpDiscoveryResult {
  ok: boolean;
  message: string;
  serverName: string;
  tools: DiscoveredMcpTool[];
  server?: MaxMcpServerConfig;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms.`));
    }, timeoutMs);

    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error: unknown) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function buildHeaderFetch(headers: Record<string, string>): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const mergedHeaders = new Headers(init?.headers ?? undefined);
    for (const [name, value] of Object.entries(headers)) {
      mergedHeaders.set(name, value);
    }

    return fetch(input, {
      ...init,
      headers: mergedHeaders,
    });
  };
}

function isRemoteServerConfig(config: DiscoverableMcpServerConfig): boolean {
  return config.type === "http" || config.type === "sse";
}

function buildDiscoveryTransport(config: DiscoverableMcpServerConfig): Transport {
  if (config.type === "sse") {
    const sseConfig = config as any;
    if (typeof sseConfig.url !== "string" || sseConfig.url.trim().length === 0) {
      throw new Error("Remote SSE MCP servers require a non-empty 'url' for discovery.");
    }

    const headers = typeof sseConfig.headers === "object" && sseConfig.headers !== null ? sseConfig.headers as Record<string, string> : undefined;
    return new SSEClientTransport(new URL(sseConfig.url), {
      requestInit: headers ? { headers } : undefined,
      eventSourceInit: headers ? { fetch: buildHeaderFetch(headers) } : undefined,
    });
  }

  if (config.type === "http") {
    const httpConfig = config as any;
    if (typeof httpConfig.url !== "string" || httpConfig.url.trim().length === 0) {
      throw new Error("Remote HTTP MCP servers require a non-empty 'url' for discovery.");
    }

    const headers = typeof httpConfig.headers === "object" && httpConfig.headers !== null ? httpConfig.headers as Record<string, string> : undefined;
    return new StreamableHTTPClientTransport(new URL(httpConfig.url), {
      requestInit: headers ? { headers } : undefined,
    });
  }

  const localConfig = config as any;
  if (typeof localConfig.command !== "string" || localConfig.command.trim().length === 0) {
    throw new Error("Local MCP servers require a non-empty 'command' for discovery.");
  }

  return new StdioClientTransport({
    command: localConfig.command,
    args: Array.isArray(localConfig.args)
      ? localConfig.args.filter((value: unknown): value is string => typeof value === "string")
      : [],
    env: typeof localConfig.env === "object" && localConfig.env !== null ? localConfig.env as Record<string, string> : undefined,
    cwd: typeof localConfig.cwd === "string" && localConfig.cwd.trim().length > 0 ? localConfig.cwd : undefined,
    stderr: "pipe",
  });
}

function normalizeDiscoveredTools(rawTools: Array<{ name: string; description?: string }>): DiscoveredMcpTool[] {
  const seen = new Set<string>();
  const tools: DiscoveredMcpTool[] = [];

  for (const tool of rawTools) {
    if (typeof tool?.name !== "string") {
      continue;
    }

    const name = tool.name.trim();
    if (!name || seen.has(name)) {
      continue;
    }

    seen.add(name);
    tools.push({
      name,
      description: typeof tool.description === "string" ? tool.description : "",
    });
  }

  return tools.sort((left, right) => left.name.localeCompare(right.name));
}

function buildDiscoveredServerConfig(
  serverConfig: DiscoverableMcpServerConfig,
  tools: DiscoveredMcpTool[],
): MaxMcpServerConfig {
  return {
    ...(serverConfig as MaxMcpServerConfig),
    tools: tools.map((tool) => tool.name),
    toolsSource: "discovered",
    discoveredAt: new Date().toISOString(),
    discoveryError: undefined,
  };
}

export async function discoverMcpServerTools(
  serverName: string,
  serverConfig: DiscoverableMcpServerConfig,
): Promise<McpDiscoveryResult> {
  const timeoutMs = typeof serverConfig.discoveryTimeoutMs === "number" && Number.isFinite(serverConfig.discoveryTimeoutMs)
    ? serverConfig.discoveryTimeoutMs
    : DEFAULT_DISCOVERY_TIMEOUT_MS;

  let transport: Transport | undefined;
  try {
    transport = buildDiscoveryTransport(serverConfig);
    const client = new Client(
      { name: `max-mcp-discovery/${serverName}`, version: "1.0.0" },
      { capabilities: {} },
    );

    await withTimeout(client.connect(transport), timeoutMs, `MCP discovery connect for '${serverName}'`);
    const response = await withTimeout(
      client.listTools(),
      timeoutMs,
      `MCP discovery listTools for '${serverName}'`,
    );
    const tools = normalizeDiscoveredTools(response.tools ?? []);

    return {
      ok: true,
      message: `Discovered ${tools.length} tool${tools.length === 1 ? "" : "s"} for '${serverName}'.`,
      serverName,
      tools,
      server: buildDiscoveredServerConfig(serverConfig, tools),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message: `Failed to discover tools for '${serverName}': ${message}`,
      serverName,
      tools: [],
    };
  } finally {
    if (transport) {
      await transport.close().catch(() => undefined);
    }
  }
}

export async function prepareMcpServerConfigForPersistence(
  serverName: string,
  serverConfig: DiscoverableMcpServerConfig,
): Promise<McpDiscoveryResult> {
  if (serverConfig.eagerDiscovery === true) {
    return discoverMcpServerTools(serverName, serverConfig);
  }

  return {
    ok: true,
    message: isRemoteServerConfig(serverConfig)
      ? `Prepared remote MCP server '${serverName}' without discovery.`
      : `Prepared local MCP server '${serverName}' without discovery.`,
    serverName,
    tools: Array.isArray(serverConfig.tools)
      ? normalizeDiscoveredTools(serverConfig.tools.map((name) => ({ name })))
      : [],
    server: {
      ...(serverConfig as MaxMcpServerConfig),
      tools: Array.isArray(serverConfig.tools)
        ? serverConfig.tools.filter((tool): tool is string => typeof tool === "string")
        : [],
      toolsSource: serverConfig.toolsSource === "discovered" ? "discovered" : "configured",
      discoveryError: undefined,
    },
  };
}
