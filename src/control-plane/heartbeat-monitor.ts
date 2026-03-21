import { getWorkers } from "../copilot/orchestrator.js";
import type { WorkerInfo } from "../copilot/tools.js";
import { listAgents, recordHeartbeat, type AgentRecord } from "./store.js";
import { parseControlPlaneTimestamp } from "./schedule-expression.js";
import { runAgentHeartbeatAutomation } from "./runtime.js";

const HEARTBEAT_MONITOR_POLL_INTERVAL_MS = 5_000;

let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let heartbeatTickInFlight = false;
const automationInFlight = new Set<number>();

function getControlPlaneWorker(agentId: number): WorkerInfo | undefined {
  return getWorkers().get(`control-agent-${agentId}`);
}

export function buildAutomaticHeartbeat(
  agent: AgentRecord,
  worker: WorkerInfo | undefined,
  now = new Date(),
): { status: string; message: string } | null {
  const intervalSeconds = agent.heartbeatIntervalSeconds;
  if (!intervalSeconds || intervalSeconds <= 0 || !worker) {
    return null;
  }

  if (agent.lastHeartbeatAt) {
    try {
      const lastHeartbeat = parseControlPlaneTimestamp(agent.lastHeartbeatAt);
      if (now.getTime() - lastHeartbeat.getTime() < intervalSeconds * 1_000) {
        return null;
      }
    } catch {
      // Fall through and emit a fresh heartbeat.
    }
  }

  if (worker.status === "running") {
    return {
      status: "running",
      message: "Automatic running heartbeat",
    };
  }

  if (worker.status === "error") {
    return {
      status: "error",
      message: "Automatic error heartbeat",
    };
  }

  return {
    status: "healthy",
    message: "Automatic idle heartbeat",
  };
}

function isHeartbeatDue(agent: AgentRecord, now: Date): boolean {
  const intervalSeconds = agent.heartbeatIntervalSeconds;
  if (!intervalSeconds || intervalSeconds <= 0) {
    return false;
  }

  if (!agent.lastHeartbeatAt) {
    return true;
  }

  try {
    const lastHeartbeat = parseControlPlaneTimestamp(agent.lastHeartbeatAt);
    return now.getTime() - lastHeartbeat.getTime() >= intervalSeconds * 1_000;
  } catch {
    return true;
  }
}

function isHeartbeatAutomationPaused(agent: AgentRecord): boolean {
  return !agent.automationEnabled;
}

async function executeHeartbeatAutomation(agent: AgentRecord): Promise<void> {
  automationInFlight.add(agent.id);
  try {
    await runAgentHeartbeatAutomation(agent.id);
  } catch (err) {
    console.error(`[max] Heartbeat-triggered execution failed for "${agent.name}":`, err);
  } finally {
    automationInFlight.delete(agent.id);
  }
}

async function tickHeartbeatMonitor(): Promise<void> {
  if (heartbeatTickInFlight) return;
  heartbeatTickInFlight = true;

  try {
    const now = new Date();
    for (const agent of listAgents()) {
      if (isHeartbeatAutomationPaused(agent) || !isHeartbeatDue(agent, now)) {
        continue;
      }

      const worker = getControlPlaneWorker(agent.id);
      const shouldExecutePrompt = Boolean(agent.heartbeatPrompt?.trim())
        && worker?.status !== "running"
        && !automationInFlight.has(agent.id);

      if (shouldExecutePrompt) {
        void executeHeartbeatAutomation(agent);
        continue;
      }

      const heartbeat = buildAutomaticHeartbeat(agent, worker, now);
      if (!heartbeat) continue;

      recordHeartbeat({
        projectId: agent.projectId,
        agentId: agent.id,
        sourceName: agent.name,
        status: heartbeat.status,
        message: heartbeat.message,
      });
    }
  } catch (err) {
    console.error("[max] Control-plane heartbeat monitor failed:", err);
  } finally {
    heartbeatTickInFlight = false;
  }
}

export function startControlPlaneHeartbeatMonitor(): void {
  if (heartbeatTimer) return;

  console.log(`[max] Control-plane heartbeat monitor polling every ${Math.round(HEARTBEAT_MONITOR_POLL_INTERVAL_MS / 1000)}s`);
  void tickHeartbeatMonitor();
  heartbeatTimer = setInterval(() => {
    void tickHeartbeatMonitor();
  }, HEARTBEAT_MONITOR_POLL_INTERVAL_MS);
}

export function stopControlPlaneHeartbeatMonitor(): void {
  if (!heartbeatTimer) return;
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
}
