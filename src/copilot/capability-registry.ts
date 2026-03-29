import type { MCPServerConfig } from "@github/copilot-sdk";
import { loadMcpConfig } from "./mcp-config.js";
import { listSkills, type SkillInfo } from "./skills.js";

export const CAPABILITY_FAMILIES = [
  "browser",
  "web",
  "fs",
  "runtime",
  "message",
  "cron",
  "image",
  "sessions",
] as const;

export type CapabilityFamily = (typeof CAPABILITY_FAMILIES)[number];
export type CapabilitySource = "builtin" | "skill" | "mcp";
export const TOOL_PROFILES = ["all", "core", "delivery", "automation"] as const;
export type ToolProfile = (typeof TOOL_PROFILES)[number];

export interface CapabilityRecord {
  id: string;
  family: CapabilityFamily;
  name: string;
  description: string;
  sourceType: CapabilitySource;
  sourceName: string;
  available: boolean;
  tools: string[];
  surfaces: string[];
}

export interface CapabilityFamilyGroup {
  id: CapabilityFamily;
  label: string;
  description: string;
  capabilityCount: number;
  availableCount: number;
  capabilities: CapabilityRecord[];
}

export interface UnclassifiedCapabilitySource {
  id: string;
  name: string;
  description: string;
  sourceType: Exclude<CapabilitySource, "builtin">;
}

export interface CapabilityRegistry {
  generatedAt: string;
  totals: {
    families: number;
    populatedFamilies: number;
    capabilities: number;
    unclassified: number;
  };
  families: CapabilityFamilyGroup[];
  unclassified: {
    skills: UnclassifiedCapabilitySource[];
    mcpServers: UnclassifiedCapabilitySource[];
  };
}

export interface AgentCapabilityPolicy {
  toolProfile: ToolProfile;
  allowedCapabilityFamilies: CapabilityFamily[];
  blockedCapabilityFamilies: CapabilityFamily[];
  effectiveFamilies: CapabilityFamily[];
  allowUnclassifiedMcp: boolean;
}

const FAMILY_METADATA: Record<CapabilityFamily, { label: string; description: string }> = {
  browser: {
    label: "Browser",
    description: "Interactive browser automation, page navigation, and browser-aware inspection flows.",
  },
  web: {
    label: "Web",
    description: "HTTP, crawling, extraction, and broader web data acquisition capabilities.",
  },
  fs: {
    label: "Filesystem",
    description: "File and workspace operations, whether native or mediated through managed workers.",
  },
  runtime: {
    label: "Runtime",
    description: "Daemon, harness, model routing, and execution-control capabilities owned by Max.",
  },
  message: {
    label: "Message",
    description: "Conversation channels, long-term memory, and message-adjacent operator surfaces.",
  },
  cron: {
    label: "Cron",
    description: "Scheduling, heartbeat automation, and recurring control-plane execution semantics.",
  },
  image: {
    label: "Image",
    description: "Image capture, screenshots, photo delivery, and image-aware operator workflows.",
  },
  sessions: {
    label: "Sessions",
    description: "Copilot session creation, attachment, routing, recovery, and managed session control.",
  },
};

const TOOL_PROFILE_METADATA: Record<ToolProfile, {
  label: string;
  description: string;
  families: CapabilityFamily[];
}> = {
  all: {
    label: "All capabilities",
    description: "Expose all currently mapped families and keep unclassified MCP servers available.",
    families: [...CAPABILITY_FAMILIES],
  },
  core: {
    label: "Core operator",
    description: "Keep the agent focused on Max-native operator control: sessions, runtime, and messaging.",
    families: ["sessions", "runtime", "message"],
  },
  delivery: {
    label: "Delivery and comms",
    description: "Bias toward communication-heavy work with messaging, image, and web-facing capabilities.",
    families: ["sessions", "runtime", "message", "web", "image"],
  },
  automation: {
    label: "Automation and execution",
    description: "Bias toward automation, scheduling, browser/web work, and worker-backed execution flows.",
    families: ["sessions", "runtime", "cron", "fs", "web", "browser"],
  },
};

const FAMILY_KEYWORDS: Record<CapabilityFamily, readonly string[]> = {
  browser: ["browser", "playwright", "chrome", "tab", "page", "dom", "webdriver"],
  web: ["web", "http", "https", "fetch", "crawl", "scrape", "request", "url", "api"],
  fs: ["file", "files", "filesystem", "fs", "directory", "folder", "path", "workspace"],
  runtime: ["runtime", "daemon", "model", "shell", "terminal", "command", "process", "harness"],
  message: ["message", "messages", "chat", "telegram", "gmail", "email", "mail", "whatsapp", "inbox"],
  cron: ["cron", "schedule", "scheduler", "heartbeat", "interval", "timer", "automation"],
  image: ["image", "images", "photo", "photos", "vision", "screenshot", "media", "camera"],
  sessions: ["session", "sessions", "worker", "workers", "copilot", "resume", "attach"],
};

const BUILTIN_CAPABILITIES: ReadonlyArray<Omit<CapabilityRecord, "available">> = [
  {
    id: "builtin-sessions-workers",
    family: "sessions",
    name: "Managed worker sessions",
    description: "Create, inspect, and terminate Max-owned Copilot worker sessions for delegated work.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: [
      "create_worker_session",
      "send_to_worker",
      "list_sessions",
      "check_session_status",
      "kill_session",
    ],
    surfaces: [
      "tool:create_worker_session",
      "tool:send_to_worker",
      "tool:list_sessions",
      "tool:check_session_status",
      "tool:kill_session",
    ],
  },
  {
    id: "builtin-sessions-machine",
    family: "sessions",
    name: "Native machine session attachment",
    description: "Discover existing Copilot sessions on the machine, attach them, and route work toward them.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: ["list_machine_sessions", "attach_machine_session"],
    surfaces: [
      "tool:list_machine_sessions",
      "tool:attach_machine_session",
      "api:/native-sessions/*",
      "dashboard:/workers",
      "dashboard:/chat",
    ],
  },
  {
    id: "builtin-fs-worker-mediated",
    family: "fs",
    name: "Worker-mediated filesystem operations",
    description: "Filesystem work is currently exposed through managed Copilot workers rather than a Max-native file API.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: ["create_worker_session", "send_to_worker"],
    surfaces: ["tool:create_worker_session", "tool:send_to_worker"],
  },
  {
    id: "builtin-runtime-harness",
    family: "runtime",
    name: "Harness orchestration",
    description: "Run long-lived multi-step projects through the built-in initializer/coding harness flow.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: ["harness_status", "continue_harness"],
    surfaces: ["tool:harness_status", "tool:continue_harness", "api:/harness*"],
  },
  {
    id: "builtin-runtime-control",
    family: "runtime",
    name: "Daemon and model control",
    description: "Control Max runtime behavior, including model routing and daemon lifecycle operations.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: [
      "list_skills",
      "learn_skill",
      "uninstall_skill",
      "list_models",
      "switch_model",
      "toggle_auto",
      "restart_max",
    ],
    surfaces: [
      "tool:list_skills",
      "tool:learn_skill",
      "tool:uninstall_skill",
      "tool:list_models",
      "tool:switch_model",
      "tool:toggle_auto",
      "tool:restart_max",
      "dashboard:/control",
    ],
  },
  {
    id: "builtin-message-channels",
    family: "message",
    name: "Message ingress and operator chat",
    description: "Telegram, TUI, background events, HTTP, and dashboard chat all route through Max-owned messaging surfaces.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: [],
    surfaces: ["telegram", "tui", "background", "api:/ask", "dashboard:/chat"],
  },
  {
    id: "builtin-message-memory",
    family: "message",
    name: "Long-term memory",
    description: "Persist and recall user facts and scoped memory across orchestrator, agent, and native-session flows.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: ["remember", "recall", "forget"],
    surfaces: [
      "tool:remember",
      "tool:recall",
      "tool:forget",
      "api:/memory",
      "api:/control/agents/:id/memory",
      "api:/native-sessions/:name/memory",
      "dashboard:/chat",
    ],
  },
  {
    id: "builtin-cron-scheduler",
    family: "cron",
    name: "Control-plane schedules and heartbeats",
    description: "The control plane can run schedules, heartbeat automation, and one-shot recurring agent work.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: [],
    surfaces: [
      "api:/control/schedules",
      "api:/control/schedules/:id/run",
      "api:/control/schedules/:id/toggle",
      "api:/control/agents/:id/heartbeat",
      "dashboard:/control",
    ],
  },
  {
    id: "builtin-image-telegram",
    family: "image",
    name: "Telegram photo delivery",
    description: "Max can push images or screenshots back to Telegram via its owned photo delivery endpoint.",
    sourceType: "builtin",
    sourceName: "Max",
    tools: [],
    surfaces: ["api:/send-photo", "telegram"],
  },
];

const SOURCE_ORDER: Record<CapabilitySource, number> = {
  builtin: 0,
  skill: 1,
  mcp: 2,
};

const BUILTIN_TOOL_FAMILY: Record<string, CapabilityFamily> = {
  create_worker_session: "sessions",
  send_to_worker: "sessions",
  list_sessions: "sessions",
  check_session_status: "sessions",
  kill_session: "sessions",
  list_machine_sessions: "sessions",
  attach_machine_session: "sessions",
  list_skills: "runtime",
  learn_skill: "runtime",
  uninstall_skill: "runtime",
  list_models: "runtime",
  switch_model: "runtime",
  toggle_auto: "runtime",
  restart_max: "runtime",
  harness_status: "runtime",
  continue_harness: "runtime",
  remember: "message",
  recall: "message",
  forget: "message",
};

function sanitizeTools(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools.filter((tool): tool is string => typeof tool === "string" && tool.trim().length > 0);
}

function buildSearchText(parts: Array<string | undefined>): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" ")
    .toLowerCase();
}

function inferCapabilityFamilyFromText(parts: Array<string | undefined>): CapabilityFamily | null {
  const haystack = buildSearchText(parts);
  if (!haystack) return null;

  let bestFamily: CapabilityFamily | null = null;
  let bestScore = 0;

  for (const family of CAPABILITY_FAMILIES) {
    let score = 0;
    for (const keyword of FAMILY_KEYWORDS[family]) {
      if (haystack.includes(keyword)) {
        score += keyword.length >= 6 ? 3 : 2;
      }
    }

    if (score > bestScore) {
      bestFamily = family;
      bestScore = score;
    }
  }

  return bestScore > 0 ? bestFamily : null;
}

function matchesAny(text: string, tokens: readonly string[]): boolean {
  return tokens.some((token) => text.includes(token));
}

export function isCapabilityFamily(value: string): value is CapabilityFamily {
  return CAPABILITY_FAMILIES.includes(value as CapabilityFamily);
}

export function isToolProfile(value: string): value is ToolProfile {
  return TOOL_PROFILES.includes(value as ToolProfile);
}

export function inferSkillCapabilityFamily(skill: Pick<SkillInfo, "slug" | "name" | "description">): CapabilityFamily | null {
  return inferCapabilityFamilyFromText([skill.slug, skill.name, skill.description]);
}

export function inferMcpCapabilityFamily(
  serverName: string,
  serverConfig: Pick<MCPServerConfig, "tools">,
): CapabilityFamily | null {
  const tools = sanitizeTools(serverConfig.tools);
  const toolText = buildSearchText(tools);

  if (matchesAny(toolText, ["browser_", "playwright", "page_", "tab_", "screenshot"])) {
    return "browser";
  }
  if (matchesAny(toolText, ["http_", "fetch_", "request_", "crawl", "scrape", "graphql", "ws_"])) {
    return "web";
  }
  if (matchesAny(toolText, ["file_", "fs_", "directory_", "path_", "upload", "download"])) {
    return "fs";
  }
  if (matchesAny(toolText, ["session_", "worker_", "resume_", "attach_"])) {
    return "sessions";
  }
  if (matchesAny(toolText, ["schedule_", "cron_", "heartbeat_", "timer_"])) {
    return "cron";
  }
  if (matchesAny(toolText, ["image_", "vision_", "photo_", "ocr_", "camera_"])) {
    return "image";
  }
  if (matchesAny(toolText, ["message_", "mail_", "gmail_", "whatsapp_", "telegram_", "chat_"])) {
    return "message";
  }
  if (matchesAny(toolText, ["runtime_", "shell_", "command_", "process_", "daemon_"])) {
    return "runtime";
  }

  return inferCapabilityFamilyFromText([serverName, ...tools]);
}

export function normalizeCapabilityFamilies(values: readonly string[] | null | undefined): CapabilityFamily[] {
  if (!Array.isArray(values)) return [];
  const deduped = new Set<CapabilityFamily>();
  for (const value of values) {
    if (typeof value === "string" && isCapabilityFamily(value)) {
      deduped.add(value);
    }
  }
  return [...deduped];
}

export function normalizeToolProfile(value: string | null | undefined): ToolProfile {
  return typeof value === "string" && isToolProfile(value) ? value : "all";
}

export function resolveAgentCapabilityPolicy(input: {
  toolProfile?: string | null;
  allowedCapabilityFamilies?: readonly string[] | null;
  blockedCapabilityFamilies?: readonly string[] | null;
}): AgentCapabilityPolicy {
  const toolProfile = normalizeToolProfile(input.toolProfile);
  const allowedCapabilityFamilies = normalizeCapabilityFamilies(input.allowedCapabilityFamilies);
  const blockedCapabilityFamilies = normalizeCapabilityFamilies(input.blockedCapabilityFamilies);

  const profileFamilies = TOOL_PROFILE_METADATA[toolProfile].families;
  const intersectedFamilies = allowedCapabilityFamilies.length > 0
    ? profileFamilies.filter((family) => allowedCapabilityFamilies.includes(family))
    : [...profileFamilies];
  const effectiveFamilies = intersectedFamilies.filter((family) => !blockedCapabilityFamilies.includes(family));

  return {
    toolProfile,
    allowedCapabilityFamilies,
    blockedCapabilityFamilies,
    effectiveFamilies,
    allowUnclassifiedMcp: toolProfile === "all"
      && allowedCapabilityFamilies.length === 0
      && blockedCapabilityFamilies.length === 0,
  };
}

export function describeAgentCapabilityPolicy(policy: AgentCapabilityPolicy): string {
  const label = TOOL_PROFILE_METADATA[policy.toolProfile].label;
  const effective = policy.effectiveFamilies.join(", ") || "(none)";
  const allowlist = policy.allowedCapabilityFamilies.join(", ") || "inherit profile";
  const blocklist = policy.blockedCapabilityFamilies.join(", ") || "none";

  return [
    `Tool profile: ${label} (${policy.toolProfile}).`,
    `Effective families: ${effective}.`,
    `Allowlist override: ${allowlist}.`,
    `Blocklist override: ${blocklist}.`,
    policy.allowUnclassifiedMcp
      ? "Unclassified external adapters (skills and MCP servers) remain available because the profile is unrestricted."
      : "Unclassified external adapters are disabled unless they are mapped into an allowed family.",
  ].join(" ");
}

export function filterBuiltinToolsByPolicy<T extends { name?: string }>(
  tools: T[],
  policy: AgentCapabilityPolicy,
): T[] {
  return tools.filter((tool) => {
    const name = tool.name;
    if (!name) return true;
    const family = BUILTIN_TOOL_FAMILY[name];
    if (!family) return policy.toolProfile === "all";
    return policy.effectiveFamilies.includes(family);
  });
}

export function filterMcpServersByPolicy(
  mcpServers: Record<string, MCPServerConfig>,
  policy: AgentCapabilityPolicy,
): Record<string, MCPServerConfig> {
  return Object.fromEntries(
    Object.entries(mcpServers).filter(([name, config]) => {
      const family = inferMcpCapabilityFamily(name, config);
      if (!family) return policy.allowUnclassifiedMcp;
      return policy.effectiveFamilies.includes(family);
    }),
  );
}

function buildBuiltinCapabilities(): CapabilityRecord[] {
  return BUILTIN_CAPABILITIES.map((capability) => ({
    ...capability,
    available: true,
  }));
}

function buildSkillCapabilities(skills: SkillInfo[]): {
  capabilities: CapabilityRecord[];
  unclassified: UnclassifiedCapabilitySource[];
} {
  const capabilities: CapabilityRecord[] = [];
  const unclassified: UnclassifiedCapabilitySource[] = [];

  for (const skill of skills) {
    const family = inferSkillCapabilityFamily(skill);
    if (!family) {
      unclassified.push({
        id: `skill:${skill.slug}`,
        name: skill.name,
        description: skill.description,
        sourceType: "skill",
      });
      continue;
    }

    capabilities.push({
      id: `skill:${skill.slug}:${skill.source}`,
      family,
      name: skill.name,
      description: skill.description,
      sourceType: "skill",
      sourceName: skill.slug,
      available: true,
      tools: [],
      surfaces: [`skills:${skill.slug}`, `skill-source:${skill.source}`],
    });
  }

  return { capabilities, unclassified };
}

function buildMcpCapabilities(mcpServers: Record<string, MCPServerConfig>): {
  capabilities: CapabilityRecord[];
  unclassified: UnclassifiedCapabilitySource[];
} {
  const capabilities: CapabilityRecord[] = [];
  const unclassified: UnclassifiedCapabilitySource[] = [];

  for (const [name, config] of Object.entries(mcpServers)) {
    const family = inferMcpCapabilityFamily(name, config);
    const tools = sanitizeTools(config.tools);
    const description = tools.length > 0
      ? `Configured MCP server exposing ${tools.length} tool${tools.length === 1 ? "" : "s"}.`
      : "Configured MCP server with no explicit tools declared.";

    if (!family) {
      unclassified.push({
        id: `mcp:${name}`,
        name,
        description,
        sourceType: "mcp",
      });
      continue;
    }

    capabilities.push({
      id: `mcp:${name}`,
      family,
      name,
      description,
      sourceType: "mcp",
      sourceName: name,
      available: true,
      tools,
      surfaces: [`mcp:${name}`],
    });
  }

  return { capabilities, unclassified };
}

function sortCapabilities(capabilities: CapabilityRecord[]): CapabilityRecord[] {
  return [...capabilities].sort((left, right) => {
    const sourceDelta = SOURCE_ORDER[left.sourceType] - SOURCE_ORDER[right.sourceType];
    if (sourceDelta !== 0) return sourceDelta;
    return left.name.localeCompare(right.name);
  });
}

function summarizeRegistry(
  families: CapabilityFamilyGroup[],
  unclassified: CapabilityRegistry["unclassified"],
): CapabilityRegistry["totals"] {
  const capabilities = families.reduce((sum, family) => sum + family.capabilityCount, 0);
  const populatedFamilies = families.filter((family) => family.capabilityCount > 0).length;
  const unclassifiedCount = unclassified.skills.length + unclassified.mcpServers.length;

  return {
    families: families.length,
    populatedFamilies,
    capabilities,
    unclassified: unclassifiedCount,
  };
}

export function buildCapabilityRegistry(input: {
  skills?: SkillInfo[];
  mcpServers?: Record<string, MCPServerConfig>;
  generatedAt?: string;
} = {}): CapabilityRegistry {
  const skills = input.skills ?? listSkills();
  const mcpServers = input.mcpServers ?? loadMcpConfig();

  const builtinCapabilities = buildBuiltinCapabilities();
  const skillCapabilities = buildSkillCapabilities(skills);
  const mcpCapabilities = buildMcpCapabilities(mcpServers);

  const allCapabilities = [
    ...builtinCapabilities,
    ...skillCapabilities.capabilities,
    ...mcpCapabilities.capabilities,
  ];

  const families = CAPABILITY_FAMILIES.map((family): CapabilityFamilyGroup => {
    const capabilities = sortCapabilities(allCapabilities.filter((capability) => capability.family === family));
    return {
      id: family,
      label: FAMILY_METADATA[family].label,
      description: FAMILY_METADATA[family].description,
      capabilityCount: capabilities.length,
      availableCount: capabilities.filter((capability) => capability.available).length,
      capabilities,
    };
  });

  const unclassified = {
    skills: [...skillCapabilities.unclassified].sort((left, right) => left.name.localeCompare(right.name)),
    mcpServers: [...mcpCapabilities.unclassified].sort((left, right) => left.name.localeCompare(right.name)),
  };

  return {
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    totals: summarizeRegistry(families, unclassified),
    families,
    unclassified,
  };
}

export function filterCapabilityRegistry(
  registry: CapabilityRegistry,
  options: { family?: CapabilityFamily; query?: string } = {},
): CapabilityRegistry {
  const query = options.query?.trim().toLowerCase() ?? "";

  const families = registry.families
    .filter((family) => !options.family || family.id === options.family)
    .map((family) => {
      if (!query) return family;

      const capabilities = family.capabilities.filter((capability) => {
        const haystack = buildSearchText([
          capability.name,
          capability.description,
          capability.sourceName,
          capability.tools.join(" "),
          capability.surfaces.join(" "),
          family.label,
        ]);
        return haystack.includes(query);
      });

      return {
        ...family,
        capabilityCount: capabilities.length,
        availableCount: capabilities.filter((capability) => capability.available).length,
        capabilities,
      };
    });

  const nextUnclassified = query
    ? {
        skills: registry.unclassified.skills.filter((entry) => buildSearchText([entry.name, entry.description]).includes(query)),
        mcpServers: registry.unclassified.mcpServers.filter((entry) => buildSearchText([entry.name, entry.description]).includes(query)),
      }
    : registry.unclassified;

  return {
    ...registry,
    families,
    unclassified: nextUnclassified,
    totals: summarizeRegistry(families, nextUnclassified),
  };
}
