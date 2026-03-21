const API_BASE = "/api/max";

let cachedToken: string | null = null;

async function ensureToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  if (cachedToken) return cachedToken;
  const stored = localStorage.getItem("max-api-token");
  if (stored) { cachedToken = stored; return stored; }
  try {
    const res = await fetch("/api/token");
    const data = await res.json();
    if (data.token) {
      localStorage.setItem("max-api-token", data.token);
      cachedToken = data.token;
      return data.token;
    }
  } catch { /* ignore */ }
  return null;
}

export function setStoredApiToken(token: string) {
  cachedToken = token;
  if (typeof window !== "undefined") {
    localStorage.setItem("max-api-token", token);
  }
}

async function getAuthHeaders(): Promise<HeadersInit> {
  const token = await ensureToken();
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

async function getApiErrorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string; errors?: string[] };
    const details = [data.error, ...(Array.isArray(data.errors) ? data.errors : [])].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    );
    if (details.length > 0) return details.join(" ");
  } catch {
    // Ignore body parsing issues and fall back to the status-based message.
  }
  return `API error: ${res.status}`;
}

export interface Feature {
  id: string;
  description: string;
  passes: boolean;
  testCommand?: string;
}

export interface HarnessStatus {
  phase: "init" | "coding" | "complete";
  total: number;
  passing: number;
  failing: number;
  percentComplete: number;
  nextFeature: Feature | null;
  projectGoal: string;
  progressLog: string;
  features: Feature[];
}

export interface Worker {
  name: string;
  workingDir: string;
  status: string;
  lastOutput?: string;
  isHarnessWorker?: boolean;
}

export interface MaxStatus {
  status: string;
  workers: Worker[];
}

export interface ControlOverview {
  projects: number;
  tasks: number;
  pendingTasks: number;
  runningTasks: number;
  completedTasks: number;
  agents: number;
  activeAgents: number;
  schedules: number;
  enabledSchedules: number;
  latestHeartbeatAt: string | null;
}

export interface ProjectRecord {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  workspacePath: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskRecord {
  id: number;
  projectId: number;
  projectName: string;
  agentId: number | null;
  agentName: string | null;
  slug: string;
  title: string;
  description: string | null;
  prompt: string | null;
  status: string;
  workerName: string | null;
  result: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface AgentRecord {
  id: number;
  projectId: number;
  projectName: string;
  slug: string;
  name: string;
  agentType: string;
  workingDir: string | null;
  model: string | null;
  defaultPrompt: string | null;
  heartbeatPrompt: string | null;
  heartbeatIntervalSeconds: number | null;
  automationEnabled: boolean;
  status: string;
  lastHeartbeatAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduleRecord {
  id: number;
  projectId: number;
  projectName: string;
  agentId: number | null;
  agentName: string | null;
  slug: string;
  name: string;
  scheduleType: string;
  expression: string;
  taskPrompt: string | null;
  enabled: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface HeartbeatRecord {
  id: number;
  projectId: number | null;
  agentId: number | null;
  taskId: number | null;
  sourceName: string;
  status: string;
  message: string | null;
  recordedAt: string;
}

export interface AvailableModel {
  id: string;
  label: string;
  description: string;
}

export interface AgentChatMessage {
  id: number;
  agentId: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface AgentChatState {
  agent: AgentRecord;
  history: AgentChatMessage[];
}

export type SkillSource = "bundled" | "local" | "global";

export interface SkillSummary {
  slug: string;
  name: string;
  description: string;
  directory: string;
  source: SkillSource;
}

export interface SkillDetail extends SkillSummary {
  content: string;
  instructions: string;
  frontmatter: Record<string, string>;
}

export interface SkillMutationResponse {
  ok: boolean;
  message: string;
  skill: SkillDetail;
}

export interface McpServerConfigRecord {
  displayName?: string;
  tools?: string[];
  type?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout?: number;
  source?: string;
  sourcePath?: string;
  oauthClientId?: string;
  oauthPublicClient?: boolean;
  [key: string]: unknown;
}

export interface McpServerEntry {
  name: string;
  config: McpServerConfigRecord;
}

export interface McpServerListResponse {
  configPath: string;
  servers: McpServerEntry[];
}

export interface McpServerMutationResponse {
  ok: boolean;
  message: string;
  configPath: string;
  serverName: string;
  server?: McpServerConfigRecord;
}

export async function fetchHarnessStatus(dir: string): Promise<HarnessStatus> {
  const res = await fetch(`${API_BASE}/harness?dir=${encodeURIComponent(dir)}`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchMaxStatus(): Promise<MaxStatus> {
  const res = await fetch(`${API_BASE}/status`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchWorkers(): Promise<Worker[]> {
  const res = await fetch(`${API_BASE}/sessions`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchRecentHarnessDirs(): Promise<string[]> {
  const res = await fetch(`${API_BASE}/harness/recent`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  const data = await res.json() as { dirs?: string[] };
  return data.dirs ?? [];
}

export async function fetchControlOverview(): Promise<ControlOverview> {
  const res = await fetch(`${API_BASE}/control/overview`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchAvailableModels(): Promise<AvailableModel[]> {
  const res = await fetch(`${API_BASE}/models`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchCurrentModel(): Promise<{ model: string }> {
  const res = await fetch(`${API_BASE}/model`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchSkills(): Promise<SkillSummary[]> {
  const res = await fetch(`${API_BASE}/skills`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json();
}

export async function fetchSkill(slug: string): Promise<SkillDetail> {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(slug)}`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json();
}

export async function createSkill(payload: {
  slug: string;
  name: string;
  description: string;
  instructions: string;
}) {
  const res = await fetch(`${API_BASE}/skills`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json() as Promise<SkillMutationResponse>;
}

export async function updateSkill(slug: string, payload: {
  name?: string;
  description?: string;
  instructions?: string;
}) {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(slug)}`, {
    method: "PUT",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json() as Promise<SkillMutationResponse>;
}

export async function deleteSkill(slug: string) {
  const res = await fetch(`${API_BASE}/skills/${encodeURIComponent(slug)}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json() as Promise<{ ok: boolean; message: string }>;
}

export async function fetchMcpServers(): Promise<McpServerListResponse> {
  const res = await fetch(`${API_BASE}/mcp`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json();
}

export async function createMcpServer(payload: {
  name: string;
  config: McpServerConfigRecord;
}) {
  const res = await fetch(`${API_BASE}/mcp`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json() as Promise<McpServerMutationResponse>;
}

export async function updateMcpServer(name: string, payload: {
  config: McpServerConfigRecord;
}) {
  const res = await fetch(`${API_BASE}/mcp/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json() as Promise<McpServerMutationResponse>;
}

export async function deleteMcpServer(name: string) {
  const res = await fetch(`${API_BASE}/mcp/${encodeURIComponent(name)}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(await getApiErrorMessage(res));
  return res.json() as Promise<Omit<McpServerMutationResponse, "server">>;
}

export async function fetchProjects(): Promise<ProjectRecord[]> {
  const res = await fetch(`${API_BASE}/control/projects`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createProject(payload: {
  name: string;
  description?: string;
  workspacePath?: string;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/control/projects`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ProjectRecord>;
}

export async function updateProject(id: number, payload: {
  name?: string;
  description?: string;
  workspacePath?: string;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/control/projects/${id}`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ProjectRecord>;
}

export async function deleteProject(id: number) {
  const res = await fetch(`${API_BASE}/control/projects/${id}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function fetchTasks(projectId?: number): Promise<TaskRecord[]> {
  const query = projectId ? `?projectId=${projectId}` : "";
  const res = await fetch(`${API_BASE}/control/tasks${query}`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createTask(payload: {
  projectId: number;
  agentId?: number | null;
  title: string;
  description?: string;
  prompt?: string;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/control/tasks`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<TaskRecord>;
}

export async function updateTask(id: number, payload: {
  projectId?: number;
  agentId?: number | null;
  title?: string;
  description?: string;
  prompt?: string;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/control/tasks/${id}`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<TaskRecord>;
}

export async function deleteTask(id: number) {
  const res = await fetch(`${API_BASE}/control/tasks/${id}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function runTaskNow(id: number) {
  const res = await fetch(`${API_BASE}/control/tasks/${id}/run`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<TaskRecord>;
}

export async function fetchAgents(projectId?: number): Promise<AgentRecord[]> {
  const query = projectId ? `?projectId=${projectId}` : "";
  const res = await fetch(`${API_BASE}/control/agents${query}`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createAgent(payload: {
  projectId: number;
  name: string;
  agentType: string;
  workingDir?: string;
  model?: string;
  defaultPrompt?: string;
  heartbeatPrompt?: string;
  heartbeatIntervalSeconds?: number | null;
  automationEnabled?: boolean;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/control/agents`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AgentRecord>;
}

export async function updateAgent(id: number, payload: {
  projectId?: number;
  name?: string;
  agentType?: string;
  workingDir?: string;
  model?: string;
  defaultPrompt?: string;
  heartbeatPrompt?: string;
  heartbeatIntervalSeconds?: number | null;
  automationEnabled?: boolean;
  status?: string;
}) {
  const res = await fetch(`${API_BASE}/control/agents/${id}`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<AgentRecord>;
}

export async function deleteAgent(id: number) {
  const res = await fetch(`${API_BASE}/control/agents/${id}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function pingAgent(agentId: number, message?: string) {
  const res = await fetch(`${API_BASE}/control/agents/${agentId}/heartbeat`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<HeartbeatRecord>;
}

export async function fetchAgentChatState(agentId: number, limit = 100): Promise<AgentChatState> {
  const res = await fetch(`${API_BASE}/control/agents/${agentId}/chat?limit=${limit}`, {
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function sendAgentChatMessage(agentId: number, message: string) {
  const res = await fetch(`${API_BASE}/control/agents/${agentId}/chat`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ message }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{
    agent: AgentRecord;
    reply: AgentChatMessage;
    history: AgentChatMessage[];
  }>;
}

export async function fetchSchedules(projectId?: number): Promise<ScheduleRecord[]> {
  const query = projectId ? `?projectId=${projectId}` : "";
  const res = await fetch(`${API_BASE}/control/schedules${query}`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function createSchedule(payload: {
  projectId: number;
  agentId?: number | null;
  name: string;
  scheduleType?: string;
  expression: string;
  taskPrompt?: string;
  enabled?: boolean;
}) {
  const res = await fetch(`${API_BASE}/control/schedules`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ScheduleRecord>;
}

export async function updateSchedule(id: number, payload: {
  projectId?: number;
  agentId?: number | null;
  name?: string;
  scheduleType?: string;
  expression?: string;
  taskPrompt?: string;
  enabled?: boolean;
}) {
  const res = await fetch(`${API_BASE}/control/schedules/${id}`, {
    method: "PATCH",
    headers: await getAuthHeaders(),
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ScheduleRecord>;
}

export async function deleteSchedule(id: number) {
  const res = await fetch(`${API_BASE}/control/schedules/${id}`, {
    method: "DELETE",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
}

export async function toggleSchedule(id: number, enabled: boolean) {
  const res = await fetch(`${API_BASE}/control/schedules/${id}/toggle`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<ScheduleRecord>;
}

export async function runScheduleNow(id: number) {
  const res = await fetch(`${API_BASE}/control/schedules/${id}/run`, {
    method: "POST",
    headers: await getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json() as Promise<{ schedule: ScheduleRecord; output: string }>;
}

export async function fetchHeartbeats(limit = 20): Promise<HeartbeatRecord[]> {
  const res = await fetch(`${API_BASE}/control/heartbeats?limit=${limit}`, { headers: await getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function startHarness(dir: string, goal: string, connectionId: string) {
  const res = await fetch(`${API_BASE}/harness/start`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ dir, goal, connectionId }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function continueHarness(dir: string, connectionId: string) {
  const res = await fetch(`${API_BASE}/harness/continue`, {
    method: "POST",
    headers: await getAuthHeaders(),
    body: JSON.stringify({ dir, connectionId }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface SSEEvent {
  type: string;
  content?: string;
  connectionId?: string;
}

export async function connectSSE(onEvent: (event: SSEEvent) => void): Promise<{
  close: () => void;
  getConnectionId: () => string | null;
}> {
  let connectionId: string | null = null;
  const token = await ensureToken();
  const url = token ? `${API_BASE}/stream?token=${token}` : `${API_BASE}/stream`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data: SSEEvent = JSON.parse(event.data);
      if (data.connectionId) connectionId = data.connectionId;
      onEvent(data);
    } catch {
      // ignore parse errors
    }
  };

  eventSource.onerror = () => {
    onEvent({ type: "error", content: "SSE connection lost" });
  };

  return {
    close: () => eventSource.close(),
    getConnectionId: () => connectionId,
  };
}
