import { describe, expect, it } from "vitest";
import type { MCPServerConfig } from "@github/copilot-sdk";
import {
  buildCapabilityRegistry,
  filterCapabilityRegistry,
  inferMcpCapabilityFamily,
  inferSkillCapabilityFamily,
} from "../src/copilot/capability-registry.js";
import type { SkillInfo } from "../src/copilot/skills.js";

describe("capability registry", () => {
  it("builds all OpenClaw-style families and keeps built-in coverage visible", () => {
    const registry = buildCapabilityRegistry({
      skills: [],
      mcpServers: {},
      generatedAt: "2026-03-22T00:00:00.000Z",
    });

    expect(registry.generatedAt).toBe("2026-03-22T00:00:00.000Z");
    expect(registry.families).toHaveLength(8);
    expect(registry.families.map((family) => family.id)).toEqual([
      "browser",
      "web",
      "fs",
      "runtime",
      "message",
      "cron",
      "image",
      "sessions",
    ]);
    expect(registry.families.find((family) => family.id === "sessions")?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "builtin-sessions-workers" }),
        expect.objectContaining({ id: "builtin-sessions-machine" }),
      ]),
    );
    expect(registry.families.find((family) => family.id === "runtime")?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "builtin-runtime-harness" }),
        expect.objectContaining({ id: "builtin-runtime-control" }),
      ]),
    );
  });

  it("classifies skills and MCP servers into the registry while keeping unknown providers unclassified", () => {
    const skills: SkillInfo[] = [
      {
        slug: "browser-check",
        name: "Browser Check",
        description: "Inspect a browser page and report regressions.",
        directory: "/tmp/browser-check",
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

    const mcpServers: Record<string, MCPServerConfig> = {
      playwright: {
        command: "npx",
        args: ["-y", "playwright-mcp"],
        tools: ["browser_open", "browser_click", "page_snapshot"],
      },
      unknown: {
        command: "npx",
        args: ["-y", "unknown-mcp"],
        tools: ["alpha_tool"],
      },
    };

    const registry = buildCapabilityRegistry({ skills, mcpServers });
    const browserFamily = registry.families.find((family) => family.id === "browser");

    expect(browserFamily?.capabilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skill:browser-check:local", sourceType: "skill" }),
        expect.objectContaining({ id: "mcp:playwright", sourceType: "mcp" }),
      ]),
    );
    expect(registry.unclassified.skills).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "skill:taxonomyless-helper", sourceType: "skill" }),
      ]),
    );
    expect(registry.unclassified.mcpServers).toEqual([
      expect.objectContaining({ id: "mcp:unknown", sourceType: "mcp" }),
    ]);
  });

  it("supports family/query filtering and exposes inference helpers", () => {
    expect(inferSkillCapabilityFamily({
      slug: "gmail-helper",
      name: "Gmail Helper",
      description: "Read email and send replies.",
    })).toBe("message");

    expect(inferMcpCapabilityFamily("playwright", {
      tools: ["browser_open", "browser_click"],
    })).toBe("browser");

    const registry = buildCapabilityRegistry({
      skills: [
        {
          slug: "browser-check",
          name: "Browser Check",
          description: "Inspect a browser page and summarize issues.",
          directory: "/tmp/browser-check",
          source: "local",
        },
      ],
      mcpServers: {},
    });

    const filtered = filterCapabilityRegistry(registry, {
      family: "browser",
      query: "browser",
    });

    expect(filtered.families).toHaveLength(1);
    expect(filtered.families[0].id).toBe("browser");
    expect(filtered.families[0].capabilities).toEqual([
      expect.objectContaining({ id: "skill:browser-check:local" }),
    ]);
  });
});
