import { describe, expect, it } from "vitest";
import {
  buildAgentRecoveryPrompt,
  buildScheduleExecutionPrompt,
  buildHeartbeatExecutionPrompt,
  buildAgentSystemPrompt,
  buildTaskExecutionPrompt,
  forgetAgentRuntime,
} from "../src/control-plane/runtime.js";
import { getWorkers } from "../src/copilot/orchestrator.js";
import type { WorkerInfo } from "../src/copilot/tools.js";
import type {
  AgentChatMessage,
  AgentRuntimeRecord,
  ScheduleRecord,
  TaskRecord,
} from "../src/control-plane/store.js";

function makeAgent(overrides: Partial<AgentRuntimeRecord> = {}): AgentRuntimeRecord {
  return {
    id: 7,
    projectId: 3,
    projectName: "Max",
    slug: "docs-agent",
    name: "Docs Agent",
    agentType: "custom",
    workingDir: "/tmp/max-docs",
    model: "gpt-5.4",
    defaultPrompt: "Keep the documentation aligned with shipped behavior.",
    heartbeatPrompt: "Publish the next one-shot update now.",
    heartbeatIntervalSeconds: 60,
    automationEnabled: true,
    status: "idle",
    lastHeartbeatAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    copilotSessionId: "session-123",
    ...overrides,
  };
}

function makeMessage(id: number, role: AgentChatMessage["role"], content: string): AgentChatMessage {
  return {
    id,
    agentId: 7,
    role,
    content,
    createdAt: `2025-01-01T00:00:0${id}.000Z`,
  };
}

function makeTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 11,
    projectId: 3,
    projectName: "Max",
    agentId: 7,
    agentName: "Docs Agent",
    slug: "publish-docs",
    title: "Publish docs",
    description: "Generate and publish the release notes page.",
    prompt: "Update the docs site with the latest release notes and summarize what changed.",
    status: "pending",
    workerName: null,
    result: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    startedAt: null,
    completedAt: null,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<ScheduleRecord> = {}): ScheduleRecord {
  return {
    id: 5,
    projectId: 3,
    projectName: "Max",
    agentId: 7,
    agentName: "Docs Agent",
    slug: "nightly-docs",
    name: "Nightly docs sync",
    scheduleType: "cron",
    expression: "0 2 * * *",
    taskPrompt: "Refresh the docs from the latest merged changes.",
    enabled: true,
    lastRunAt: null,
    nextRunAt: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("control-plane agent runtime helpers", () => {
  it("builds a system prompt with mission, model, and working directory", () => {
    const prompt = buildAgentSystemPrompt(makeAgent());
    expect(prompt).toContain("Docs Agent");
    expect(prompt).toContain("gpt-5.4");
    expect(prompt).toContain("/tmp/max-docs");
    expect(prompt).toContain("Keep the documentation aligned");
  });

  it("builds a recovery prompt from chronological chat history", () => {
    const prompt = buildAgentRecoveryPrompt([
      makeMessage(1, "user", "Summarize the release notes."),
      makeMessage(2, "assistant", "I'll inspect the latest changelog."),
    ]);
    expect(prompt).toContain("Operator: Summarize the release notes.");
    expect(prompt).toContain("Agent: I'll inspect the latest changelog.");
    expect(prompt).toContain("Do not answer this recovery payload");
  });

  it("returns an empty recovery prompt when there is no history", () => {
    expect(buildAgentRecoveryPrompt([])).toBe("");
  });

  it("ignores heartbeat automation turns during recovery", () => {
    const prompt = buildAgentRecoveryPrompt([
      makeMessage(1, "user", "Keep the browser ready."),
      makeMessage(2, "assistant", "Understood."),
      makeMessage(3, "system", "[Automatic heartbeat execution]\nOpen Safari now."),
      makeMessage(4, "assistant", "Detached loop started to activate Safari every 30 seconds."),
      makeMessage(5, "user", "Report only manual operator context."),
    ]);

    expect(prompt).toContain("Operator: Keep the browser ready.");
    expect(prompt).toContain("Operator: Report only manual operator context.");
    expect(prompt).not.toContain("Automatic heartbeat execution");
    expect(prompt).not.toContain("Detached loop started");
  });

  it("formats a run-now prompt for tasks", () => {
    const prompt = buildTaskExecutionPrompt(makeTask());
    expect(prompt).toContain('Execute the task "Publish docs"');
    expect(prompt).toContain("Task instructions:");
    expect(prompt).toContain("Generate and publish the release notes page.");
  });

  it("formats a run-now prompt for schedules", () => {
    const prompt = buildScheduleExecutionPrompt(makeSchedule());
    expect(prompt).toContain('Execute schedule "Nightly docs sync"');
    expect(prompt).toContain("Expression: 0 2 * * *");
    expect(prompt).toContain("Refresh the docs from the latest merged changes.");
  });

  it("formats a one-shot prompt for heartbeat-triggered execution", () => {
    const prompt = buildHeartbeatExecutionPrompt(makeAgent({
      heartbeatPrompt: "Open Finder now.",
    }));
    expect(prompt).toContain('Run exactly one execution tick for agent "Docs Agent"');
    expect(prompt).toContain("The control plane owns the 60s cadence");
    expect(prompt).toContain("do not create your own loops");
    expect(prompt).toContain("Do not start detached/background processes");
    expect(prompt).toContain("Heartbeat tick prompt:");
    expect(prompt).toContain("Open Finder now.");
  });

  it("destroys and forgets a managed worker when the agent runtime is removed", async () => {
    let destroyed = false;
    const destroy = async () => {
      destroyed = true;
    };
    const workerName = "control-agent-7";
    const workers = getWorkers();
    workers.set(workerName, {
      name: workerName,
      session: { destroy } as WorkerInfo["session"],
      workingDir: "(control-plane)",
      status: "idle",
    });

    forgetAgentRuntime(7);
    await Promise.resolve();

    expect(destroyed).toBe(true);
    expect(workers.has(workerName)).toBe(false);
  });
});
