import express from "express";
import type { Request, Response, NextFunction } from "express";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { randomBytes } from "crypto";
import { join } from "path";
import { sendToOrchestrator, getWorkers, cancelCurrentMessage, getLastRouteResult } from "../copilot/orchestrator.js";
import { sendPhoto } from "../telegram/bot.js";
import { config, persistModel } from "../config.js";
import { getRouterConfig, updateRouterConfig } from "../copilot/router.js";
import { listAvailableModels } from "../copilot/models.js";
import { searchMemories } from "../store/db.js";
import { createMcpServer, readMcpConfig, removeMcpServer, updateMcpServer } from "../copilot/mcp-config.js";
import { createSkill, listSkills, readSkill, removeSkill, updateSkill } from "../copilot/skills.js";
import {
  createAgent,
  deleteAgent,
  deleteProject,
  deleteSchedule,
  deleteTask,
  createProject,
  createSchedule,
  createTask,
  getControlPlaneOverview,
  listAgents,
  listHeartbeats,
  listProjects,
  listSchedules,
  listTasks,
  pingAgent,
  setScheduleEnabled,
  updateAgent,
  updateProject,
  updateSchedule,
  updateTask,
} from "../control-plane/store.js";
import { forgetAgentRuntime, getAgentChatState, runScheduleNow, runTaskNow, sendAgentChatMessage } from "../control-plane/runtime.js";
import { restartDaemon } from "../daemon.js";
import { API_TOKEN_PATH, MAX_HOME, ensureMaxHome } from "../paths.js";
import { getHarnessStatus, readProgress, readFeatureList } from "../copilot/harness.js";

// Ensure token file exists (generate on first run)
let apiToken: string | null = null;
try {
  if (existsSync(API_TOKEN_PATH)) {
    apiToken = readFileSync(API_TOKEN_PATH, "utf-8").trim();
  } else {
    ensureMaxHome();
    apiToken = randomBytes(32).toString("hex");
    writeFileSync(API_TOKEN_PATH, apiToken, { mode: 0o600 });
  }
} catch (err) {
  console.error(`[auth] Failed to load/generate API token: ${err}`);
  process.exit(1);
}

export const app = express();
app.use(express.json());

// CORS for dashboard dev server
app.use((_req: Request, res: Response, next: NextFunction) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS");
  if (_req.method === "OPTIONS") { res.sendStatus(204); return; }
  next();
});

// Bearer token authentication middleware (skip /status health check)
// Supports both Authorization header and ?token= query param (needed for SSE EventSource)
app.use((req: Request, res: Response, next: NextFunction) => {
  if (!apiToken || req.path === "/status" || req.path === "/send-photo") return next();
  const auth = req.headers.authorization;
  const queryToken = req.query.token as string | undefined;
  if (auth === `Bearer ${apiToken}` || queryToken === apiToken) return next();
  res.status(401).json({ error: "Unauthorized" });
  return;
});

// Active SSE connections
const sseClients = new Map<string, Response>();
let connectionCounter = 0;
const HARNESS_DIRS_PATH = join(MAX_HOME, "harness-dirs.json");
const knownHarnessDirs = loadHarnessDirs();

function loadHarnessDirs(): string[] {
  try {
    if (!existsSync(HARNESS_DIRS_PATH)) return [];
    const raw = JSON.parse(readFileSync(HARNESS_DIRS_PATH, "utf-8")) as unknown;
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .slice(0, 20);
  } catch {
    return [];
  }
}

function persistHarnessDirs() {
  ensureMaxHome();
  writeFileSync(HARNESS_DIRS_PATH, `${JSON.stringify(knownHarnessDirs, null, 2)}\n`);
}

function rememberHarnessDir(dir: string | undefined) {
  const normalized = dir?.trim();
  if (!normalized) return;
  const existing = knownHarnessDirs.indexOf(normalized);
  if (existing >= 0) knownHarnessDirs.splice(existing, 1);
  knownHarnessDirs.unshift(normalized);
  if (knownHarnessDirs.length > 20) knownHarnessDirs.length = 20;
  persistHarnessDirs();
}

function toOptionalInt(value: unknown): number | undefined {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function getRouteParam(req: Request, key: string): string {
  const value = req.params[key];
  return Array.isArray(value) ? value[0] : value;
}

function getSlugParam(req: Request): string {
  return getRouteParam(req, "slug");
}

function getMcpServerNameParam(req: Request): string {
  return getRouteParam(req, "name");
}

// Health check
app.get("/status", (_req: Request, res: Response) => {
  const workers = Array.from(getWorkers().values());
  for (const worker of workers) {
    if (worker.isHarnessWorker) rememberHarnessDir(worker.workingDir);
  }
  res.json({
    status: "ok",
    workers: workers.map((w) => ({
      name: w.name,
      workingDir: w.workingDir,
      status: w.status,
      isHarnessWorker: w.isHarnessWorker,
    })),
  });
});

// List worker sessions
app.get("/sessions", (_req: Request, res: Response) => {
  const workers = Array.from(getWorkers().values()).map((w) => {
    if (w.isHarnessWorker) rememberHarnessDir(w.workingDir);
    return {
      name: w.name,
      workingDir: w.workingDir,
      status: w.status,
      lastOutput: w.lastOutput?.slice(0, 500),
      isHarnessWorker: w.isHarnessWorker,
    };
  });
  res.json(workers);
});

// SSE stream for real-time responses
app.get("/stream", (req: Request, res: Response) => {
  const connectionId = `tui-${++connectionCounter}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(`data: ${JSON.stringify({ type: "connected", connectionId })}\n\n`);

  sseClients.set(connectionId, res);

  // Heartbeat to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(`:ping\n\n`);
  }, 20_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(connectionId);
  });
});

// Send a message to the orchestrator
app.post("/message", (req: Request, res: Response) => {
  const { prompt, connectionId } = req.body as { prompt?: string; connectionId?: string };

  if (!prompt || typeof prompt !== "string") {
    res.status(400).json({ error: "Missing 'prompt' in request body" });
    return;
  }

  if (!connectionId || !sseClients.has(connectionId)) {
    res.status(400).json({ error: "Missing or invalid 'connectionId'. Connect to /stream first." });
    return;
  }

  sendToOrchestrator(
    prompt,
    { type: "tui", connectionId },
    (text: string, done: boolean) => {
      const sseRes = sseClients.get(connectionId);
      if (sseRes) {
        const event: Record<string, unknown> = {
          type: done ? "message" : "delta",
          content: text,
        };
        if (done) {
          const routeResult = getLastRouteResult();
          if (routeResult) {
            event.route = {
              model: routeResult.model,
              routerMode: routeResult.routerMode,
              tier: routeResult.tier,
              ...(routeResult.overrideName ? { overrideName: routeResult.overrideName } : {}),
            };
          }
        }
        sseRes.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    }
  );

  res.json({ status: "queued" });
});

// Cancel the current in-flight message
app.post("/cancel", async (_req: Request, res: Response) => {
  const cancelled = await cancelCurrentMessage();
  // Notify all SSE clients that the message was cancelled
  for (const [, sseRes] of sseClients) {
    sseRes.write(
      `data: ${JSON.stringify({ type: "cancelled" })}\n\n`
    );
  }
  res.json({ status: "ok", cancelled });
});

// Get or switch model
app.get("/models", async (_req: Request, res: Response) => {
  res.json(await listAvailableModels());
});

app.get("/model", (_req: Request, res: Response) => {
  res.json({ model: config.copilotModel });
});
app.post("/model", async (req: Request, res: Response) => {
  const { model } = req.body as { model?: string };
  if (!model || typeof model !== "string") {
    res.status(400).json({ error: "Missing 'model' in request body" });
    return;
  }
  // Validate against available models before persisting
  try {
    const { getClient } = await import("../copilot/client.js");
    const client = await getClient();
    const models = await client.listModels();
    const match = models.find((m) => m.id === model);
    if (!match) {
      const suggestions = models
        .filter((m) => m.id.includes(model) || m.id.toLowerCase().includes(model.toLowerCase()))
        .map((m) => m.id);
      const hint = suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?` : "";
      res.status(400).json({ error: `Model '${model}' not found.${hint}` });
      return;
    }
  } catch {
    // If we can't validate (client not ready), allow the switch — it'll fail on next message if wrong
  }
  const previous = config.copilotModel;
  config.copilotModel = model;
  persistModel(model);
  res.json({ previous, current: model });
});

// Get auto-routing config
app.get("/auto", (_req: Request, res: Response) => {
  const routerConfig = getRouterConfig();
  const lastRoute = getLastRouteResult();
  res.json({
    ...routerConfig,
    currentModel: config.copilotModel,
    lastRoute: lastRoute || null,
  });
});

// Update auto-routing config
app.post("/auto", (req: Request, res: Response) => {
  const body = req.body as Partial<{
    enabled: boolean;
    tierModels: Record<string, string>;
    cooldownMessages: number;
  }>;

  const updated = updateRouterConfig(body);
  console.log(`[max] Auto-routing ${updated.enabled ? "enabled" : "disabled"}`);

  res.json(updated);
});

// List memories
app.get("/memory", (_req: Request, res: Response) => {
  const memories = searchMemories(undefined, undefined, 100);
  res.json(memories);
});

// List skills
app.get("/skills", (_req: Request, res: Response) => {
  const skills = listSkills();
  res.json(skills);
});

app.get("/skills/:slug", (req: Request, res: Response) => {
  const slug = getSlugParam(req);
  const result = readSkill(slug);
  if (!result.ok || !result.skill) {
    res.status(400).json({ error: result.message });
    return;
  }
  res.json(result.skill);
});

app.post("/skills", (req: Request, res: Response) => {
  const { slug, name, description, instructions } = req.body as {
    slug?: string;
    name?: string;
    description?: string;
    instructions?: string;
  };

  if (!slug || typeof slug !== "string") {
    res.status(400).json({ error: "Missing 'slug' in request body" });
    return;
  }
  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Missing 'name' in request body" });
    return;
  }
  if (!description || typeof description !== "string") {
    res.status(400).json({ error: "Missing 'description' in request body" });
    return;
  }
  if (!instructions || typeof instructions !== "string") {
    res.status(400).json({ error: "Missing 'instructions' in request body" });
    return;
  }

  const existing = readSkill(slug, "local");
  if (existing.ok) {
    res.status(400).json({ error: `Skill '${slug}' already exists in local skills.` });
    return;
  }

  const message = createSkill(slug, name, description, instructions);
  const created = readSkill(slug, "local");
  if (!created.ok || !created.skill) {
    res.status(400).json({ error: message });
    return;
  }

  res.status(201).json({
    ok: true,
    message,
    skill: created.skill,
  });
});

app.put("/skills/:slug", (req: Request, res: Response) => {
  const slug = getSlugParam(req);
  const body = req.body as {
    name?: string;
    description?: string;
    instructions?: string;
  };

  const update: {
    name?: string;
    description?: string;
    instructions?: string;
  } = {};

  if (body.name !== undefined) {
    if (typeof body.name !== "string") {
      res.status(400).json({ error: "'name' must be a string when provided" });
      return;
    }
    update.name = body.name;
  }
  if (body.description !== undefined) {
    if (typeof body.description !== "string") {
      res.status(400).json({ error: "'description' must be a string when provided" });
      return;
    }
    update.description = body.description;
  }
  if (body.instructions !== undefined) {
    if (typeof body.instructions !== "string") {
      res.status(400).json({ error: "'instructions' must be a string when provided" });
      return;
    }
    update.instructions = body.instructions;
  }

  if (Object.keys(update).length === 0) {
    res.status(400).json({ error: "Provide at least one of 'name', 'description', or 'instructions' in request body" });
    return;
  }

  const result = updateSkill(slug, update);
  if (!result.ok || !result.skill) {
    res.status(400).json({
      error: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    });
    return;
  }

  res.json({
    ok: true,
    message: result.message,
    skill: result.skill,
  });
});

app.get("/mcp", (_req: Request, res: Response) => {
  const result = readMcpConfig();
  if (!result.ok || !result.document) {
    res.status(400).json({ error: result.message });
    return;
  }

  const servers = Object.entries(result.document.mcpServers)
    .map(([name, config]) => ({ name, config }))
    .sort((left, right) => left.name.localeCompare(right.name));

  res.json({
    configPath: result.configPath,
    servers,
  });
});

app.post("/mcp", (req: Request, res: Response) => {
  const { name, config: serverConfig } = req.body as {
    name?: string;
    config?: unknown;
  };

  if (!name || typeof name !== "string") {
    res.status(400).json({ error: "Missing 'name' in request body" });
    return;
  }
  if (!serverConfig || typeof serverConfig !== "object" || Array.isArray(serverConfig)) {
    res.status(400).json({ error: "Missing object 'config' in request body" });
    return;
  }

  const result = createMcpServer(name, serverConfig);
  if (!result.ok || !result.server) {
    res.status(400).json({
      error: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    });
    return;
  }

  res.status(201).json({
    ok: true,
    message: result.message,
    configPath: result.configPath,
    serverName: name,
    server: result.server,
  });
});

app.put("/mcp/:name", (req: Request, res: Response) => {
  const serverName = getMcpServerNameParam(req);
  const { config: serverConfig } = req.body as {
    config?: unknown;
  };

  if (!serverConfig || typeof serverConfig !== "object" || Array.isArray(serverConfig)) {
    res.status(400).json({ error: "Missing object 'config' in request body" });
    return;
  }

  const result = updateMcpServer(serverName, serverConfig);
  if (!result.ok || !result.server) {
    res.status(400).json({
      error: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    });
    return;
  }

  res.json({
    ok: true,
    message: result.message,
    configPath: result.configPath,
    serverName,
    server: result.server,
  });
});

app.delete("/mcp/:name", (req: Request, res: Response) => {
  const serverName = getMcpServerNameParam(req);
  const result = removeMcpServer(serverName);
  if (!result.ok) {
    res.status(400).json({
      error: result.message,
      ...(result.errors ? { errors: result.errors } : {}),
    });
    return;
  }

  res.json({
    ok: true,
    message: result.message,
    configPath: result.configPath,
    serverName,
  });
});

// Remove a local skill
app.delete("/skills/:slug", (req: Request, res: Response) => {
  const slug = getSlugParam(req);
  const result = removeSkill(slug);
  if (!result.ok) {
    res.status(400).json({ error: result.message });
  } else {
    res.json({ ok: true, message: result.message });
  }
});

// Restart daemon
app.post("/restart", (_req: Request, res: Response) => {
  res.json({ status: "restarting" });
  setTimeout(() => {
    restartDaemon().catch((err) => {
      console.error("[max] Restart failed:", err);
    });
  }, 500);
});

// Send a photo to Telegram (protected by bearer token auth middleware)
app.post("/send-photo", async (req: Request, res: Response) => {
  const { photo, caption } = req.body as { photo?: string; caption?: string };

  if (!photo || typeof photo !== "string") {
    res.status(400).json({ error: "Missing 'photo' (file path or URL) in request body" });
    return;
  }

  try {
    await sendPhoto(photo, caption);
    res.json({ status: "sent" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

// ── Control Plane API ──────────────────────────────────────────────────────────

app.get("/control/overview", (_req: Request, res: Response) => {
  res.json(getControlPlaneOverview());
});

app.get("/control/projects", (_req: Request, res: Response) => {
  res.json(listProjects());
});

app.post("/control/projects", (req: Request, res: Response) => {
  try {
    const { name, slug, description, workspacePath, status } = req.body as {
      name?: string;
      slug?: string;
      description?: string;
      workspacePath?: string;
      status?: string;
    };
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing 'name' in request body" });
      return;
    }
    res.status(201).json(createProject({ name, slug, description, workspacePath, status }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.patch("/control/projects/:id", (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    const { name, description, workspacePath, status } = req.body as {
      name?: string;
      description?: string;
      workspacePath?: string;
      status?: string;
    };
    res.json(updateProject({ id: projectId, name, description, workspacePath, status }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.delete("/control/projects/:id", (req: Request, res: Response) => {
  try {
    const projectId = Number(req.params.id);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      res.status(400).json({ error: "Invalid project id" });
      return;
    }
    deleteProject(projectId);
    res.status(204).end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.get("/control/tasks", (req: Request, res: Response) => {
  const projectId = toOptionalInt(req.query.projectId);
  res.json(listTasks(projectId));
});

app.post("/control/tasks", (req: Request, res: Response) => {
  try {
    const { projectId, agentId, title, slug, description, prompt, status } = req.body as {
      projectId?: number;
      agentId?: number | null;
      title?: string;
      slug?: string;
      description?: string;
      prompt?: string;
      status?: string;
    };
    if (!projectId || !Number.isInteger(projectId)) {
      res.status(400).json({ error: "Missing or invalid 'projectId' in request body" });
      return;
    }
    if (!title || typeof title !== "string") {
      res.status(400).json({ error: "Missing 'title' in request body" });
      return;
    }
    res.status(201).json(createTask({
      projectId,
      agentId: typeof agentId === "number" ? agentId : null,
      title,
      slug,
      description,
      prompt,
      status,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.patch("/control/tasks/:id", (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }
    const { projectId, agentId, title, description, prompt, status } = req.body as {
      projectId?: number;
      agentId?: number | null;
      title?: string;
      description?: string;
      prompt?: string;
      status?: string;
    };
    res.json(updateTask({
      id: taskId,
      projectId: typeof projectId === "number" ? projectId : undefined,
      agentId: agentId === null || typeof agentId === "number" ? agentId : undefined,
      title,
      description,
      prompt,
      status,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.delete("/control/tasks/:id", (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }
    deleteTask(taskId);
    res.status(204).end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.post("/control/tasks/:id/run", async (req: Request, res: Response) => {
  try {
    const taskId = Number(req.params.id);
    if (!Number.isInteger(taskId) || taskId <= 0) {
      res.status(400).json({ error: "Invalid task id" });
      return;
    }
    res.json(await runTaskNow(taskId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.get("/control/agents", (req: Request, res: Response) => {
  const projectId = toOptionalInt(req.query.projectId);
  res.json(listAgents(projectId));
});

app.post("/control/agents", (req: Request, res: Response) => {
  try {
    const {
      projectId,
      name,
      slug,
      agentType,
      workingDir,
      model,
      defaultPrompt,
      heartbeatPrompt,
      heartbeatIntervalSeconds,
      automationEnabled,
      status,
    } = req.body as {
      projectId?: number;
      name?: string;
      slug?: string;
      agentType?: string;
      workingDir?: string;
      model?: string;
      defaultPrompt?: string;
      heartbeatPrompt?: string;
      heartbeatIntervalSeconds?: number | null;
      automationEnabled?: boolean;
      status?: string;
    };
    if (!projectId || !Number.isInteger(projectId)) {
      res.status(400).json({ error: "Missing or invalid 'projectId' in request body" });
      return;
    }
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing 'name' in request body" });
      return;
    }
    res.status(201).json(createAgent({
      projectId,
      name,
      slug,
      agentType: agentType ?? "custom",
      workingDir,
      model,
      defaultPrompt,
      heartbeatPrompt,
      heartbeatIntervalSeconds: typeof heartbeatIntervalSeconds === "number" ? heartbeatIntervalSeconds : null,
      automationEnabled,
      status,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.patch("/control/agents/:id", (req: Request, res: Response) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const {
      projectId,
      name,
      agentType,
      workingDir,
      model,
      defaultPrompt,
      heartbeatPrompt,
      heartbeatIntervalSeconds,
      automationEnabled,
      status,
    } = req.body as {
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
    };
    res.json(updateAgent({
      id: agentId,
      projectId: typeof projectId === "number" ? projectId : undefined,
      name,
      agentType,
      workingDir,
      model,
      defaultPrompt,
      heartbeatPrompt,
      heartbeatIntervalSeconds: heartbeatIntervalSeconds === null || typeof heartbeatIntervalSeconds === "number"
        ? heartbeatIntervalSeconds
        : undefined,
      automationEnabled,
      status,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.delete("/control/agents/:id", (req: Request, res: Response) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    forgetAgentRuntime(agentId);
    deleteAgent(agentId);
    res.status(204).end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.post("/control/agents/:id/heartbeat", (req: Request, res: Response) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const { message } = req.body as { message?: string };
    res.status(201).json(pingAgent(agentId, message));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.get("/control/agents/:id/chat", (req: Request, res: Response) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const limit = toOptionalInt(req.query.limit) ?? 100;
    res.json(getAgentChatState(agentId, limit));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.post("/control/agents/:id/chat", async (req: Request, res: Response) => {
  try {
    const agentId = Number(req.params.id);
    if (!Number.isInteger(agentId) || agentId <= 0) {
      res.status(400).json({ error: "Invalid agent id" });
      return;
    }
    const { message } = req.body as { message?: string };
    if (!message || typeof message !== "string") {
      res.status(400).json({ error: "Missing 'message' in request body" });
      return;
    }
    res.json(await sendAgentChatMessage(agentId, message));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.get("/control/schedules", (req: Request, res: Response) => {
  const projectId = toOptionalInt(req.query.projectId);
  res.json(listSchedules(projectId));
});

app.post("/control/schedules", (req: Request, res: Response) => {
  try {
    const { projectId, agentId, name, slug, scheduleType, expression, taskPrompt, enabled } = req.body as {
      projectId?: number;
      agentId?: number | null;
      name?: string;
      slug?: string;
      scheduleType?: string;
      expression?: string;
      taskPrompt?: string;
      enabled?: boolean;
    };
    if (!projectId || !Number.isInteger(projectId)) {
      res.status(400).json({ error: "Missing or invalid 'projectId' in request body" });
      return;
    }
    if (!name || typeof name !== "string") {
      res.status(400).json({ error: "Missing 'name' in request body" });
      return;
    }
    if (!expression || typeof expression !== "string") {
      res.status(400).json({ error: "Missing 'expression' in request body" });
      return;
    }
    res.status(201).json(createSchedule({
      projectId,
      agentId: typeof agentId === "number" ? agentId : null,
      name,
      slug,
      scheduleType,
      expression,
      taskPrompt,
      enabled,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.patch("/control/schedules/:id", (req: Request, res: Response) => {
  try {
    const scheduleId = Number(req.params.id);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      res.status(400).json({ error: "Invalid schedule id" });
      return;
    }
    const { projectId, agentId, name, scheduleType, expression, taskPrompt, enabled } = req.body as {
      projectId?: number;
      agentId?: number | null;
      name?: string;
      scheduleType?: string;
      expression?: string;
      taskPrompt?: string;
      enabled?: boolean;
    };
    res.json(updateSchedule({
      id: scheduleId,
      projectId: typeof projectId === "number" ? projectId : undefined,
      agentId: agentId === null || typeof agentId === "number" ? agentId : undefined,
      name,
      scheduleType,
      expression,
      taskPrompt,
      enabled,
    }));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.delete("/control/schedules/:id", (req: Request, res: Response) => {
  try {
    const scheduleId = Number(req.params.id);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      res.status(400).json({ error: "Invalid schedule id" });
      return;
    }
    deleteSchedule(scheduleId);
    res.status(204).end();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.post("/control/schedules/:id/toggle", (req: Request, res: Response) => {
  try {
    const scheduleId = Number(req.params.id);
    const { enabled } = req.body as { enabled?: boolean };
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      res.status(400).json({ error: "Invalid schedule id" });
      return;
    }
    if (typeof enabled !== "boolean") {
      res.status(400).json({ error: "Missing boolean 'enabled' in request body" });
      return;
    }
    res.json(setScheduleEnabled(scheduleId, enabled));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.post("/control/schedules/:id/run", async (req: Request, res: Response) => {
  try {
    const scheduleId = Number(req.params.id);
    if (!Number.isInteger(scheduleId) || scheduleId <= 0) {
      res.status(400).json({ error: "Invalid schedule id" });
      return;
    }
    res.json(await runScheduleNow(scheduleId));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(400).json({ error: msg });
  }
});

app.get("/control/heartbeats", (req: Request, res: Response) => {
  const rawLimit = toOptionalInt(req.query.limit);
  res.json(listHeartbeats(rawLimit ?? 50));
});

// ── Harness API ──────────────────────────────────────────────────────────────

// Get harness status for a project directory
app.get("/harness", (req: Request, res: Response) => {
  const dir = req.query.dir as string | undefined;
  if (!dir || typeof dir !== "string") {
    res.status(400).json({ error: "Missing 'dir' query parameter" });
    return;
  }

  try {
    rememberHarnessDir(dir);
    const status = getHarnessStatus(dir);
    const progress = status.phase !== "init" ? readProgress(dir) : [];
    const featureList = status.phase !== "init" ? readFeatureList(dir) : null;
    res.json({ ...status, progressLog: progress, features: featureList?.features ?? [] });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
});

app.get("/harness/recent", (_req: Request, res: Response) => {
  res.json({ dirs: knownHarnessDirs });
});

// Start a new harness (delegates to orchestrator via prompt)
app.post("/harness/start", (req: Request, res: Response) => {
  const { dir, goal, connectionId } = req.body as {
    dir?: string;
    goal?: string;
    connectionId?: string;
  };

  if (!dir || !goal) {
    res.status(400).json({ error: "Missing 'dir' and/or 'goal' in request body" });
    return;
  }

  if (!connectionId || !sseClients.has(connectionId)) {
    res.status(400).json({ error: "Missing or invalid 'connectionId'. Connect to /stream first." });
    return;
  }

  rememberHarnessDir(dir);
  sendToOrchestrator(
    `Create a harness worker session in ${dir} with harness mode enabled. The project goal is: ${goal}`,
    { type: "tui", connectionId },
    (text: string, done: boolean) => {
      const sseRes = sseClients.get(connectionId);
      if (sseRes) {
        sseRes.write(
          `data: ${JSON.stringify({ type: done ? "harness_started" : "delta", content: text })}\n\n`
        );
      }
    }
  );

  res.json({ status: "queued" });
});

// Continue harness (delegates to orchestrator via prompt)
app.post("/harness/continue", (req: Request, res: Response) => {
  const { dir, connectionId } = req.body as {
    dir?: string;
    connectionId?: string;
  };

  if (!dir) {
    res.status(400).json({ error: "Missing 'dir' in request body" });
    return;
  }

  if (!connectionId || !sseClients.has(connectionId)) {
    res.status(400).json({ error: "Missing or invalid 'connectionId'. Connect to /stream first." });
    return;
  }

  rememberHarnessDir(dir);
  sendToOrchestrator(
    `Continue the harness in ${dir}. Call continue_harness with working_dir ${dir} to implement the next feature.`,
    { type: "tui", connectionId },
    (text: string, done: boolean) => {
      const sseRes = sseClients.get(connectionId);
      if (sseRes) {
        sseRes.write(
          `data: ${JSON.stringify({ type: done ? "harness_continued" : "delta", content: text })}\n\n`
        );
      }
    }
  );

  res.json({ status: "queued" });
});

export function startApiServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    const server = app.listen(config.apiPort, "127.0.0.1", () => {
      console.log(`[max] HTTP API listening on http://127.0.0.1:${config.apiPort}`);
      resolve();
    });
    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        reject(new Error(`Port ${config.apiPort} is already in use. Is another Max instance running?`));
      } else {
        reject(err);
      }
    });
  });
}

/** Broadcast a proactive message to all connected SSE clients (for background task completions). */
export function broadcastToSSE(text: string): void {
  for (const [, res] of sseClients) {
    res.write(
      `data: ${JSON.stringify({ type: "message", content: text })}\n\n`
    );
  }
}
