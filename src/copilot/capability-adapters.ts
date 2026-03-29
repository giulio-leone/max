import type { MCPServerConfig } from "@github/copilot-sdk";
import {
  inferMcpCapabilityFamily,
  inferSkillCapabilityFamily,
  type AgentCapabilityPolicy,
  type CapabilityFamily,
  type CapabilitySource,
} from "./capability-registry.js";
import { loadMaxMcpConfig, type MaxMcpServerConfig, type McpToolSource } from "./mcp-config.js";
import { listSkills, type SkillInfo } from "./skills.js";

type ExternalCapabilitySource = Exclude<CapabilitySource, "builtin">;

export interface CapabilityAdapterRecord {
  id: string;
  family: CapabilityFamily | null;
  name: string;
  description: string;
  sourceType: ExternalCapabilitySource;
  sourceName: string;
  available: boolean;
  tools: string[];
  surfaces: string[];
  runtimeTarget: string;
  toolPrefix?: string;
  toolsSource?: McpToolSource;
  discoveredAt?: string;
  eagerDiscovery?: boolean;
}

export interface CapabilityAdapterRegistry {
  generatedAt: string;
  totals: {
    adapters: number;
    skills: number;
    mcpServers: number;
    classified: number;
    unclassified: number;
  };
  adapters: CapabilityAdapterRecord[];
}

type SkillCapabilityAdapter = CapabilityAdapterRecord & {
  sourceType: "skill";
  skill: SkillInfo;
};

type McpCapabilityAdapter = CapabilityAdapterRecord & {
  sourceType: "mcp";
  config: MaxMcpServerConfig;
};

type CapabilityAdapter = SkillCapabilityAdapter | McpCapabilityAdapter;

function sanitizeTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0);
}

function describeMcpRuntimeTarget(name: string, config: MCPServerConfig): string {
  if ("url" in config && typeof config.url === "string" && config.url.trim().length > 0) {
    return config.url;
  }

  if ("command" in config && typeof config.command === "string" && config.command.trim().length > 0) {
    const args = "args" in config && Array.isArray(config.args)
      ? config.args.filter((value: unknown): value is string => typeof value === "string").slice(0, 3).join(" ")
      : "";
    return [config.command, args].filter(Boolean).join(" ");
  }

  return `mcp:${name}`;
}

function buildSkillAdapter(skill: SkillInfo): SkillCapabilityAdapter {
  return {
    id: `skill:${skill.slug}:${skill.source}`,
    family: inferSkillCapabilityFamily(skill),
    name: skill.name,
    description: skill.description,
    sourceType: "skill",
    sourceName: skill.slug,
    available: true,
    tools: [],
    surfaces: [`skill:${skill.slug}`, `skills:${skill.source}`],
    runtimeTarget: skill.directory,
    skill,
  };
}

function buildMcpAdapter(name: string, config: MaxMcpServerConfig): McpCapabilityAdapter {
  const tools = sanitizeTools(config.tools);
  return {
    id: `mcp:${name}`,
    family: inferMcpCapabilityFamily(name, config),
    name,
    description: tools.length > 0
      ? `MCP server "${name}" exposing ${tools.length} tool${tools.length === 1 ? "" : "s"}.`
      : `MCP server "${name}" with no declared tools.`,
    sourceType: "mcp",
    sourceName: name,
    available: true,
    tools,
    surfaces: [`mcp:${name}`, "api:/mcp", "dashboard:/settings"],
    runtimeTarget: describeMcpRuntimeTarget(name, config),
    ...(typeof config.toolPrefix === "string" && config.toolPrefix.trim().length > 0 ? { toolPrefix: config.toolPrefix.trim() } : {}),
    ...(config.toolsSource ? { toolsSource: config.toolsSource } : {}),
    ...(typeof config.discoveredAt === "string" && config.discoveredAt.trim().length > 0 ? { discoveredAt: config.discoveredAt } : {}),
    ...(typeof config.eagerDiscovery === "boolean" ? { eagerDiscovery: config.eagerDiscovery } : {}),
    config,
  };
}

function compareFamilies(left: CapabilityFamily | null, right: CapabilityFamily | null): number {
  if (left === right) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left.localeCompare(right);
}

function sortAdapters(left: CapabilityAdapter, right: CapabilityAdapter): number {
  const familyDelta = compareFamilies(left.family, right.family);
  if (familyDelta !== 0) return familyDelta;

  const sourceDelta = left.sourceType.localeCompare(right.sourceType);
  if (sourceDelta !== 0) return sourceDelta;

  return left.name.localeCompare(right.name);
}

function stripRuntimeFields(adapter: CapabilityAdapter): CapabilityAdapterRecord {
  if (adapter.sourceType === "skill") {
    const { skill: _skill, ...record } = adapter;
    return record;
  }

  const { config: _config, ...record } = adapter;
  return record;
}

function summarizeRegistry(adapters: CapabilityAdapterRecord[]): CapabilityAdapterRegistry["totals"] {
  return {
    adapters: adapters.length,
    skills: adapters.filter((adapter) => adapter.sourceType === "skill").length,
    mcpServers: adapters.filter((adapter) => adapter.sourceType === "mcp").length,
    classified: adapters.filter((adapter) => adapter.family !== null).length,
    unclassified: adapters.filter((adapter) => adapter.family === null).length,
  };
}

export function buildCapabilityAdapters(input: {
  skills?: SkillInfo[];
  mcpServers?: Record<string, MaxMcpServerConfig>;
} = {}): CapabilityAdapter[] {
  const skills = input.skills ?? listSkills();
  const mcpServers = input.mcpServers ?? loadMaxMcpConfig();

  return [
    ...skills.map(buildSkillAdapter),
    ...Object.entries(mcpServers).map(([name, config]) => buildMcpAdapter(name, config)),
  ].sort(sortAdapters);
}

export function buildCapabilityAdapterRegistry(input: {
  skills?: SkillInfo[];
  mcpServers?: Record<string, MaxMcpServerConfig>;
  generatedAt?: string;
} = {}): CapabilityAdapterRegistry {
  const adapters = buildCapabilityAdapters(input).map(stripRuntimeFields);
  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals: summarizeRegistry(adapters),
    adapters,
  };
}

export function filterCapabilityAdapterRegistry(
  registry: CapabilityAdapterRegistry,
  options: {
    family?: CapabilityFamily;
    query?: string;
  } = {},
): CapabilityAdapterRegistry {
  const query = options.query?.trim().toLowerCase() ?? "";
  const adapters = registry.adapters.filter((adapter) => {
    if (options.family && adapter.family !== options.family) {
      return false;
    }

    if (!query) {
      return true;
    }

    return [
      adapter.id,
      adapter.name,
      adapter.description,
      adapter.sourceName,
      adapter.runtimeTarget,
      adapter.family ?? "",
      ...adapter.tools,
      ...adapter.surfaces,
    ].some((value) => value.toLowerCase().includes(query));
  });

  return {
    ...registry,
    totals: summarizeRegistry(adapters),
    adapters,
  };
}

export function filterCapabilityAdaptersByPolicy(
  adapters: CapabilityAdapter[],
  policy: AgentCapabilityPolicy,
): CapabilityAdapter[] {
  return adapters.filter((adapter) => {
    if (!adapter.family) {
      return policy.allowUnclassifiedMcp;
    }
    return policy.effectiveFamilies.includes(adapter.family);
  });
}

export function resolveRuntimeCapabilityAdapters(input: {
  policy: AgentCapabilityPolicy;
  skills?: SkillInfo[];
  mcpServers?: Record<string, MaxMcpServerConfig>;
}): {
  adapters: CapabilityAdapterRecord[];
  mcpServers: Record<string, MCPServerConfig>;
  skillDirectories: string[];
} {
  const filteredAdapters = filterCapabilityAdaptersByPolicy(buildCapabilityAdapters(input), input.policy);

  return {
    adapters: filteredAdapters.map(stripRuntimeFields),
    mcpServers: Object.fromEntries(
      filteredAdapters
        .filter((adapter): adapter is McpCapabilityAdapter => adapter.sourceType === "mcp")
        .map((adapter) => [adapter.sourceName, adapter.config]),
    ),
    skillDirectories: Array.from(
      new Set(
        filteredAdapters
          .filter((adapter): adapter is SkillCapabilityAdapter => adapter.sourceType === "skill")
          .map((adapter) => adapter.skill.directory),
      ),
    ),
  };
}
