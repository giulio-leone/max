import { approveAll, type CopilotSession } from "@github/copilot-sdk";
import { config } from "../config.js";
import { getClient } from "../copilot/client.js";
import { loadMcpConfig } from "../copilot/mcp-config.js";
import { getWorkers } from "../copilot/orchestrator.js";
import { getSkillDirectories } from "../copilot/skills.js";
import { createTools, type WorkerInfo } from "../copilot/tools.js";
import { SESSIONS_DIR } from "../paths.js";
import {
  createAgentMessage,
  getAgent,
  getAgentRuntime,
  getSchedule,
  getTask,
  listAgentMessages,
  recordHeartbeat,
  updateScheduleRuntime,
  updateTaskRuntime,
  updateAgentRuntime,
  type AgentChatMessage,
  type AgentRuntimeRecord,
  type ScheduleRecord,
  type TaskRecord,
} from "./store.js";
import {
  computeNextScheduleRun,
  formatControlPlaneTimestamp,
} from "./schedule-expression.js";

const AGENT_TIMEOUT_MS = 300_000;
const RECOVERY_HISTORY_LIMIT = 12;
const workerQueues = new Map<number, Promise<void>>();

function getAgentWorkerName(agentId: number): string {
  return `control-agent-${agentId}`;
}

function trimForRecovery(content: string, limit = 1_500): string {
  return content.length > limit ? `${content.slice(0, limit)}…` : content;
}

export function buildAgentSystemPrompt(agent: AgentRuntimeRecord): string {
  const sections = [
    "You are a dedicated agent managed by Max's control plane.",
    `Agent name: ${agent.name}`,
    `Agent type: ${agent.agentType}`,
    `Preferred model: ${agent.model ?? config.copilotModel}`,
    agent.workingDir
      ? `Primary working directory: ${agent.workingDir}`
      : "No explicit working directory was configured.",
    "Stay aligned with this agent's mission, keep continuity across turns, and answer the operator directly while using tools when useful.",
  ];

  if (agent.defaultPrompt) {
    sections.push(`Default mission:\n${agent.defaultPrompt.trim()}`);
  }

  if (agent.heartbeatPrompt && agent.heartbeatIntervalSeconds) {
    sections.push(
      `Heartbeat automation is configured separately: Max may request the dedicated tick prompt every ${agent.heartbeatIntervalSeconds}s. The cadence is controlled by Max, so never create your own loops, timers, sleeps, or background schedulers.`
    );
  }

  return sections.join("\n\n");
}

export function buildAgentRecoveryPrompt(messages: AgentChatMessage[]): string {
  const filtered: AgentChatMessage[] = [];
  let skipNextAutomationAssistant = false;
  for (const message of messages) {
    if (message.role === "system" && message.content.startsWith("[Automatic heartbeat execution]")) {
      skipNextAutomationAssistant = true;
      continue;
    }
    if (skipNextAutomationAssistant && message.role === "assistant") {
      skipNextAutomationAssistant = false;
      continue;
    }
    skipNextAutomationAssistant = false;
    filtered.push(message);
  }

  const recent = filtered.slice(-RECOVERY_HISTORY_LIMIT);
  if (recent.length === 0) return "";

  const transcript = recent
    .map((message) => {
      const speaker = message.role === "user"
        ? "Operator"
        : message.role === "assistant"
          ? "Agent"
          : "System";
      return `${speaker}: ${trimForRecovery(message.content)}`;
    })
    .join("\n\n");

  return `[System: Control-plane agent recovery] Your previous session was restarted. Recover continuity from the recent conversation below. Do not answer this recovery payload. Wait for the next real operator message.\n\n${transcript}`;
}

export function buildTaskExecutionPrompt(task: TaskRecord): string {
  return [
    `[Task run-now] Execute the task "${task.title}" for project "${task.projectName}".`,
    task.description ? `Task summary: ${task.description}` : null,
    "Carry out the work, use tools when needed, and finish with a concise execution summary for the operator.",
    task.prompt ? `Task instructions:\n${task.prompt}` : null,
  ].filter((value): value is string => Boolean(value)).join("\n\n");
}

export function buildScheduleExecutionPrompt(schedule: ScheduleRecord): string {
  return [
    `[Schedule run-now] Execute schedule "${schedule.name}" for project "${schedule.projectName}".`,
    `Schedule type: ${schedule.scheduleType}`,
    `Expression: ${schedule.expression}`,
    "Treat this as a manual immediate run of the stored automation and return the concrete outcome for the operator.",
    schedule.taskPrompt ? `Scheduled instructions:\n${schedule.taskPrompt}` : null,
  ].filter((value): value is string => Boolean(value)).join("\n\n");
}

export function buildHeartbeatExecutionPrompt(agent: AgentRuntimeRecord): string {
  const prompt = agent.heartbeatPrompt?.trim();
  if (!prompt) {
    throw new Error("Add a heartbeat tick prompt before enabling heartbeat-triggered execution.");
  }

  return [
    `[Heartbeat-triggered execution] Run exactly one execution tick for agent "${agent.name}".`,
    agent.heartbeatIntervalSeconds
      ? `The control plane owns the ${agent.heartbeatIntervalSeconds}s cadence for this agent.`
      : "The control plane owns the cadence for this agent.",
    "The control plane will call you again on the next heartbeat interval, so do not create your own loops, timers, sleeps, or recurring background work.",
    "Do not start detached/background processes, do not use `&`, `nohup`, `while true`, cron, launchd, or any other mechanism that keeps repeating after this tick ends.",
    "If a previous recurring loop or background job exists from an earlier run, stop it first, then perform only the single immediate action for this tick.",
    "If the mission sounds periodic, interpret it as: perform the immediate action now, then stop and report the concrete outcome for this tick.",
    `Heartbeat tick prompt:\n${prompt}`,
  ].join("\n\n");
}

function getWorker(agent: AgentRuntimeRecord): WorkerInfo | undefined {
  return getWorkers().get(getAgentWorkerName(agent.id));
}

function createWorker(agent: AgentRuntimeRecord, session: CopilotSession): WorkerInfo {
  const worker: WorkerInfo = {
    name: getAgentWorkerName(agent.id),
    session,
    workingDir: agent.workingDir ?? "(control-plane)",
    status: "idle",
  };
  getWorkers().set(worker.name, worker);
  return worker;
}

async function resumeOrCreateAgentSession(agent: AgentRuntimeRecord): Promise<CopilotSession> {
  const client = await getClient();
  const tools = createTools({
    client,
    workers: getWorkers(),
    onWorkerComplete: () => undefined,
  });
  const sessionOptions = {
    model: agent.model ?? config.copilotModel,
    configDir: SESSIONS_DIR,
    streaming: true,
    systemMessage: { content: buildAgentSystemPrompt(agent) },
    tools,
    mcpServers: loadMcpConfig(),
    skillDirectories: getSkillDirectories(),
    onPermissionRequest: approveAll,
    infiniteSessions: {
      enabled: true,
      backgroundCompactionThreshold: 0.80,
      bufferExhaustionThreshold: 0.95,
    },
    ...(agent.workingDir ? { workingDirectory: agent.workingDir } : {}),
  };

  if (agent.copilotSessionId) {
    try {
      return await client.resumeSession(agent.copilotSessionId, sessionOptions);
    } catch {
      updateAgentRuntime({ agentId: agent.id, copilotSessionId: null });
    }
  }

  const session = await client.createSession(sessionOptions);
  updateAgentRuntime({ agentId: agent.id, copilotSessionId: session.sessionId, touchHeartbeat: true });

  const recoveryPrompt = buildAgentRecoveryPrompt(listAgentMessages(agent.id, 50));
  if (recoveryPrompt) {
    try {
      await session.sendAndWait({ prompt: recoveryPrompt }, 60_000);
    } catch {
      // Best-effort continuity recovery; the real operator turn still follows.
    }
  }

  return session;
}

async function ensureAgentWorker(agentId: number): Promise<{ agent: AgentRuntimeRecord; worker: WorkerInfo }> {
  const agent = getAgentRuntime(agentId);
  const existingWorker = getWorker(agent);
  if (existingWorker) {
    return { agent, worker: existingWorker };
  }

  const session = await resumeOrCreateAgentSession(agent);
  return { agent: getAgentRuntime(agentId), worker: createWorker(agent, session) };
}

async function runAgentExclusive<T>(agentId: number, task: () => Promise<T>): Promise<T> {
  const previous = workerQueues.get(agentId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => undefined).then(() => current);
  workerQueues.set(agentId, chained);

  await previous.catch(() => undefined);
  try {
    return await task();
  } finally {
    release();
    if (workerQueues.get(agentId) === chained) {
      workerQueues.delete(agentId);
    }
  }
}

export function getAgentChatState(agentId: number, limit = 100): {
  agent: AgentRuntimeRecord;
  history: AgentChatMessage[];
} {
  return {
    agent: getAgentRuntime(agentId),
    history: listAgentMessages(agentId, limit),
  };
}

async function runAgentPrompt(agentId: number, input: {
  prompt: string;
  inputRole: "user" | "system";
  inputContent: string;
  runningMessage: string;
  successMessage: string;
}): Promise<{
  agent: AgentRuntimeRecord;
  reply: AgentChatMessage;
  history: AgentChatMessage[];
  output: string;
}> {
  return runAgentExclusive(agentId, async () => {
    const { agent, worker } = await ensureAgentWorker(agentId);
    createAgentMessage({ agentId, role: input.inputRole, content: input.inputContent });

    worker.status = "running";
    worker.startedAt = Date.now();
    recordHeartbeat({
      projectId: agent.projectId,
      agentId: agent.id,
      sourceName: agent.name,
      status: "running",
      message: input.runningMessage,
    });

    try {
      const result = await worker.session.sendAndWait({ prompt: input.prompt }, AGENT_TIMEOUT_MS);
      const output = result?.data?.content?.trim() || "(No response)";

      worker.status = "idle";
      worker.lastOutput = output;
      delete worker.startedAt;

      const reply = createAgentMessage({ agentId, role: "assistant", content: output });
      recordHeartbeat({
        projectId: agent.projectId,
        agentId: agent.id,
        sourceName: agent.name,
        status: "healthy",
        message: input.successMessage,
      });

      return {
        agent: getAgentRuntime(agentId),
        reply,
        history: listAgentMessages(agentId, 100),
        output,
      };
    } catch (err) {
      const messageText = err instanceof Error ? err.message : String(err);
      worker.status = "error";
      worker.lastOutput = messageText;
      delete worker.startedAt;

      recordHeartbeat({
        projectId: agent.projectId,
        agentId: agent.id,
        sourceName: agent.name,
        status: "error",
        message: messageText,
      });
      throw err;
    }
  });
}

export async function sendAgentChatMessage(agentId: number, message: string): Promise<{
  agent: AgentRuntimeRecord;
  reply: AgentChatMessage;
  history: AgentChatMessage[];
}> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new Error("Message is required");
  }

  const result = await runAgentPrompt(agentId, {
    prompt: trimmed,
    inputRole: "user",
    inputContent: trimmed,
    runningMessage: "Processing dashboard chat request",
    successMessage: "Completed dashboard chat turn",
  });

  return {
    agent: result.agent,
    reply: result.reply,
    history: result.history,
  };
}

export async function runAgentHeartbeatAutomation(agentId: number): Promise<{
  agent: AgentRuntimeRecord;
  reply: AgentChatMessage;
  history: AgentChatMessage[];
}> {
  const agent = getAgentRuntime(agentId);
  const prompt = buildHeartbeatExecutionPrompt(agent);

  const result = await runAgentPrompt(agentId, {
    prompt,
    inputRole: "system",
    inputContent: prompt,
    runningMessage: `Running heartbeat-triggered task for "${agent.name}"`,
    successMessage: `Completed heartbeat-triggered task for "${agent.name}"`,
  });

  return {
    agent: result.agent,
    reply: result.reply,
    history: result.history,
  };
}

export async function runTaskNow(taskId: number): Promise<TaskRecord> {
  const task = getTask(taskId);
  if (task.agentId == null) {
    throw new Error("Assign an agent to this task before using run-now.");
  }
  if (!task.prompt?.trim()) {
    throw new Error("Add a prompt to this task before using run-now.");
  }

  const workerName = getAgentWorkerName(task.agentId);
  updateTaskRuntime({
    id: task.id,
    status: "running",
    workerName,
    result: null,
    startedAt: "now",
    completedAt: null,
  });

  recordHeartbeat({
    projectId: task.projectId,
    agentId: task.agentId,
    taskId: task.id,
    sourceName: task.title,
    status: "running",
    message: "Task run-now started",
  });

  try {
    const execution = await runAgentPrompt(task.agentId, {
      prompt: buildTaskExecutionPrompt(task),
      inputRole: "system",
      inputContent: buildTaskExecutionPrompt(task),
      runningMessage: `Running task "${task.title}"`,
      successMessage: `Completed task "${task.title}"`,
    });

    updateTaskRuntime({
      id: task.id,
      status: "completed",
      workerName,
      result: execution.output,
      completedAt: "now",
    });
    recordHeartbeat({
      projectId: task.projectId,
      agentId: task.agentId,
      taskId: task.id,
      sourceName: task.title,
      status: "completed",
      message: "Task run-now completed",
    });
    return getTask(task.id);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    updateTaskRuntime({
      id: task.id,
      status: "error",
      workerName,
      result: message,
      completedAt: "now",
    });
    recordHeartbeat({
      projectId: task.projectId,
      agentId: task.agentId,
      taskId: task.id,
      sourceName: task.title,
      status: "error",
      message,
    });
    throw err;
  }
}

export async function runScheduleNow(
  scheduleId: number,
  trigger: "manual" | "scheduler" = "manual",
): Promise<{ schedule: ScheduleRecord; output: string; }> {
  const schedule = getSchedule(scheduleId);
  if (schedule.agentId == null) {
    throw new Error("Bind an agent to this schedule before using run-now.");
  }
  if (!schedule.taskPrompt?.trim()) {
    throw new Error("Add a task prompt to this schedule before using run-now.");
  }

  recordHeartbeat({
    projectId: schedule.projectId,
    agentId: schedule.agentId,
    sourceName: schedule.name,
    status: "running",
    message: trigger === "scheduler"
      ? "Scheduled execution started"
      : "Schedule run-now started",
  });

  try {
    const execution = await runAgentPrompt(schedule.agentId, {
      prompt: buildScheduleExecutionPrompt(schedule),
      inputRole: "system",
      inputContent: buildScheduleExecutionPrompt(schedule),
      runningMessage: trigger === "scheduler"
        ? `Running scheduled job "${schedule.name}"`
        : `Running schedule "${schedule.name}"`,
      successMessage: trigger === "scheduler"
        ? `Completed scheduled job "${schedule.name}"`
        : `Completed schedule "${schedule.name}"`,
    });
    const nextRun = computeNextScheduleRun(schedule.scheduleType, schedule.expression, new Date());
    const updatedSchedule = updateScheduleRuntime({
      id: schedule.id,
      lastRunAt: "now",
      nextRunAt: nextRun ? formatControlPlaneTimestamp(nextRun) : null,
    });
    recordHeartbeat({
      projectId: schedule.projectId,
      agentId: schedule.agentId,
      sourceName: schedule.name,
      status: "completed",
      message: trigger === "scheduler"
        ? "Scheduled execution completed"
        : "Schedule run-now completed",
    });
    return { schedule: updatedSchedule, output: execution.output };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    recordHeartbeat({
      projectId: schedule.projectId,
      agentId: schedule.agentId,
      sourceName: schedule.name,
      status: "error",
      message,
    });
    throw err;
  }
}

export function forgetAgentRuntime(agentId: number): void {
  const workerName = getAgentWorkerName(agentId);
  const worker = getWorkers().get(workerName);
  if (worker) {
    void worker.session.destroy().catch(() => undefined);
    getWorkers().delete(workerName);
  }
  workerQueues.delete(agentId);
}

export function getAgentPublicRecord(agentId: number) {
  return getAgent(agentId);
}
