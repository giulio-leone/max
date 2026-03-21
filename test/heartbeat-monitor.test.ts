import { describe, expect, it } from "vitest";
import { buildAutomaticHeartbeat } from "../src/control-plane/heartbeat-monitor.js";
import type { AgentRecord } from "../src/control-plane/store.js";
import type { WorkerInfo } from "../src/copilot/tools.js";

function makeAgent(overrides: Partial<AgentRecord> = {}): AgentRecord {
  return {
    id: 9,
    projectId: 3,
    projectName: "Max",
    slug: "ops-agent",
    name: "Ops Agent",
    agentType: "operator",
    workingDir: "/Users/giulioleone/Sviluppo/Max",
    model: "gpt-5-mini",
    defaultPrompt: null,
    heartbeatPrompt: null,
    heartbeatIntervalSeconds: 30,
    automationEnabled: true,
    status: "healthy",
    lastHeartbeatAt: null,
    createdAt: "2026-03-21 20:00:00",
    updatedAt: "2026-03-21 20:00:00",
    ...overrides,
  };
}

function makeWorker(status: WorkerInfo["status"]): WorkerInfo {
  return {
    name: "control-agent-9",
    session: {} as WorkerInfo["session"],
    workingDir: "/Users/giulioleone/Sviluppo/Max",
    status,
  };
}

describe("heartbeat-monitor", () => {
  it("does not emit for agents without an interval", () => {
    expect(buildAutomaticHeartbeat(
      makeAgent({ heartbeatIntervalSeconds: null }),
      makeWorker("idle"),
      new Date("2026-03-21T20:00:00.000Z"),
    )).toBeNull();
  });

  it("does not emit when the heartbeat is still fresh", () => {
    expect(buildAutomaticHeartbeat(
      makeAgent({ lastHeartbeatAt: "2026-03-21 20:00:20" }),
      makeWorker("idle"),
      new Date("2026-03-21T20:00:40.000Z"),
    )).toBeNull();
  });

  it("emits a running heartbeat for active workers", () => {
    expect(buildAutomaticHeartbeat(
      makeAgent({ lastHeartbeatAt: "2026-03-21 20:00:00" }),
      makeWorker("running"),
      new Date("2026-03-21T20:00:45.000Z"),
    )).toEqual({
      status: "running",
      message: "Automatic running heartbeat",
    });
  });

  it("emits an error heartbeat for errored workers", () => {
    expect(buildAutomaticHeartbeat(
      makeAgent({ lastHeartbeatAt: "2026-03-21 20:00:00" }),
      makeWorker("error"),
      new Date("2026-03-21T20:00:45.000Z"),
    )).toEqual({
      status: "error",
      message: "Automatic error heartbeat",
    });
  });

  it("emits a healthy heartbeat for idle workers", () => {
    expect(buildAutomaticHeartbeat(
      makeAgent({ lastHeartbeatAt: "2026-03-21 20:00:00" }),
      makeWorker("idle"),
      new Date("2026-03-21T20:00:45.000Z"),
    )).toEqual({
      status: "healthy",
      message: "Automatic idle heartbeat",
    });
  });
});
