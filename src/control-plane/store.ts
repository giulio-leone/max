import { getDb } from "../store/db.js";
import { validateScheduleDefinition } from "./schedule-expression.js";

export interface Project {
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

export interface AgentChatMessage {
  id: number;
  agentId: number;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface AgentRuntimeRecord extends AgentRecord {
  copilotSessionId: string | null;
}

export interface ControlPlaneOverview {
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

let schemaReady = false;
const RECURRING_HEARTBEAT_PROMPT_PATTERN = /\b(?:every|seconds?|minutes?|hours?|days?|daily|weekly|monthly|cron|forever|background|nohup|launchd)\b|while\s+true|sleep\s+\d+/i;

function ensureSchema() {
  if (schemaReady) return;
  const db = getDb();

  db.exec(`
    CREATE TABLE IF NOT EXISTS control_projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      workspace_path TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS control_agents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      agent_type TEXT NOT NULL,
      working_dir TEXT,
      model TEXT,
      default_prompt TEXT,
      heartbeat_interval_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'idle',
      last_heartbeat_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, slug)
    )
  `);

  try {
    db.prepare(`SELECT copilot_session_id FROM control_agents LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE control_agents ADD COLUMN copilot_session_id TEXT`);
  }

  try {
    db.prepare(`SELECT heartbeat_prompt FROM control_agents LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE control_agents ADD COLUMN heartbeat_prompt TEXT`);
  }

  try {
    db.prepare(`SELECT automation_enabled FROM control_agents LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE control_agents ADD COLUMN automation_enabled INTEGER NOT NULL DEFAULT 1`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS control_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      agent_id INTEGER,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      prompt TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      worker_name TEXT,
      result TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      started_at DATETIME,
      completed_at DATETIME,
      UNIQUE(project_id, slug)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS control_schedules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL,
      agent_id INTEGER,
      slug TEXT NOT NULL,
      name TEXT NOT NULL,
      schedule_type TEXT NOT NULL DEFAULT 'cron',
      expression TEXT NOT NULL,
      task_prompt TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_run_at DATETIME,
      next_run_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(project_id, slug)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS control_heartbeats (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER,
      agent_id INTEGER,
      task_id INTEGER,
      source_name TEXT NOT NULL,
      status TEXT NOT NULL,
      message TEXT,
      recorded_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS control_agent_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id INTEGER NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  schemaReady = true;
}

function normalizeText(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function validateHeartbeatPromptInput(prompt: string | null): void {
  if (!prompt) return;
  if (RECURRING_HEARTBEAT_PROMPT_PATTERN.test(prompt)) {
    throw new Error(
      "Heartbeat tick prompt must describe one immediate action only. Keep the cadence in 'heartbeat interval seconds' and remove recurring terms like 'every 30 seconds'."
    );
  }
}

function resolveAutomationEnabled(input: {
  automationEnabled?: boolean;
  fallback: boolean;
}): boolean {
  if (typeof input.automationEnabled === "boolean") {
    return input.automationEnabled;
  }
  return input.fallback;
}

function resolveAgentStatus(status: string | undefined, fallback: string): string {
  const normalizedStatus = normalizeText(status);
  if (!normalizedStatus) return fallback;
  const lower = normalizedStatus.toLowerCase();
  if (lower === "paused" || lower === "active") {
    throw new Error("Use 'automationEnabled' instead of legacy agent status values like 'paused' or 'active'.");
  }
  return normalizedStatus;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "item";
}

function asProject(row: {
  id: number;
  slug: string;
  name: string;
  description: string | null;
  workspace_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}): Project {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    workspacePath: row.workspace_path,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asTask(row: {
  id: number;
  project_id: number;
  project_name: string;
  agent_id: number | null;
  agent_name: string | null;
  slug: string;
  title: string;
  description: string | null;
  prompt: string | null;
  status: string;
  worker_name: string | null;
  result: string | null;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
}): TaskRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    slug: row.slug,
    title: row.title,
    description: row.description,
    prompt: row.prompt,
    status: row.status,
    workerName: row.worker_name,
    result: row.result,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
  };
}

function asAgent(row: {
  id: number;
  project_id: number;
  project_name: string;
  slug: string;
  name: string;
  agent_type: string;
  working_dir: string | null;
  model: string | null;
  default_prompt: string | null;
  heartbeat_prompt: string | null;
  heartbeat_interval_seconds: number | null;
  automation_enabled: number;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}): AgentRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    slug: row.slug,
    name: row.name,
    agentType: row.agent_type,
    workingDir: row.working_dir,
    model: row.model,
    defaultPrompt: row.default_prompt,
    heartbeatPrompt: row.heartbeat_prompt,
    heartbeatIntervalSeconds: row.heartbeat_interval_seconds,
    automationEnabled: row.automation_enabled === 1,
    status: row.status,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asAgentRuntime(row: {
  id: number;
  project_id: number;
  project_name: string;
  slug: string;
  name: string;
  agent_type: string;
  working_dir: string | null;
  model: string | null;
  default_prompt: string | null;
  heartbeat_prompt: string | null;
  heartbeat_interval_seconds: number | null;
  automation_enabled: number;
  status: string;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  copilot_session_id: string | null;
}): AgentRuntimeRecord {
  return {
    ...asAgent(row),
    copilotSessionId: row.copilot_session_id,
  };
}

function asSchedule(row: {
  id: number;
  project_id: number;
  project_name: string;
  agent_id: number | null;
  agent_name: string | null;
  slug: string;
  name: string;
  schedule_type: string;
  expression: string;
  task_prompt: string | null;
  enabled: number;
  last_run_at: string | null;
  next_run_at: string | null;
  created_at: string;
  updated_at: string;
}): ScheduleRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    projectName: row.project_name,
    agentId: row.agent_id,
    agentName: row.agent_name,
    slug: row.slug,
    name: row.name,
    scheduleType: row.schedule_type,
    expression: row.expression,
    taskPrompt: row.task_prompt,
    enabled: row.enabled === 1,
    lastRunAt: row.last_run_at,
    nextRunAt: row.next_run_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function asHeartbeat(row: {
  id: number;
  project_id: number | null;
  agent_id: number | null;
  task_id: number | null;
  source_name: string;
  status: string;
  message: string | null;
  recorded_at: string;
}): HeartbeatRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    agentId: row.agent_id,
    taskId: row.task_id,
    sourceName: row.source_name,
    status: row.status,
    message: row.message,
    recordedAt: row.recorded_at,
  };
}

function asAgentChatMessage(row: {
  id: number;
  agent_id: number;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}): AgentChatMessage {
  return {
    id: row.id,
    agentId: row.agent_id,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

function requireProject(projectId: number) {
  ensureSchema();
  const db = getDb();
  const row = db.prepare(`SELECT id FROM control_projects WHERE id = ?`).get(projectId) as { id: number } | undefined;
  if (!row) throw new Error(`Project ${projectId} not found`);
}

function requireAgent(agentId: number) {
  ensureSchema();
  const db = getDb();
  const row = db.prepare(`SELECT id FROM control_agents WHERE id = ?`).get(agentId) as { id: number } | undefined;
  if (!row) throw new Error(`Agent ${agentId} not found`);
}

export function getAgent(agentId: number): AgentRecord {
  ensureSchema();
  const db = getDb();
  const row = db.prepare(`
    SELECT
      a.id,
      a.project_id,
      p.name AS project_name,
      a.slug,
      a.name,
      a.agent_type,
      a.working_dir,
      a.model,
      a.default_prompt,
      a.heartbeat_prompt,
      a.heartbeat_interval_seconds,
      a.automation_enabled,
      a.status,
      a.last_heartbeat_at,
      a.created_at,
      a.updated_at
    FROM control_agents a
    INNER JOIN control_projects p ON p.id = a.project_id
    WHERE a.id = ?
  `).get(agentId) as {
    id: number;
    project_id: number;
    project_name: string;
    slug: string;
    name: string;
    agent_type: string;
      working_dir: string | null;
      model: string | null;
      default_prompt: string | null;
      heartbeat_prompt: string | null;
      heartbeat_interval_seconds: number | null;
      automation_enabled: number;
      status: string;
      last_heartbeat_at: string | null;
      created_at: string;
      updated_at: string;
  } | undefined;
  if (!row) throw new Error(`Agent ${agentId} not found`);
  return asAgent(row);
}

export function getAgentRuntime(agentId: number): AgentRuntimeRecord {
  ensureSchema();
  const db = getDb();
  const row = db.prepare(`
    SELECT
      a.id,
      a.project_id,
      p.name AS project_name,
      a.slug,
      a.name,
      a.agent_type,
      a.working_dir,
      a.model,
      a.default_prompt,
      a.heartbeat_prompt,
      a.heartbeat_interval_seconds,
      a.automation_enabled,
      a.status,
      a.last_heartbeat_at,
      a.created_at,
      a.updated_at,
      a.copilot_session_id
    FROM control_agents a
    INNER JOIN control_projects p ON p.id = a.project_id
    WHERE a.id = ?
  `).get(agentId) as {
    id: number;
    project_id: number;
    project_name: string;
    slug: string;
    name: string;
    agent_type: string;
      working_dir: string | null;
      model: string | null;
      default_prompt: string | null;
      heartbeat_prompt: string | null;
      heartbeat_interval_seconds: number | null;
      automation_enabled: number;
      status: string;
      last_heartbeat_at: string | null;
      created_at: string;
      updated_at: string;
    copilot_session_id: string | null;
  } | undefined;
  if (!row) throw new Error(`Agent ${agentId} not found`);
  return asAgentRuntime(row);
}

export function getProject(projectId: number): Project {
  const project = listProjects().find((entry) => entry.id === projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  return project;
}

export function getTask(taskId: number): TaskRecord {
  const task = listTasks().find((entry) => entry.id === taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  return task;
}

export function getSchedule(scheduleId: number): ScheduleRecord {
  const schedule = listSchedules().find((entry) => entry.id === scheduleId);
  if (!schedule) throw new Error(`Schedule ${scheduleId} not found`);
  return schedule;
}

export function getControlPlaneOverview(): ControlPlaneOverview {
  ensureSchema();
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM control_projects) AS projects,
      (SELECT COUNT(*) FROM control_tasks) AS tasks,
      (SELECT COUNT(*) FROM control_tasks WHERE status = 'pending') AS pending_tasks,
      (SELECT COUNT(*) FROM control_tasks WHERE status = 'running') AS running_tasks,
      (SELECT COUNT(*) FROM control_tasks WHERE status = 'completed') AS completed_tasks,
      (SELECT COUNT(*) FROM control_agents) AS agents,
      (SELECT COUNT(*) FROM control_agents WHERE status IN ('running', 'healthy', 'active')) AS active_agents,
      (SELECT COUNT(*) FROM control_schedules) AS schedules,
      (SELECT COUNT(*) FROM control_schedules WHERE enabled = 1) AS enabled_schedules,
      (SELECT recorded_at FROM control_heartbeats ORDER BY recorded_at DESC LIMIT 1) AS latest_heartbeat_at
  `).get() as {
    projects: number;
    tasks: number;
    pending_tasks: number;
    running_tasks: number;
    completed_tasks: number;
    agents: number;
    active_agents: number;
    schedules: number;
    enabled_schedules: number;
    latest_heartbeat_at: string | null;
  };

  return {
    projects: counts.projects,
    tasks: counts.tasks,
    pendingTasks: counts.pending_tasks,
    runningTasks: counts.running_tasks,
    completedTasks: counts.completed_tasks,
    agents: counts.agents,
    activeAgents: counts.active_agents,
    schedules: counts.schedules,
    enabledSchedules: counts.enabled_schedules,
    latestHeartbeatAt: counts.latest_heartbeat_at,
  };
}

export function listProjects(): Project[] {
  ensureSchema();
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, slug, name, description, workspace_path, status, created_at, updated_at
    FROM control_projects
    ORDER BY updated_at DESC, id DESC
  `).all() as {
    id: number;
    slug: string;
    name: string;
    description: string | null;
    workspace_path: string | null;
    status: string;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map(asProject);
}

export function createProject(input: {
  name: string;
  slug?: string;
  description?: string;
  workspacePath?: string;
  status?: string;
}): Project {
  ensureSchema();
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error("Project name is required");
  const slug = slugify(input.slug ?? input.name);
  db.prepare(`
    INSERT INTO control_projects (slug, name, description, workspace_path, status)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    slug,
    name,
    normalizeText(input.description),
    normalizeText(input.workspacePath),
    normalizeText(input.status) ?? "active"
  );
  return listProjects()[0];
}

export function updateProject(input: {
  id: number;
  name?: string;
  description?: string;
  workspacePath?: string;
  status?: string;
}): Project {
  ensureSchema();
  const existing = getProject(input.id);
  const db = getDb();
  const name = input.name !== undefined ? input.name.trim() : existing.name;
  if (!name) throw new Error("Project name is required");

  const result = db.prepare(`
    UPDATE control_projects
    SET name = ?, description = ?, workspace_path = ?, status = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    name,
    input.description !== undefined ? normalizeText(input.description) : existing.description,
    input.workspacePath !== undefined ? normalizeText(input.workspacePath) : existing.workspacePath,
    input.status !== undefined ? normalizeText(input.status) ?? "active" : existing.status,
    input.id
  );
  if (result.changes === 0) throw new Error(`Project ${input.id} not found`);
  return getProject(input.id);
}

export function deleteProject(projectId: number): void {
  ensureSchema();
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM control_tasks WHERE project_id = ?) AS task_count,
      (SELECT COUNT(*) FROM control_agents WHERE project_id = ?) AS agent_count,
      (SELECT COUNT(*) FROM control_schedules WHERE project_id = ?) AS schedule_count
  `).get(projectId, projectId, projectId) as {
    task_count: number;
    agent_count: number;
    schedule_count: number;
  };

  if (counts.task_count > 0 || counts.agent_count > 0 || counts.schedule_count > 0) {
    throw new Error(
      `Project ${projectId} cannot be deleted until dependent tasks, agents, and schedules are removed (tasks: ${counts.task_count}, agents: ${counts.agent_count}, schedules: ${counts.schedule_count}).`
    );
  }

  const result = db.prepare(`DELETE FROM control_projects WHERE id = ?`).run(projectId);
  if (result.changes === 0) throw new Error(`Project ${projectId} not found`);
}

export function listTasks(projectId?: number): TaskRecord[] {
  ensureSchema();
  const db = getDb();
  const query = `
    SELECT
      t.id,
      t.project_id,
      p.name AS project_name,
      t.agent_id,
      a.name AS agent_name,
      t.slug,
      t.title,
      t.description,
      t.prompt,
      t.status,
      t.worker_name,
      t.result,
      t.created_at,
      t.updated_at,
      t.started_at,
      t.completed_at
    FROM control_tasks t
    INNER JOIN control_projects p ON p.id = t.project_id
    LEFT JOIN control_agents a ON a.id = t.agent_id
    ${projectId ? "WHERE t.project_id = ?" : ""}
    ORDER BY t.updated_at DESC, t.id DESC
  `;
  const rows = (projectId
    ? db.prepare(query).all(projectId)
    : db.prepare(query).all()) as {
    id: number;
    project_id: number;
    project_name: string;
    agent_id: number | null;
    agent_name: string | null;
    slug: string;
    title: string;
    description: string | null;
    prompt: string | null;
    status: string;
    worker_name: string | null;
    result: string | null;
    created_at: string;
    updated_at: string;
    started_at: string | null;
    completed_at: string | null;
  }[];
  return rows.map(asTask);
}

export function createTask(input: {
  projectId: number;
  title: string;
  slug?: string;
  description?: string;
  prompt?: string;
  agentId?: number | null;
  status?: string;
}): TaskRecord {
  ensureSchema();
  requireProject(input.projectId);
  if (input.agentId != null) requireAgent(input.agentId);

  const db = getDb();
  const title = input.title.trim();
  if (!title) throw new Error("Task title is required");

  db.prepare(`
    INSERT INTO control_tasks (project_id, agent_id, slug, title, description, prompt, status)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.projectId,
    input.agentId ?? null,
    slugify(input.slug ?? input.title),
    title,
    normalizeText(input.description),
    normalizeText(input.prompt),
    normalizeText(input.status) ?? "pending"
  );

  return listTasks(input.projectId)[0];
}

export function updateTask(input: {
  id: number;
  projectId?: number;
  title?: string;
  description?: string;
  prompt?: string;
  agentId?: number | null;
  status?: string;
}): TaskRecord {
  ensureSchema();
  const existing = getTask(input.id);
  const nextProjectId = input.projectId ?? existing.projectId;
  const nextAgentId = input.agentId !== undefined ? input.agentId : existing.agentId;
  const nextTitle = input.title !== undefined ? input.title.trim() : existing.title;

  if (!nextTitle) throw new Error("Task title is required");
  requireProject(nextProjectId);
  if (nextAgentId != null) requireAgent(nextAgentId);

  const db = getDb();
  const result = db.prepare(`
    UPDATE control_tasks
    SET
      project_id = ?,
      agent_id = ?,
      title = ?,
      description = ?,
      prompt = ?,
      status = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    nextProjectId,
    nextAgentId ?? null,
    nextTitle,
    input.description !== undefined ? normalizeText(input.description) : existing.description,
    input.prompt !== undefined ? normalizeText(input.prompt) : existing.prompt,
    input.status !== undefined ? normalizeText(input.status) ?? existing.status : existing.status,
    input.id
  );
  if (result.changes === 0) throw new Error(`Task ${input.id} not found`);
  return getTask(input.id);
}

export function updateTaskRuntime(input: {
  id: number;
  status: string;
  workerName?: string | null;
  result?: string | null;
  startedAt?: "now" | null;
  completedAt?: "now" | null;
}): TaskRecord {
  ensureSchema();
  const db = getDb();
  const status = input.status.trim();
  if (!status) throw new Error("Task status is required");

  const assignments = ["status = ?", "updated_at = CURRENT_TIMESTAMP"];
  const params: Array<string | number | null> = [status];

  if (input.workerName !== undefined) {
    assignments.push("worker_name = ?");
    params.push(normalizeText(input.workerName ?? undefined));
  }
  if (input.result !== undefined) {
    assignments.push("result = ?");
    params.push(normalizeText(input.result ?? undefined));
  }
  if (input.startedAt === "now") assignments.push("started_at = CURRENT_TIMESTAMP");
  if (input.startedAt === null) assignments.push("started_at = NULL");
  if (input.completedAt === "now") assignments.push("completed_at = CURRENT_TIMESTAMP");
  if (input.completedAt === null) assignments.push("completed_at = NULL");

  params.push(input.id);
  const result = db.prepare(`
    UPDATE control_tasks
    SET ${assignments.join(", ")}
    WHERE id = ?
  `).run(...params);
  if (result.changes === 0) throw new Error(`Task ${input.id} not found`);
  return getTask(input.id);
}

export function deleteTask(taskId: number): void {
  ensureSchema();
  const db = getDb();
  const result = db.prepare(`DELETE FROM control_tasks WHERE id = ?`).run(taskId);
  if (result.changes === 0) throw new Error(`Task ${taskId} not found`);
}

export function listAgents(projectId?: number): AgentRecord[] {
  ensureSchema();
  const db = getDb();
  const query = `
    SELECT
      a.id,
      a.project_id,
      p.name AS project_name,
      a.slug,
      a.name,
      a.agent_type,
      a.working_dir,
      a.model,
      a.default_prompt,
      a.heartbeat_prompt,
      a.heartbeat_interval_seconds,
      a.automation_enabled,
      a.status,
      a.last_heartbeat_at,
      a.created_at,
      a.updated_at
    FROM control_agents a
    INNER JOIN control_projects p ON p.id = a.project_id
    ${projectId ? "WHERE a.project_id = ?" : ""}
    ORDER BY a.updated_at DESC, a.id DESC
  `;
  const rows = (projectId
    ? db.prepare(query).all(projectId)
    : db.prepare(query).all()) as {
    id: number;
    project_id: number;
    project_name: string;
    slug: string;
    name: string;
    agent_type: string;
      working_dir: string | null;
      model: string | null;
      default_prompt: string | null;
      heartbeat_prompt: string | null;
      heartbeat_interval_seconds: number | null;
      automation_enabled: number;
      status: string;
      last_heartbeat_at: string | null;
      created_at: string;
      updated_at: string;
  }[];
  return rows.map(asAgent);
}

export function createAgent(input: {
  projectId: number;
  name: string;
  slug?: string;
  agentType: string;
  workingDir?: string;
  model?: string;
  defaultPrompt?: string;
  heartbeatPrompt?: string;
  heartbeatIntervalSeconds?: number | null;
  automationEnabled?: boolean;
  status?: string;
}): AgentRecord {
  ensureSchema();
  requireProject(input.projectId);
  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error("Agent name is required");
  const defaultPrompt = normalizeText(input.defaultPrompt);
  const heartbeatPrompt = normalizeText(input.heartbeatPrompt);
  validateHeartbeatPromptInput(heartbeatPrompt);
  const automationEnabled = resolveAutomationEnabled({
    automationEnabled: input.automationEnabled,
    fallback: true,
  });
  const status = resolveAgentStatus(input.status, "idle");

  db.prepare(`
    INSERT INTO control_agents (
      project_id,
      slug,
      name,
      agent_type,
      working_dir,
      model,
      default_prompt,
      heartbeat_prompt,
      heartbeat_interval_seconds,
      automation_enabled,
      status
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.projectId,
    slugify(input.slug ?? input.name),
    name,
    normalizeText(input.agentType) ?? "custom",
    normalizeText(input.workingDir),
    normalizeText(input.model),
    defaultPrompt,
    heartbeatPrompt,
    input.heartbeatIntervalSeconds ?? null,
    automationEnabled ? 1 : 0,
    status
  );

  return listAgents(input.projectId)[0];
}

export function updateAgent(input: {
  id: number;
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
}): AgentRecord {
  ensureSchema();
  const existing = getAgentRuntime(input.id);
  const nextProjectId = input.projectId ?? existing.projectId;
  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  if (!nextName) throw new Error("Agent name is required");
  requireProject(nextProjectId);

  const nextAgentType = input.agentType !== undefined ? normalizeText(input.agentType) ?? "custom" : existing.agentType;
  const nextWorkingDir = input.workingDir !== undefined ? normalizeText(input.workingDir) : existing.workingDir;
  const nextModel = input.model !== undefined ? normalizeText(input.model) : existing.model;
  const nextDefaultPrompt = input.defaultPrompt !== undefined ? normalizeText(input.defaultPrompt) : existing.defaultPrompt;
  const nextHeartbeatPrompt = input.heartbeatPrompt !== undefined ? normalizeText(input.heartbeatPrompt) : existing.heartbeatPrompt;
  const nextHeartbeatInterval = input.heartbeatIntervalSeconds !== undefined
    ? input.heartbeatIntervalSeconds
    : existing.heartbeatIntervalSeconds;
  validateHeartbeatPromptInput(nextHeartbeatPrompt);
  const nextAutomationEnabled = resolveAutomationEnabled({
    automationEnabled: input.automationEnabled,
    fallback: existing.automationEnabled,
  });
  const nextStatus = resolveAgentStatus(input.status, existing.status);

  const resetSession = nextAgentType !== existing.agentType
    || nextWorkingDir !== existing.workingDir
    || nextModel !== existing.model
    || nextDefaultPrompt !== existing.defaultPrompt
    || nextHeartbeatPrompt !== existing.heartbeatPrompt;

  const db = getDb();
  const result = db.prepare(`
    UPDATE control_agents
    SET
      project_id = ?,
      name = ?,
      agent_type = ?,
      working_dir = ?,
      model = ?,
      default_prompt = ?,
      heartbeat_prompt = ?,
      heartbeat_interval_seconds = ?,
      automation_enabled = ?,
      status = ?,
      copilot_session_id = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    nextProjectId,
    nextName,
    nextAgentType,
    nextWorkingDir,
    nextModel,
    nextDefaultPrompt,
    nextHeartbeatPrompt,
    nextHeartbeatInterval ?? null,
    nextAutomationEnabled ? 1 : 0,
    nextStatus,
    resetSession ? null : existing.copilotSessionId,
    input.id
  );
  if (result.changes === 0) throw new Error(`Agent ${input.id} not found`);
  return getAgent(input.id);
}

export function deleteAgent(agentId: number): void {
  ensureSchema();
  const db = getDb();
  const counts = db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM control_tasks WHERE agent_id = ?) AS task_count,
      (SELECT COUNT(*) FROM control_schedules WHERE agent_id = ?) AS schedule_count
  `).get(agentId, agentId) as {
    task_count: number;
    schedule_count: number;
  };

  if (counts.task_count > 0 || counts.schedule_count > 0) {
    throw new Error(
      `Agent ${agentId} cannot be deleted until dependent tasks and schedules are removed or reassigned (tasks: ${counts.task_count}, schedules: ${counts.schedule_count}).`
    );
  }

  db.prepare(`DELETE FROM control_agent_messages WHERE agent_id = ?`).run(agentId);
  const result = db.prepare(`DELETE FROM control_agents WHERE id = ?`).run(agentId);
  if (result.changes === 0) throw new Error(`Agent ${agentId} not found`);
}

export function updateAgentRuntime(input: {
  agentId: number;
  status?: string;
  copilotSessionId?: string | null;
  touchHeartbeat?: boolean;
}): AgentRuntimeRecord {
  ensureSchema();
  requireAgent(input.agentId);

  const db = getDb();
  const assignments: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: Array<number | string | null> = [];

  if (input.status !== undefined) {
    const status = input.status.trim();
    if (!status) throw new Error("Agent status cannot be empty");
    assignments.push("status = ?");
    params.push(status);
  }

  if (input.copilotSessionId !== undefined) {
    assignments.push("copilot_session_id = ?");
    params.push(normalizeText(input.copilotSessionId ?? undefined));
  }

  if (input.touchHeartbeat) {
    assignments.push("last_heartbeat_at = CURRENT_TIMESTAMP");
  }

  params.push(input.agentId);
  db.prepare(`
    UPDATE control_agents
    SET ${assignments.join(", ")}
    WHERE id = ?
  `).run(...params);

  return getAgentRuntime(input.agentId);
}

export function listAgentMessages(agentId: number, limit = 100): AgentChatMessage[] {
  ensureSchema();
  requireAgent(agentId);
  const db = getDb();
  const rows = db.prepare(`
    SELECT id, agent_id, role, content, created_at
    FROM control_agent_messages
    WHERE agent_id = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(agentId, limit) as {
    id: number;
    agent_id: number;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  }[];
  return rows.reverse().map(asAgentChatMessage);
}

export function createAgentMessage(input: {
  agentId: number;
  role: "user" | "assistant" | "system";
  content: string;
}): AgentChatMessage {
  ensureSchema();
  requireAgent(input.agentId);
  const content = input.content.trim();
  if (!content) throw new Error("Agent chat message content is required");

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO control_agent_messages (agent_id, role, content)
    VALUES (?, ?, ?)
  `).run(input.agentId, input.role, content);

  const row = db.prepare(`
    SELECT id, agent_id, role, content, created_at
    FROM control_agent_messages
    WHERE id = ?
  `).get(result.lastInsertRowid) as {
    id: number;
    agent_id: number;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  } | undefined;
  if (!row) throw new Error("Could not load newly created agent chat message");
  return asAgentChatMessage(row);
}

export function listSchedules(projectId?: number): ScheduleRecord[] {
  ensureSchema();
  const db = getDb();
  const query = `
    SELECT
      s.id,
      s.project_id,
      p.name AS project_name,
      s.agent_id,
      a.name AS agent_name,
      s.slug,
      s.name,
      s.schedule_type,
      s.expression,
      s.task_prompt,
      s.enabled,
      s.last_run_at,
      s.next_run_at,
      s.created_at,
      s.updated_at
    FROM control_schedules s
    INNER JOIN control_projects p ON p.id = s.project_id
    LEFT JOIN control_agents a ON a.id = s.agent_id
    ${projectId ? "WHERE s.project_id = ?" : ""}
    ORDER BY s.updated_at DESC, s.id DESC
  `;
  const rows = (projectId
    ? db.prepare(query).all(projectId)
    : db.prepare(query).all()) as {
    id: number;
    project_id: number;
    project_name: string;
    agent_id: number | null;
    agent_name: string | null;
    slug: string;
    name: string;
    schedule_type: string;
    expression: string;
    task_prompt: string | null;
    enabled: number;
    last_run_at: string | null;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
  }[];
  return rows.map(asSchedule);
}

export function createSchedule(input: {
  projectId: number;
  name: string;
  slug?: string;
  agentId?: number | null;
  scheduleType?: string;
  expression: string;
  taskPrompt?: string;
  enabled?: boolean;
}): ScheduleRecord {
  ensureSchema();
  requireProject(input.projectId);
  if (input.agentId != null) requireAgent(input.agentId);

  const db = getDb();
  const name = input.name.trim();
  if (!name) throw new Error("Schedule name is required");
  const scheduleDefinition = validateScheduleDefinition(input.scheduleType ?? "cron", input.expression);

  db.prepare(`
    INSERT INTO control_schedules (
      project_id,
      agent_id,
      slug,
      name,
      schedule_type,
      expression,
      task_prompt,
      enabled
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.projectId,
    input.agentId ?? null,
    slugify(input.slug ?? input.name),
    name,
    scheduleDefinition.scheduleType,
    scheduleDefinition.expression,
    normalizeText(input.taskPrompt),
    input.enabled === false ? 0 : 1
  );

  return listSchedules(input.projectId)[0];
}

export function updateSchedule(input: {
  id: number;
  projectId?: number;
  name?: string;
  agentId?: number | null;
  scheduleType?: string;
  expression?: string;
  taskPrompt?: string;
  enabled?: boolean;
}): ScheduleRecord {
  ensureSchema();
  const existing = getSchedule(input.id);
  const nextProjectId = input.projectId ?? existing.projectId;
  const nextAgentId = input.agentId !== undefined ? input.agentId : existing.agentId;
  const nextName = input.name !== undefined ? input.name.trim() : existing.name;
  const nextEnabled = input.enabled !== undefined ? input.enabled : existing.enabled;
  const scheduleDefinition = validateScheduleDefinition(
    input.scheduleType ?? existing.scheduleType,
    input.expression ?? existing.expression,
  );

  if (!nextName) throw new Error("Schedule name is required");
  requireProject(nextProjectId);
  if (nextAgentId != null) requireAgent(nextAgentId);

  const db = getDb();
  const result = db.prepare(`
    UPDATE control_schedules
    SET
      project_id = ?,
      agent_id = ?,
      name = ?,
      schedule_type = ?,
      expression = ?,
      task_prompt = ?,
      enabled = ?,
      next_run_at = ?,
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(
    nextProjectId,
    nextAgentId ?? null,
    nextName,
    scheduleDefinition.scheduleType,
    scheduleDefinition.expression,
    input.taskPrompt !== undefined ? normalizeText(input.taskPrompt) : existing.taskPrompt,
    nextEnabled ? 1 : 0,
    nextEnabled && input.scheduleType === undefined && input.expression === undefined ? existing.nextRunAt : null,
    input.id
  );
  if (result.changes === 0) throw new Error(`Schedule ${input.id} not found`);
  return getSchedule(input.id);
}

export function markScheduleRan(scheduleId: number): ScheduleRecord {
  return updateScheduleRuntime({ id: scheduleId, lastRunAt: "now" });
}

export function deleteSchedule(scheduleId: number): void {
  ensureSchema();
  const db = getDb();
  const result = db.prepare(`DELETE FROM control_schedules WHERE id = ?`).run(scheduleId);
  if (result.changes === 0) throw new Error(`Schedule ${scheduleId} not found`);
}

export function setScheduleEnabled(id: number, enabled: boolean): ScheduleRecord {
  ensureSchema();
  const db = getDb();
  const result = db.prepare(`
    UPDATE control_schedules
    SET enabled = ?, next_run_at = CASE WHEN ? = 1 THEN next_run_at ELSE NULL END, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(enabled ? 1 : 0, enabled ? 1 : 0, id);
  if (result.changes === 0) throw new Error(`Schedule ${id} not found`);
  const row = db.prepare(`
    SELECT
      s.id,
      s.project_id,
      p.name AS project_name,
      s.agent_id,
      a.name AS agent_name,
      s.slug,
      s.name,
      s.schedule_type,
      s.expression,
      s.task_prompt,
      s.enabled,
      s.last_run_at,
      s.next_run_at,
      s.created_at,
      s.updated_at
    FROM control_schedules s
    INNER JOIN control_projects p ON p.id = s.project_id
    LEFT JOIN control_agents a ON a.id = s.agent_id
    WHERE s.id = ?
  `).get(id) as {
    id: number;
    project_id: number;
    project_name: string;
    agent_id: number | null;
    agent_name: string | null;
    slug: string;
    name: string;
    schedule_type: string;
    expression: string;
    task_prompt: string | null;
    enabled: number;
    last_run_at: string | null;
    next_run_at: string | null;
    created_at: string;
    updated_at: string;
  } | undefined;
  if (!row) throw new Error(`Schedule ${id} not found`);
  return asSchedule(row);
}

export function updateScheduleRuntime(input: {
  id: number;
  lastRunAt?: "now" | string | null;
  nextRunAt?: string | null;
}): ScheduleRecord {
  ensureSchema();
  const db = getDb();
  const assignments: string[] = ["updated_at = CURRENT_TIMESTAMP"];
  const params: Array<number | string | null> = [];

  if (input.lastRunAt !== undefined) {
    if (input.lastRunAt === "now") {
      assignments.push("last_run_at = CURRENT_TIMESTAMP");
    } else {
      assignments.push("last_run_at = ?");
      params.push(input.lastRunAt);
    }
  }

  if (input.nextRunAt !== undefined) {
    assignments.push("next_run_at = ?");
    params.push(input.nextRunAt);
  }

  params.push(input.id);
  const result = db.prepare(`
    UPDATE control_schedules
    SET ${assignments.join(", ")}
    WHERE id = ?
  `).run(...params);
  if (result.changes === 0) throw new Error(`Schedule ${input.id} not found`);
  return getSchedule(input.id);
}

export function listHeartbeats(limit = 50): HeartbeatRecord[] {
  ensureSchema();
  const db = getDb();
  const rows = db.prepare(`
    SELECT
      h.id,
      h.project_id,
      h.agent_id,
      h.task_id,
      h.source_name,
      h.status,
      h.message,
      h.recorded_at
    FROM control_heartbeats h
    ORDER BY h.recorded_at DESC, h.id DESC
    LIMIT ?
  `).all(limit) as {
    id: number;
    project_id: number | null;
    agent_id: number | null;
    task_id: number | null;
    source_name: string;
    status: string;
    message: string | null;
    recorded_at: string;
  }[];
  return rows.map(asHeartbeat);
}

export function recordHeartbeat(input: {
  projectId?: number | null;
  agentId?: number | null;
  taskId?: number | null;
  sourceName: string;
  status: string;
  message?: string;
}): HeartbeatRecord {
  ensureSchema();
  const db = getDb();
  const status = input.status.trim();
  const sourceName = input.sourceName.trim();
  if (!status) throw new Error("Heartbeat status is required");
  if (!sourceName) throw new Error("Heartbeat sourceName is required");

  db.prepare(`
    INSERT INTO control_heartbeats (project_id, agent_id, task_id, source_name, status, message)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.projectId ?? null,
    input.agentId ?? null,
    input.taskId ?? null,
    sourceName,
    status,
    normalizeText(input.message)
  );

  if (input.agentId != null) {
    db.prepare(`
      UPDATE control_agents
      SET status = ?, last_heartbeat_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(status, input.agentId);
  }

  return listHeartbeats(1)[0];
}

export function pingAgent(agentId: number, message?: string): HeartbeatRecord {
  ensureSchema();
  const db = getDb();
  const row = db.prepare(`
    SELECT id, project_id, name
    FROM control_agents
    WHERE id = ?
  `).get(agentId) as { id: number; project_id: number; name: string } | undefined;
  if (!row) throw new Error(`Agent ${agentId} not found`);
  return recordHeartbeat({
    projectId: row.project_id,
    agentId: row.id,
    sourceName: row.name,
    status: "healthy",
    message,
  });
}

export function runControlPlaneLegacyCutoff(): {
  normalizedStatuses: number;
  migratedHeartbeatPrompts: number;
  disabledLegacyAutomation: number;
  deletedLegacyMessages: number;
} {
  ensureSchema();
  const db = getDb();

  let normalizedStatuses = 0;
  let migratedHeartbeatPrompts = 0;
  let disabledLegacyAutomation = 0;
  let deletedLegacyMessages = 0;

  const legacyStatusRows = db.prepare(`
    SELECT id, status
    FROM control_agents
    WHERE lower(trim(status)) IN ('paused', 'active')
  `).all() as { id: number; status: string }[];

  for (const row of legacyStatusRows) {
    const automationEnabled = row.status.trim().toLowerCase() === "active" ? 1 : 0;
    const result = db.prepare(`
      UPDATE control_agents
      SET automation_enabled = ?, status = 'idle', updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(automationEnabled, row.id);
    normalizedStatuses += result.changes;
  }

  const legacyAutomationRows = db.prepare(`
    SELECT id, default_prompt, heartbeat_prompt, heartbeat_interval_seconds, automation_enabled
    FROM control_agents
    WHERE heartbeat_interval_seconds IS NOT NULL
  `).all() as {
    id: number;
    default_prompt: string | null;
    heartbeat_prompt: string | null;
    heartbeat_interval_seconds: number | null;
    automation_enabled: number;
  }[];

  for (const row of legacyAutomationRows) {
    if (!row.heartbeat_prompt && row.default_prompt) {
      try {
        validateHeartbeatPromptInput(row.default_prompt);
        const result = db.prepare(`
          UPDATE control_agents
          SET heartbeat_prompt = ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(row.default_prompt, row.id);
        migratedHeartbeatPrompts += result.changes;
        continue;
      } catch {
        // Fall through to disable incomplete legacy automation below.
      }
    }

    if (!row.heartbeat_prompt && row.automation_enabled === 1) {
      const result = db.prepare(`
        UPDATE control_agents
        SET automation_enabled = 0, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(row.id);
      disabledLegacyAutomation += result.changes;
    }
  }

  const messageRows = db.prepare(`
    SELECT id, agent_id, role, content
    FROM control_agent_messages
    ORDER BY agent_id ASC, id ASC
  `).all() as {
    id: number;
    agent_id: number;
    role: "user" | "assistant" | "system";
    content: string;
  }[];

  const messageIdsToDelete: number[] = [];
  let skipAutomationAssistantForAgent: number | null = null;

  for (const row of messageRows) {
    if (row.role === "system" && row.content.startsWith("[Automatic heartbeat execution]")) {
      messageIdsToDelete.push(row.id);
      skipAutomationAssistantForAgent = row.agent_id;
      continue;
    }

    if (skipAutomationAssistantForAgent === row.agent_id && row.role === "assistant") {
      messageIdsToDelete.push(row.id);
      skipAutomationAssistantForAgent = null;
      continue;
    }

    if (skipAutomationAssistantForAgent === row.agent_id) {
      skipAutomationAssistantForAgent = null;
    }
  }

  if (messageIdsToDelete.length > 0) {
    const statement = db.prepare(`DELETE FROM control_agent_messages WHERE id = ?`);
    const transaction = db.transaction((ids: number[]) => {
      for (const id of ids) {
        statement.run(id);
      }
    });
    transaction(messageIdsToDelete);
    deletedLegacyMessages = messageIdsToDelete.length;
  }

  return {
    normalizedStatuses,
    migratedHeartbeatPrompts,
    disabledLegacyAutomation,
    deletedLegacyMessages,
  };
}
