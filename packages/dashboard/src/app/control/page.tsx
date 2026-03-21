"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchAvailableModels,
  createAgent,
  deleteAgent,
  deleteProject,
  deleteSchedule,
  deleteTask,
  createProject,
  createSchedule,
  createTask,
  fetchAgents,
  fetchCurrentModel,
  fetchControlOverview,
  fetchHeartbeats,
  fetchProjects,
  fetchSchedules,
  fetchTasks,
  pingAgent,
  runScheduleNow,
  runTaskNow,
  toggleSchedule,
  updateAgent,
  updateProject,
  updateSchedule,
  updateTask,
  type AgentRecord,
  type AvailableModel,
  type ControlOverview,
  type HeartbeatRecord,
  type ProjectRecord,
  type ScheduleRecord,
  type TaskRecord,
} from "@/lib/api";

function formatTimestamp(value: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleString();
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
    </label>
  );
}

function inputClassName() {
  return "w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]";
}

function cardClassName() {
  return "rounded-xl bg-[var(--bg-card)] border border-[var(--border)]";
}

export default function ControlPlanePage() {
  const [overview, setOverview] = useState<ControlOverview | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [schedules, setSchedules] = useState<ScheduleRecord[]>([]);
  const [heartbeats, setHeartbeats] = useState<HeartbeatRecord[]>([]);
  const [availableModels, setAvailableModels] = useState<AvailableModel[]>([]);
  const [currentModel, setCurrentModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [projectForm, setProjectForm] = useState({
    name: "",
    workspacePath: "",
    description: "",
  });
  const [taskForm, setTaskForm] = useState({
    projectId: "",
    title: "",
    description: "",
    prompt: "",
    agentId: "",
  });
  const [agentForm, setAgentForm] = useState({
    projectId: "",
    name: "",
    agentType: "custom",
    workingDir: "",
    model: "",
    defaultPrompt: "",
    heartbeatPrompt: "",
    heartbeatIntervalSeconds: "",
    automationEnabled: true,
  });
  const [scheduleForm, setScheduleForm] = useState({
    projectId: "",
    agentId: "",
    name: "",
    scheduleType: "cron",
    expression: "",
    taskPrompt: "",
  });
  const [editingProjectId, setEditingProjectId] = useState<number | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  const [editingAgentId, setEditingAgentId] = useState<number | null>(null);
  const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [overviewData, projectsData, tasksData, agentsData, schedulesData, heartbeatsData, modelsData, currentModelData] = await Promise.all([
        fetchControlOverview(),
        fetchProjects(),
        fetchTasks(),
        fetchAgents(),
        fetchSchedules(),
        fetchHeartbeats(25),
        fetchAvailableModels(),
        fetchCurrentModel(),
      ]);
      setOverview(overviewData);
      setProjects(projectsData);
      setTasks(tasksData);
      setAgents(agentsData);
      setSchedules(schedulesData);
      setHeartbeats(heartbeatsData);
      setAvailableModels(modelsData);
      setCurrentModel(currentModelData.model);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load control plane");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  useEffect(() => {
    if (projects.length === 0) return;
    const defaultProjectId = String(projects[0].id);
    setTaskForm((prev) => prev.projectId ? prev : { ...prev, projectId: defaultProjectId });
    setAgentForm((prev) => prev.projectId ? prev : { ...prev, projectId: defaultProjectId });
    setScheduleForm((prev) => prev.projectId ? prev : { ...prev, projectId: defaultProjectId });
  }, [projects]);

  const taskAgents = useMemo(
    () => agents.filter((agent) => !taskForm.projectId || String(agent.projectId) === taskForm.projectId),
    [agents, taskForm.projectId]
  );

  const scheduleAgents = useMemo(
    () => agents.filter((agent) => !scheduleForm.projectId || String(agent.projectId) === scheduleForm.projectId),
    [agents, scheduleForm.projectId]
  );

  const editingProject = useMemo(
    () => projects.find((project) => project.id === editingProjectId) ?? null,
    [editingProjectId, projects]
  );
  const editingTask = useMemo(
    () => tasks.find((task) => task.id === editingTaskId) ?? null,
    [editingTaskId, tasks]
  );
  const editingAgent = useMemo(
    () => agents.find((agent) => agent.id === editingAgentId) ?? null,
    [editingAgentId, agents]
  );
  const editingSchedule = useMemo(
    () => schedules.find((schedule) => schedule.id === editingScheduleId) ?? null,
    [editingScheduleId, schedules]
  );

  const modelOptions = useMemo(() => {
    if (!agentForm.model || availableModels.some((model) => model.id === agentForm.model)) {
      return availableModels;
    }
    return [
      ...availableModels,
      { id: agentForm.model, label: agentForm.model, description: "Existing saved model" },
    ];
  }, [agentForm.model, availableModels]);

  async function submitAction<T>(key: string, action: () => Promise<T>, onDone: () => void) {
    setSubmitting(key);
    try {
      await action();
      setError(null);
      onDone();
      await loadAll();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitting(null);
    }
  }

  function resetProjectForm() {
    setProjectForm({ name: "", workspacePath: "", description: "" });
    setEditingProjectId(null);
  }

  function resetTaskForm() {
    setTaskForm((prev) => ({ ...prev, title: "", description: "", prompt: "", agentId: "" }));
    setEditingTaskId(null);
  }

  function resetAgentForm() {
    setAgentForm((prev) => ({
      ...prev,
      name: "",
      workingDir: "",
      model: "",
      defaultPrompt: "",
      heartbeatPrompt: "",
      heartbeatIntervalSeconds: "",
      automationEnabled: true,
    }));
    setEditingAgentId(null);
  }

  function resetScheduleForm() {
    setScheduleForm((prev) => ({ ...prev, name: "", expression: "", taskPrompt: "", agentId: "" }));
    setEditingScheduleId(null);
  }

  function beginProjectEdit(project: ProjectRecord) {
    setEditingProjectId(project.id);
    setProjectForm({
      name: project.name,
      workspacePath: project.workspacePath ?? "",
      description: project.description ?? "",
    });
  }

  function beginTaskEdit(task: TaskRecord) {
    setEditingTaskId(task.id);
    setTaskForm({
      projectId: String(task.projectId),
      title: task.title,
      description: task.description ?? "",
      prompt: task.prompt ?? "",
      agentId: task.agentId ? String(task.agentId) : "",
    });
  }

  function beginAgentEdit(agent: AgentRecord) {
    setEditingAgentId(agent.id);
    setAgentForm({
      projectId: String(agent.projectId),
      name: agent.name,
      agentType: agent.agentType,
      workingDir: agent.workingDir ?? "",
      model: agent.model ?? "",
      defaultPrompt: agent.defaultPrompt ?? "",
      heartbeatPrompt: agent.heartbeatPrompt ?? "",
      heartbeatIntervalSeconds: agent.heartbeatIntervalSeconds ? String(agent.heartbeatIntervalSeconds) : "",
      automationEnabled: agent.automationEnabled,
    });
  }

  function beginScheduleEdit(schedule: ScheduleRecord) {
    setEditingScheduleId(schedule.id);
    setScheduleForm({
      projectId: String(schedule.projectId),
      agentId: schedule.agentId ? String(schedule.agentId) : "",
      name: schedule.name,
      scheduleType: schedule.scheduleType,
      expression: schedule.expression,
      taskPrompt: schedule.taskPrompt ?? "",
    });
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Control Plane</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Create and organize projects, tasks, agents, schedules, and heartbeat signals from the dashboard.
          </p>
        </div>
        <button
          onClick={() => void loadAll()}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          Refresh
        </button>
      </div>

      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard label="Projects" value={overview?.projects ?? 0} />
        <StatCard label="Tasks" value={overview?.tasks ?? 0} secondary={`${overview?.runningTasks ?? 0} running`} />
        <StatCard label="Agents" value={overview?.agents ?? 0} secondary={`${overview?.activeAgents ?? 0} active`} />
        <StatCard label="Schedules" value={overview?.schedules ?? 0} secondary={`${overview?.enabledSchedules ?? 0} enabled`} />
        <StatCard label="Latest Heartbeat" value={overview?.latestHeartbeatAt ? "Live" : "—"} secondary={formatTimestamp(overview?.latestHeartbeatAt ?? null)} />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className={cardClassName()}>
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Projects</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Project name">
                <input
                  className={inputClassName()}
                  value={projectForm.name}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="Customer support automation"
                />
              </Field>
              <Field label="Workspace path">
                <input
                  className={inputClassName()}
                  value={projectForm.workspacePath}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, workspacePath: e.target.value }))}
                  placeholder="/Users/you/projects/support"
                />
              </Field>
              <Field label="Description">
                <input
                  className={inputClassName()}
                  value={projectForm.description}
                  onChange={(e) => setProjectForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="What this project manages"
                />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <button
                disabled={submitting === "project" || !projectForm.name.trim()}
                onClick={() => void submitAction(
                  "project",
                  () => editingProjectId
                    ? updateProject(editingProjectId, {
                      name: projectForm.name,
                      workspacePath: projectForm.workspacePath,
                      description: projectForm.description,
                      status: editingProject?.status,
                    })
                    : createProject(projectForm),
                  resetProjectForm
                )}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting === "project"
                  ? editingProjectId ? "Saving..." : "Creating..."
                  : editingProjectId ? "Save Project" : "Create Project"}
              </button>
              {editingProjectId && (
                <button
                  onClick={resetProjectForm}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="space-y-3">
              {projects.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No projects yet.</p>
              ) : (
                projects.map((project) => (
                  <div key={project.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{project.name}</p>
                        <p className="text-xs text-[var(--text-muted)] font-mono">{project.slug}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-1 rounded-full bg-[var(--accent-glow)] text-[var(--accent)]">{project.status}</span>
                        <button
                          onClick={() => beginProjectEdit(project)}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete project "${project.name}"?`)) {
                              void submitAction(`delete-project-${project.id}`, () => deleteProject(project.id), resetProjectForm);
                            }
                          }}
                          className="px-2 py-1 rounded-lg text-xs font-medium border border-[rgba(239,68,68,0.35)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.12)]"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mt-2">{project.description ?? "No description"}</p>
                    <p className="text-xs text-[var(--text-muted)] mt-2 font-mono">{project.workspacePath ?? "No workspace path"}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={cardClassName()}>
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Tasks</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Project">
                <select
                  className={inputClassName()}
                  value={taskForm.projectId}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, projectId: e.target.value }))}
                >
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Assigned agent (optional)">
                <select
                  className={inputClassName()}
                  value={taskForm.agentId}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, agentId: e.target.value }))}
                >
                  <option value="">Unassigned</option>
                  {taskAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Task title">
                <input
                  className={inputClassName()}
                  value={taskForm.title}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, title: e.target.value }))}
                  placeholder="Run nightly docs sync"
                />
              </Field>
              <Field label="Description">
                <input
                  className={inputClassName()}
                  value={taskForm.description}
                  onChange={(e) => setTaskForm((prev) => ({ ...prev, description: e.target.value }))}
                  placeholder="Visible summary for operators"
                />
              </Field>
            </div>
            <Field label="Prompt / task body">
              <textarea
                className={`${inputClassName()} min-h-24`}
                value={taskForm.prompt}
                onChange={(e) => setTaskForm((prev) => ({ ...prev, prompt: e.target.value }))}
                placeholder="Describe what the agent should do when this task is executed"
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                disabled={submitting === "task" || !taskForm.projectId || !taskForm.title.trim()}
                onClick={() => void submitAction(
                  "task",
                  () => editingTaskId
                    ? updateTask(editingTaskId, {
                      projectId: Number(taskForm.projectId),
                      agentId: taskForm.agentId ? Number(taskForm.agentId) : null,
                      title: taskForm.title,
                      description: taskForm.description,
                      prompt: taskForm.prompt,
                      status: editingTask?.status,
                    })
                    : createTask({
                      projectId: Number(taskForm.projectId),
                      agentId: taskForm.agentId ? Number(taskForm.agentId) : null,
                      title: taskForm.title,
                      description: taskForm.description,
                      prompt: taskForm.prompt,
                    }),
                  resetTaskForm
                )}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting === "task"
                  ? editingTaskId ? "Saving..." : "Creating..."
                  : editingTaskId ? "Save Task" : "Create Task"}
              </button>
              {editingTaskId && (
                <button
                  onClick={resetTaskForm}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="space-y-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No tasks yet.</p>
              ) : (
                tasks.map((task) => (
                  <div key={task.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <p className="text-xs text-[var(--text-muted)]">{task.projectName}{task.agentName ? ` · ${task.agentName}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-1 rounded-full bg-[rgba(59,130,246,0.15)] text-[var(--accent)]">{task.status}</span>
                        <button
                          onClick={() => beginTaskEdit(task)}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete task "${task.title}"?`)) {
                              void submitAction(`delete-task-${task.id}`, () => deleteTask(task.id), resetTaskForm);
                            }
                          }}
                          className="px-2 py-1 rounded-lg text-xs font-medium border border-[rgba(239,68,68,0.35)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.12)]"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => void submitAction(`run-task-${task.id}`, () => runTaskNow(task.id), () => {})}
                          disabled={!task.agentId || !task.prompt}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--accent-glow)] text-[var(--accent)] hover:opacity-90 disabled:opacity-40"
                        >
                          Run now
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mt-2">{task.description ?? task.prompt ?? "No details yet."}</p>
                    {task.result && (
                      <p className="text-xs text-[var(--text-muted)] mt-2 whitespace-pre-wrap">
                        Last result: {task.result}
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={cardClassName()}>
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Agents</h3>
          </div>
          <div className="p-4 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Project">
                <select
                  className={inputClassName()}
                  value={agentForm.projectId}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, projectId: e.target.value }))}
                >
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Agent type">
                <select
                  className={inputClassName()}
                  value={agentForm.agentType}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, agentType: e.target.value }))}
                >
                  <option value="custom">custom</option>
                  <option value="worker">worker</option>
                  <option value="harness">harness</option>
                </select>
              </Field>
              <Field label="Agent name">
                <input
                  className={inputClassName()}
                  value={agentForm.name}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="docs-agent"
                />
              </Field>
              <Field label="Working directory">
                <input
                  className={inputClassName()}
                  value={agentForm.workingDir}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, workingDir: e.target.value }))}
                  placeholder="/Users/you/projects/support"
                />
              </Field>
              <Field label="Model">
                <div className="space-y-1.5">
                  <select
                    className={inputClassName()}
                    value={agentForm.model}
                    onChange={(e) => setAgentForm((prev) => ({ ...prev, model: e.target.value }))}
                  >
                    <option value="">{currentModel ? `Use Max default (${currentModel})` : "Use Max default"}</option>
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                  {agentForm.model && (
                    <p className="text-xs text-[var(--text-muted)]">
                      {modelOptions.find((model) => model.id === agentForm.model)?.description ?? "Selected model"}
                    </p>
                  )}
                </div>
              </Field>
              <Field label="Heartbeat interval seconds">
                <input
                  className={inputClassName()}
                  value={agentForm.heartbeatIntervalSeconds}
                  onChange={(e) => setAgentForm((prev) => ({ ...prev, heartbeatIntervalSeconds: e.target.value }))}
                  placeholder="60"
                />
              </Field>
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              `Default prompt` is the agent mission/profile. `Heartbeat tick prompt` is the single one-shot action executed on each cadence tick. Keep timing language in `heartbeat interval seconds`, not in the tick prompt.
            </p>
            <Field label="Heartbeat tick prompt">
              <textarea
                className={`${inputClassName()} min-h-20`}
                value={agentForm.heartbeatPrompt}
                onChange={(e) => setAgentForm((prev) => ({ ...prev, heartbeatPrompt: e.target.value }))}
                placeholder="Open Safari now."
              />
            </Field>
            <Field label="Default prompt">
              <textarea
                className={`${inputClassName()} min-h-24`}
                value={agentForm.defaultPrompt}
                onChange={(e) => setAgentForm((prev) => ({ ...prev, defaultPrompt: e.target.value }))}
                placeholder="Mission/profile for chat and long-lived agent context"
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                disabled={submitting === "agent" || !agentForm.projectId || !agentForm.name.trim()}
                onClick={() => void submitAction(
                  "agent",
                  () => editingAgentId
                    ? updateAgent(editingAgentId, {
                      projectId: Number(agentForm.projectId),
                      name: agentForm.name,
                      agentType: agentForm.agentType,
                      workingDir: agentForm.workingDir,
                      model: agentForm.model,
                      defaultPrompt: agentForm.defaultPrompt,
                      heartbeatPrompt: agentForm.heartbeatPrompt,
                      heartbeatIntervalSeconds: agentForm.heartbeatIntervalSeconds ? Number(agentForm.heartbeatIntervalSeconds) : null,
                      automationEnabled: agentForm.automationEnabled,
                      status: editingAgent?.status,
                    })
                    : createAgent({
                      projectId: Number(agentForm.projectId),
                      name: agentForm.name,
                      agentType: agentForm.agentType,
                      workingDir: agentForm.workingDir,
                      model: agentForm.model,
                      defaultPrompt: agentForm.defaultPrompt,
                      heartbeatPrompt: agentForm.heartbeatPrompt,
                      heartbeatIntervalSeconds: agentForm.heartbeatIntervalSeconds ? Number(agentForm.heartbeatIntervalSeconds) : null,
                      automationEnabled: true,
                    }),
                  resetAgentForm
                )}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting === "agent"
                  ? editingAgentId ? "Saving..." : "Creating..."
                  : editingAgentId ? "Save Agent" : "Create Agent"}
              </button>
              {editingAgentId && (
                <button
                  onClick={resetAgentForm}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                >
                  Cancel
                </button>
              )}
            </div>
            <div className="space-y-3">
              {agents.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No agents yet.</p>
              ) : (
                agents.map((agent) => (
                  <div key={agent.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{agent.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{agent.projectName} · {agent.agentType}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs px-2 py-1 rounded-full bg-[rgba(34,197,94,0.15)] text-[var(--success)]">{agent.status}</span>
                        <span className={`text-xs px-2 py-1 rounded-full ${agent.automationEnabled ? "bg-[rgba(59,130,246,0.15)] text-[var(--accent)]" : "bg-[rgba(148,163,184,0.15)] text-[var(--text-muted)]"}`}>
                          automation {agent.automationEnabled ? "on" : "paused"}
                        </span>
                        <button
                          onClick={() => beginAgentEdit(agent)}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void submitAction(
                            `toggle-agent-${agent.id}`,
                            () => updateAgent(agent.id, {
                              automationEnabled: !agent.automationEnabled,
                            }),
                            () => {}
                          )}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          {agent.automationEnabled ? "Pause" : "Resume"}
                        </button>
                        <a
                          href={`/chat?agentId=${agent.id}`}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--accent-glow)] text-[var(--accent)] hover:opacity-90"
                        >
                          Chat
                        </a>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete agent "${agent.name}"?`)) {
                              void submitAction(`delete-agent-${agent.id}`, () => deleteAgent(agent.id), resetAgentForm);
                            }
                          }}
                          className="px-2 py-1 rounded-lg text-xs font-medium border border-[rgba(239,68,68,0.35)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.12)]"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => void submitAction("heartbeat", () => pingAgent(agent.id, "Manual dashboard ping"), () => {})}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          Ping
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-2">
                      Model: <span className="font-mono">{agent.model ?? "Max default"}</span>
                    </p>
                    <p className="text-sm text-[var(--text-muted)] mt-2">
                      Mission: {agent.defaultPrompt ?? agent.workingDir ?? "No default prompt yet."}
                    </p>
                    <p className="text-sm text-[var(--text-muted)] mt-1">
                      Tick: {agent.heartbeatPrompt ?? "No heartbeat tick prompt yet."}
                    </p>
                    {agent.heartbeatIntervalSeconds && agent.heartbeatPrompt && (
                      <p className="text-xs text-[var(--text-muted)] mt-2">
                        Auto-executes the heartbeat tick prompt every {agent.heartbeatIntervalSeconds}s when automation is enabled.
                      </p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className={cardClassName()}>
          <div className="px-4 py-3 border-b border-[var(--border)]">
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Schedules & Heartbeats</h3>
          </div>
          <div className="p-4 space-y-4">
            <p className="text-xs text-[var(--text-muted)]">
              This foundation stores schedule definitions and live heartbeat signals so the dashboard can evolve into a full automation control plane.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Project">
                <select
                  className={inputClassName()}
                  value={scheduleForm.projectId}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, projectId: e.target.value }))}
                >
                  <option value="">Select project</option>
                  {projects.map((project) => (
                    <option key={project.id} value={project.id}>{project.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Agent (optional)">
                <select
                  className={inputClassName()}
                  value={scheduleForm.agentId}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, agentId: e.target.value }))}
                >
                  <option value="">Unbound schedule</option>
                  {scheduleAgents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name}</option>
                  ))}
                </select>
              </Field>
              <Field label="Schedule name">
                <input
                  className={inputClassName()}
                  value={scheduleForm.name}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, name: e.target.value }))}
                  placeholder="nightly-sync"
                />
              </Field>
              <Field label="Type">
                <select
                  className={inputClassName()}
                  value={scheduleForm.scheduleType}
                  onChange={(e) => setScheduleForm((prev) => ({ ...prev, scheduleType: e.target.value }))}
                >
                  <option value="cron">cron</option>
                  <option value="interval">interval</option>
                  <option value="manual">manual</option>
                </select>
              </Field>
            </div>
            <Field label="Expression">
              <input
                className={inputClassName()}
                value={scheduleForm.expression}
                onChange={(e) => setScheduleForm((prev) => ({ ...prev, expression: e.target.value }))}
                placeholder={
                  scheduleForm.scheduleType === "interval"
                    ? "every-300s or 5m"
                    : scheduleForm.scheduleType === "manual"
                      ? "on-demand"
                      : "0 * * * *"
                }
              />
            </Field>
            <p className="text-xs text-[var(--text-muted)]">
              Supported schedule types: `cron` (UTC 5-field), `interval` (for example `every-300s` or `5m`), and `manual` for run-now only jobs.
            </p>
            <Field label="Task prompt template">
              <textarea
                className={`${inputClassName()} min-h-24`}
                value={scheduleForm.taskPrompt}
                onChange={(e) => setScheduleForm((prev) => ({ ...prev, taskPrompt: e.target.value }))}
                placeholder="Prompt template that the schedule should trigger"
              />
            </Field>
            <div className="flex items-center gap-3">
              <button
                disabled={submitting === "schedule" || !scheduleForm.projectId || !scheduleForm.name.trim() || !scheduleForm.expression.trim()}
                onClick={() => void submitAction(
                  "schedule",
                  () => editingScheduleId
                    ? updateSchedule(editingScheduleId, {
                      projectId: Number(scheduleForm.projectId),
                      agentId: scheduleForm.agentId ? Number(scheduleForm.agentId) : null,
                      name: scheduleForm.name,
                      scheduleType: scheduleForm.scheduleType,
                      expression: scheduleForm.expression,
                      taskPrompt: scheduleForm.taskPrompt,
                      enabled: editingSchedule?.enabled,
                    })
                    : createSchedule({
                      projectId: Number(scheduleForm.projectId),
                      agentId: scheduleForm.agentId ? Number(scheduleForm.agentId) : null,
                      name: scheduleForm.name,
                      scheduleType: scheduleForm.scheduleType,
                      expression: scheduleForm.expression,
                      taskPrompt: scheduleForm.taskPrompt,
                    }),
                  resetScheduleForm
                )}
                className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
              >
                {submitting === "schedule"
                  ? editingScheduleId ? "Saving..." : "Creating..."
                  : editingScheduleId ? "Save Schedule" : "Create Schedule"}
              </button>
              {editingScheduleId && (
                <button
                  onClick={resetScheduleForm}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                >
                  Cancel
                </button>
              )}
            </div>

            <div className="space-y-3">
              {schedules.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No schedules yet.</p>
              ) : (
                schedules.map((schedule) => (
                  <div key={schedule.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-medium">{schedule.name}</p>
                        <p className="text-xs text-[var(--text-muted)]">{schedule.projectName}{schedule.agentName ? ` · ${schedule.agentName}` : ""}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => beginScheduleEdit(schedule)}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => void submitAction(
                            `toggle-${schedule.id}`,
                            () => toggleSchedule(schedule.id, !schedule.enabled),
                            () => {}
                          )}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--bg)] border border-[var(--border)] hover:border-[var(--accent)]"
                        >
                          {schedule.enabled ? "Disable" : "Enable"}
                        </button>
                        <button
                          onClick={() => {
                            if (window.confirm(`Delete schedule "${schedule.name}"?`)) {
                              void submitAction(`delete-schedule-${schedule.id}`, () => deleteSchedule(schedule.id), resetScheduleForm);
                            }
                          }}
                          className="px-2 py-1 rounded-lg text-xs font-medium border border-[rgba(239,68,68,0.35)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.12)]"
                        >
                          Delete
                        </button>
                        <button
                          onClick={() => void submitAction(`run-schedule-${schedule.id}`, () => runScheduleNow(schedule.id), () => {})}
                          disabled={!schedule.agentId || !schedule.taskPrompt}
                          className="px-2 py-1 rounded-lg text-xs font-medium bg-[var(--accent-glow)] text-[var(--accent)] hover:opacity-90 disabled:opacity-40"
                        >
                          Run now
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-[var(--text-muted)] mt-2 font-mono">{schedule.scheduleType}: {schedule.expression}</p>
                    {schedule.nextRunAt && (
                      <p className="text-xs text-[var(--text-muted)] mt-2">Next run: {formatTimestamp(schedule.nextRunAt)}</p>
                    )}
                    {schedule.lastRunAt && (
                      <p className="text-xs text-[var(--text-muted)] mt-1">Last run: {formatTimestamp(schedule.lastRunAt)}</p>
                    )}
                  </div>
                ))
              )}
            </div>

            <div className="pt-4 border-t border-[var(--border)] space-y-3">
              <h4 className="text-sm font-medium text-[var(--text-muted)]">Recent Heartbeats</h4>
              {heartbeats.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">No heartbeat signals yet.</p>
              ) : (
                heartbeats.map((heartbeat) => (
                  <div key={heartbeat.id} className="rounded-lg border border-[var(--border)] p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-medium">{heartbeat.sourceName}</p>
                        <p className="text-xs text-[var(--text-muted)]">{heartbeat.status}</p>
                      </div>
                      <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(heartbeat.recordedAt)}</span>
                    </div>
                    {heartbeat.message && (
                      <p className="text-sm text-[var(--text-muted)] mt-2">{heartbeat.message}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>

      {loading && (
        <div className="text-center text-sm text-[var(--text-muted)] animate-pulse">Loading control plane…</div>
      )}
    </div>
  );
}

function StatCard({ label, value, secondary }: { label: string; value: string | number; secondary?: string }) {
  return (
    <div className={cardClassName()}>
      <div className="p-4">
        <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">{label}</p>
        <p className="text-2xl font-semibold mt-2">{value}</p>
        {secondary && <p className="text-xs text-[var(--text-muted)] mt-1">{secondary}</p>}
      </div>
    </div>
  );
}
