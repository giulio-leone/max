import { approveAll, type CopilotClient, type CopilotSession } from "@github/copilot-sdk";
import { readdirSync, readFileSync } from "fs";
import { basename, join } from "path";
import { homedir } from "os";
import { config } from "../config.js";
import { SESSIONS_DIR } from "../paths.js";
import {
  createNativeSessionMessage,
  deleteWorkerSession,
  getSessionMemorySummary,
  listPersistedWorkerSessions,
  listNativeSessionMessages,
  type NativeSessionChatMessage,
  type WorkerActivationMode,
  type WorkerSessionSource,
  updateWorkerSessionMetadata,
  updateWorkerSessionStatus,
  upsertWorkerSession,
} from "../store/db.js";

export interface WorkerInfo {
  name: string;
  session: CopilotSession;
  workingDir: string;
  status: "idle" | "running" | "error";
  lastOutput?: string;
  startedAt?: number;
  originChannel?: "telegram" | "tui";
  isHarnessWorker?: boolean;
  sessionSource?: WorkerSessionSource;
  copilotSessionId?: string;
  workspaceLabel?: string | null;
  activationMode?: WorkerActivationMode;
  routingHint?: string | null;
  queueHint?: string | null;
}

export interface MachineSessionRecord {
  id: string;
  workingDir: string;
  summary: string;
  updatedAt: string;
}

export interface ManagedSessionRoutingQuery {
  workspaceLabel?: string;
  routingHint?: string;
  queueHint?: string;
}

class ManagedSessionChatError extends Error {
  readonly statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = "ManagedSessionChatError";
    this.statusCode = statusCode;
  }
}

export function discoverMachineSessions(options?: {
  cwdFilter?: string;
  limit?: number;
}): {
  ok: boolean;
  message: string;
  sessions: MachineSessionRecord[];
} {
  const limit = options?.limit ?? 20;
  const cwdFilter = options?.cwdFilter;
  const sessionStateDir = join(homedir(), ".copilot", "session-state");

  let sessions: MachineSessionRecord[] = [];

  try {
    const dirs = readdirSync(sessionStateDir);
    for (const dir of dirs) {
      const yamlPath = join(sessionStateDir, dir, "workspace.yaml");
      try {
        const content = readFileSync(yamlPath, "utf-8");
        const parsed = parseSimpleYaml(content);
        if (cwdFilter && !parsed.cwd?.includes(cwdFilter)) continue;
        const updatedAt = parsed.updated_at ? new Date(parsed.updated_at) : new Date(0);
        sessions.push({
          id: parsed.id || dir,
          workingDir: parsed.cwd || "unknown",
          summary: parsed.summary || "",
          updatedAt: updatedAt.toISOString(),
        });
      } catch {
        // Skip directories without a valid workspace.yaml.
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code === "ENOENT") {
      return {
        ok: true,
        message: "No Copilot sessions found on this machine.",
        sessions: [],
      };
    }
    return {
      ok: false,
      message: "Could not read the Copilot session-state directory.",
      sessions: [],
    };
  }

  sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const limitedSessions = sessions.slice(0, limit);
  return {
    ok: true,
    message: limitedSessions.length > 0
      ? `Found ${limitedSessions.length} Copilot session(s).`
      : "No Copilot sessions found on this machine.",
    sessions: limitedSessions,
  };
}

export function findMachineSessionById(sessionId: string): MachineSessionRecord | undefined {
  const result = discoverMachineSessions({ limit: 500 });
  return result.sessions.find((session) => session.id === sessionId);
}

export function formatMachineSessionAge(updatedAt: string): string {
  return formatAge(new Date(updatedAt));
}

export async function attachManagedSession(input: {
  client: CopilotClient;
  workers: Map<string, WorkerInfo>;
  sessionId: string;
  name: string;
  workingDir: string;
  originChannel?: "telegram" | "tui";
  sessionSource?: WorkerSessionSource;
  lastOutput?: string | null;
  workspaceLabel?: string | null;
  activationMode?: WorkerActivationMode;
  routingHint?: string | null;
  queueHint?: string | null;
}): Promise<WorkerInfo> {
  if (input.workers.has(input.name)) {
    throw new Error(`A worker named '${input.name}' already exists. Choose a different name.`);
  }

  const sessionSource = input.sessionSource ?? "machine";
  const session = await resumeSessionBySource(input.client, input.sessionId, sessionSource);
  const worker: WorkerInfo = {
    name: input.name,
    session,
    workingDir: input.workingDir,
    status: "idle",
    lastOutput: input.lastOutput ?? undefined,
    originChannel: input.originChannel,
    sessionSource,
    copilotSessionId: input.sessionId,
    workspaceLabel: input.workspaceLabel ?? deriveWorkspaceLabel(input.workingDir),
    activationMode: input.activationMode ?? "manual",
    routingHint: input.routingHint ?? null,
    queueHint: input.queueHint ?? null,
  };

  input.workers.set(input.name, worker);
  upsertWorkerSession({
    name: input.name,
    copilotSessionId: input.sessionId,
    workingDir: input.workingDir,
    status: "idle",
    lastOutput: input.lastOutput ?? null,
    sessionSource,
    workspaceLabel: worker.workspaceLabel,
    activationMode: worker.activationMode,
    routingHint: worker.routingHint,
    queueHint: worker.queueHint,
  });
  return worker;
}

export async function recoverPersistedWorkerSessions(input: {
  client: CopilotClient;
  workers: Map<string, WorkerInfo>;
}): Promise<{
  recovered: number;
  cleared: number;
  failures: Array<{ name: string; error: string }>;
}> {
  const failures: Array<{ name: string; error: string }> = [];
  let recovered = 0;
  let cleared = 0;

  for (const record of listPersistedWorkerSessions()) {
    if (!record.copilotSessionId || input.workers.has(record.name)) continue;
    try {
      const session = await resumeSessionBySource(input.client, record.copilotSessionId, record.sessionSource);
      input.workers.set(record.name, {
        name: record.name,
        session,
        workingDir: record.workingDir,
        status: "idle",
        lastOutput: record.lastOutput ?? undefined,
        sessionSource: record.sessionSource,
        copilotSessionId: record.copilotSessionId,
        workspaceLabel: record.workspaceLabel,
        activationMode: record.activationMode,
        routingHint: record.routingHint,
        queueHint: record.queueHint,
      });
      updateWorkerSessionStatus(record.name, "idle", record.lastOutput ?? null);
      recovered += 1;
    } catch (err) {
      deleteWorkerSession(record.name);
      cleared += 1;
      failures.push({
        name: record.name,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { recovered, cleared, failures };
}

export function listManagedMachineWorkers(workers: Map<string, WorkerInfo>): WorkerInfo[] {
  return Array.from(workers.values())
    .filter((worker) => worker.sessionSource === "machine")
    .sort((left, right) => getActivationPriority(right.activationMode) - getActivationPriority(left.activationMode));
}

export function listDestroyableWorkers(workers: Map<string, WorkerInfo>): WorkerInfo[] {
  return Array.from(workers.values()).filter((worker) => worker.sessionSource !== "machine");
}

export function listPersistentMachineWorkers(workers: Map<string, WorkerInfo>): WorkerInfo[] {
  return Array.from(workers.values()).filter((worker) => worker.sessionSource === "machine");
}

export function findManagedMachineWorker(name: string, workers: Map<string, WorkerInfo>): WorkerInfo | undefined {
  const worker = workers.get(name);
  return worker?.sessionSource === "machine" ? worker : undefined;
}

export function detachManagedSession(name: string, workers: Map<string, WorkerInfo>): WorkerInfo | undefined {
  const worker = workers.get(name);
  if (!worker || worker.sessionSource !== "machine") {
    return undefined;
  }

  workers.delete(name);
  deleteWorkerSession(name);
  return worker;
}

export function updateManagedSessionMetadata(
  name: string,
  workers: Map<string, WorkerInfo>,
  metadata: {
    workspaceLabel?: string | null;
    activationMode?: WorkerActivationMode;
    routingHint?: string | null;
    queueHint?: string | null;
  }
): WorkerInfo | undefined {
  const worker = workers.get(name);
  if (!worker || worker.sessionSource !== "machine") {
    return undefined;
  }

  if (metadata.workspaceLabel !== undefined) {
    worker.workspaceLabel = metadata.workspaceLabel;
  }
  if (metadata.activationMode !== undefined) {
    worker.activationMode = metadata.activationMode;
  }
  if (metadata.routingHint !== undefined) {
    worker.routingHint = metadata.routingHint;
  }
  if (metadata.queueHint !== undefined) {
    worker.queueHint = metadata.queueHint;
  }

  updateWorkerSessionMetadata(name, metadata);
  return worker;
}

export function routeManagedSessions(
  workers: Map<string, WorkerInfo>,
  query: ManagedSessionRoutingQuery
): WorkerInfo[] {
  const normalizedWorkspace = normalizeText(query.workspaceLabel);
  const normalizedRouting = normalizeText(query.routingHint);
  const normalizedQueue = normalizeText(query.queueHint);
  const hasQuery = Boolean(normalizedWorkspace || normalizedRouting || normalizedQueue);

  return listManagedMachineWorkers(workers)
    .map((worker) => ({
      worker,
      priority: getActivationPriority(worker.activationMode),
      matchScore: scoreWorkerMatches(worker, {
        workspaceLabel: normalizedWorkspace,
        routingHint: normalizedRouting,
        queueHint: normalizedQueue,
      }),
    }))
    .filter((entry) => !hasQuery || entry.matchScore > 0)
    .sort((left, right) => (
      right.matchScore - left.matchScore ||
      right.priority - left.priority ||
      left.worker.name.localeCompare(right.worker.name)
    ))
    .map((entry) => entry.worker);
}

export function getManagedSessionChatState(
  name: string,
  workers: Map<string, WorkerInfo>,
  limit = 100
): { session: WorkerInfo; history: NativeSessionChatMessage[] } {
  const worker = findManagedMachineWorker(name, workers);
  if (!worker) {
    throw new ManagedSessionChatError(`No attached native session named '${name}'.`, 404);
  }

  return {
    session: worker,
    history: listNativeSessionMessages(name, limit),
  };
}

export async function sendManagedSessionChatMessage(
  name: string,
  message: string,
  workers: Map<string, WorkerInfo>
): Promise<{
  session: WorkerInfo;
  reply: NativeSessionChatMessage;
  history: NativeSessionChatMessage[];
}> {
  const trimmed = message.trim();
  if (!trimmed) {
    throw new ManagedSessionChatError("Message is required", 400);
  }

  const worker = findManagedMachineWorker(name, workers);
  if (!worker) {
    throw new ManagedSessionChatError(`No attached native session named '${name}'.`, 404);
  }
  if (worker.status === "running") {
    throw new ManagedSessionChatError(`Native session '${name}' is currently busy.`, 409);
  }

  createNativeSessionMessage({
    sessionName: name,
    role: "user",
    content: trimmed,
  });

  worker.status = "running";
  worker.startedAt = Date.now();
  updateWorkerSessionStatus(name, "running");

  try {
    const sessionMemorySummary = getSessionMemorySummary(name);
    const prompt = sessionMemorySummary
      ? [
        "Use the following session-scoped memory when it is relevant to the operator request.",
        sessionMemorySummary,
        `Operator message:\n${trimmed}`,
      ].join("\n\n")
      : trimmed;

    const result = await worker.session.sendAndWait({ prompt }, config.workerTimeoutMs);
    const output = result?.data?.content?.trim() || "(No response)";
    const reply = createNativeSessionMessage({
      sessionName: name,
      role: "assistant",
      content: output,
    });

    worker.status = "idle";
    worker.lastOutput = output;
    delete worker.startedAt;
    updateWorkerSessionStatus(name, "idle", output);

    return {
      session: worker,
      reply,
      history: listNativeSessionMessages(name, 100),
    };
  } catch (err) {
    const errorMessage = formatManagedSessionError(name, worker.startedAt ?? Date.now(), config.workerTimeoutMs, err);
    createNativeSessionMessage({
      sessionName: name,
      role: "system",
      content: errorMessage,
    });
    worker.status = "error";
    worker.lastOutput = errorMessage;
    delete worker.startedAt;
    updateWorkerSessionStatus(name, "error", errorMessage);
    throw new ManagedSessionChatError(errorMessage, 400);
  }
}

async function resumeSessionBySource(
  client: CopilotClient,
  sessionId: string,
  sessionSource: WorkerSessionSource
): Promise<CopilotSession> {
  if (sessionSource === "max") {
    return client.resumeSession(sessionId, {
      model: config.copilotModel,
      configDir: SESSIONS_DIR,
      onPermissionRequest: approveAll,
    });
  }

  return client.resumeSession(sessionId, {
    model: config.copilotModel,
    onPermissionRequest: approveAll,
  });
}

function formatAge(date: Date): string {
  const seconds = Math.max(1, Math.round((Date.now() - date.getTime()) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

function deriveWorkspaceLabel(workingDir: string): string | null {
  const cleaned = workingDir.trim();
  if (!cleaned || cleaned === "(attached)") return null;
  const leaf = basename(cleaned);
  return leaf.length > 0 ? leaf : null;
}

function normalizeText(value: string | undefined | null): string {
  return value?.trim().toLowerCase() ?? "";
}

function getActivationPriority(mode: WorkerActivationMode | undefined): number {
  if (mode === "pinned") return 3;
  if (mode === "suggested") return 2;
  return 1;
}

function isTimeoutError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /timeout|timed?\s*out/i.test(msg);
}

function formatManagedSessionError(name: string, startedAt: number, timeoutMs: number, err: unknown): string {
  const elapsed = Math.round((Date.now() - startedAt) / 1000);
  const limit = Math.round(timeoutMs / 1000);
  const msg = err instanceof Error ? err.message : String(err);

  if (isTimeoutError(err)) {
    return `Native session '${name}' timed out after ${elapsed}s (limit: ${limit}s).`;
  }

  return `Native session '${name}' failed after ${elapsed}s: ${msg}`;
}

function scoreWorkerMatches(
  worker: WorkerInfo,
  query: Required<ManagedSessionRoutingQuery>
): number {
  let score = 0;
  const workspaceLabel = normalizeText(worker.workspaceLabel);
  const workingDir = normalizeText(worker.workingDir);
  const routingHint = normalizeText(worker.routingHint);
  const queueHint = normalizeText(worker.queueHint);

  if (query.workspaceLabel) {
    if (workspaceLabel && workspaceLabel.includes(query.workspaceLabel)) {
      score += 40;
    } else if (workingDir.includes(query.workspaceLabel)) {
      score += 20;
    }
  }

  if (query.routingHint) {
    if (routingHint && routingHint.includes(query.routingHint)) {
      score += 30;
    }
  }

  if (query.queueHint) {
    if (queueHint && queueHint.includes(query.queueHint)) {
      score += 20;
    }
  }

  return score;
}

function parseSimpleYaml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, "");
    result[key] = value;
  }
  return result;
}
