import { describe, expect, it } from "vitest";
import type { MCPServerConfig } from "@github/copilot-sdk";
import {
  buildCapabilityAdapterRegistry,
  resolveRuntimeCapabilityAdapters,
} from "../src/copilot/capability-adapters.js";
import { resolveAgentCapabilityPolicy } from "../src/copilot/capability-registry.js";
import type { MaxMcpServerConfig } from "../src/copilot/mcp-config.js";
import type { SkillInfo } from "../src/copilot/skills.js";

describe("capability adapters", () => {
  const skills: SkillInfo[] = [
    {
      slug: "browser-check",
      name: "Browser Check",
      description: "Inspect a browser page and report regressions.",
      directory: "/tmp/browser-check",
      source: "local",
    },
    {
      slug: "gmail-helper",
      name: "Gmail Helper",
      description: "Read email and send replies.",
      directory: "/tmp/gmail-helper",
      source: "local",
    },
    {
      slug: "taxonomyless-helper",
      name: "Taxonomyless Helper",
      description: "Bespoke operator helper with opaque wording.",
      directory: "/tmp/taxonomyless-helper",
      source: "local",
    },
  ];

  const mcpServers: Record<string, MaxMcpServerConfig> = {
    playwright: {
      command: "npx",
      args: ["-y", "playwright-mcp"],
      tools: ["browser_open", "browser_click"],
      toolPrefix: "mcp_playwright",
      toolsSource: "discovered",
      eagerDiscovery: true,
      discoveredAt: "2026-03-22T00:00:00.000Z",
    },
    unknown: {
      command: "npx",
      args: ["-y", "unknown-mcp"],
      tools: ["alpha_tool"],
    },
  };

  it("builds a unified adapter registry for external skills and MCP servers", () => {
    const registry = buildCapabilityAdapterRegistry({
      skills,
      mcpServers,
      generatedAt: "2026-03-22T00:00:00.000Z",
    });

    expect(registry.generatedAt).toBe("2026-03-22T00:00:00.000Z");
    expect(registry.totals.adapters).toBe(5);
    expect(registry.totals.skills).toBe(3);
    expect(registry.totals.mcpServers).toBe(2);
    expect(registry.totals.unclassified).toBe(2);
    expect(registry.adapters).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "skill:browser-check:local",
          family: "browser",
          sourceType: "skill",
          runtimeTarget: "/tmp/browser-check",
        }),
        expect.objectContaining({
          id: "mcp:playwright",
          family: "browser",
          sourceType: "mcp",
          sourceName: "playwright",
          toolPrefix: "mcp_playwright",
          toolsSource: "discovered",
          eagerDiscovery: true,
        }),
      ]),
    );
  });

  it("resolves only policy-allowed runtime adapters for constrained profiles", () => {
    const policy = resolveAgentCapabilityPolicy({
      toolProfile: "core",
    });

    const resolved = resolveRuntimeCapabilityAdapters({
      policy,
      skills,
      mcpServers,
    });

    expect(resolved.adapters).toEqual([
      expect.objectContaining({
        id: "skill:gmail-helper:local",
        family: "message",
        sourceType: "skill",
      }),
    ]);
    expect(resolved.skillDirectories).toEqual(["/tmp/gmail-helper"]);
    expect(resolved.mcpServers).toEqual({});
  });

  it("keeps unclassified external adapters only when the profile is fully unrestricted", () => {
    const unrestricted = resolveRuntimeCapabilityAdapters({
      policy: resolveAgentCapabilityPolicy({ toolProfile: "all" }),
      skills,
      mcpServers,
    });
    const unrestrictedIds = unrestricted.adapters.map((adapter) => adapter.id);
    expect(unrestrictedIds).toContain("skill:taxonomyless-helper:local");
    expect(unrestrictedIds).toContain("mcp:unknown");

    const narrowed = resolveRuntimeCapabilityAdapters({
      policy: resolveAgentCapabilityPolicy({
        toolProfile: "all",
        blockedCapabilityFamilies: ["browser"],
      }),
      skills,
      mcpServers,
    });
    const narrowedIds = narrowed.adapters.map((adapter) => adapter.id);
    expect(narrowedIds).not.toContain("skill:taxonomyless-helper:local");
    expect(narrowedIds).not.toContain("mcp:unknown");
  });
});
