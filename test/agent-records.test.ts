import { describe, expect, it } from "vitest";
import { normalizeAgentRecord } from "../packages/dashboard/src/lib/agent-records.js";

describe("agent record normalization", () => {
  it("defaults missing capability-family arrays to empty lists", () => {
    const record = normalizeAgentRecord({
      id: 1,
      projectId: 1,
      projectName: "Max",
      slug: "ops-agent",
      name: "Ops Agent",
      agentType: "custom",
      workingDir: "/tmp/max",
      model: null,
      defaultPrompt: null,
      heartbeatPrompt: null,
      heartbeatIntervalSeconds: null,
      toolProfile: "all",
      allowedCapabilityFamilies: undefined as never,
      blockedCapabilityFamilies: undefined as never,
      automationEnabled: true,
      status: "idle",
      lastHeartbeatAt: null,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    });

    expect(record.allowedCapabilityFamilies).toEqual([]);
    expect(record.blockedCapabilityFamilies).toEqual([]);
  });

  it("filters invalid families and falls back invalid tool profiles", () => {
    const record = normalizeAgentRecord({
      id: 2,
      projectId: 1,
      projectName: "Max",
      slug: "delivery-agent",
      name: "Delivery Agent",
      agentType: "custom",
      workingDir: "/tmp/max",
      model: null,
      defaultPrompt: null,
      heartbeatPrompt: null,
      heartbeatIntervalSeconds: null,
      toolProfile: "invalid" as never,
      allowedCapabilityFamilies: ["web", "bogus"] as never,
      blockedCapabilityFamilies: ["runtime", 7] as never,
      automationEnabled: undefined as never,
      status: "idle",
      lastHeartbeatAt: null,
      createdAt: "2026-03-22T00:00:00.000Z",
      updatedAt: "2026-03-22T00:00:00.000Z",
    });

    expect(record.toolProfile).toBe("all");
    expect(record.allowedCapabilityFamilies).toEqual(["web"]);
    expect(record.blockedCapabilityFamilies).toEqual(["runtime"]);
    expect(record.automationEnabled).toBe(true);
  });
});
