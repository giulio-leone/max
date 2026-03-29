import Database from "better-sqlite3";
import { DB_PATH, ensureMaxHome } from "../paths.js";

let db: Database.Database | undefined;
let logInsertCount = 0;

export function getDb(): Database.Database {
  if (!db) {
    ensureMaxHome();
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS worker_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        copilot_session_id TEXT,
        working_dir TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'idle',
        last_output TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try {
      db.prepare(`SELECT session_source FROM worker_sessions LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE worker_sessions ADD COLUMN session_source TEXT NOT NULL DEFAULT 'max'`);
      db.prepare(`UPDATE worker_sessions SET session_source = 'machine' WHERE working_dir = '(attached)'`).run();
    }
    try {
      db.prepare(`SELECT workspace_label FROM worker_sessions LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE worker_sessions ADD COLUMN workspace_label TEXT`);
    }
    try {
      db.prepare(`SELECT activation_mode FROM worker_sessions LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE worker_sessions ADD COLUMN activation_mode TEXT NOT NULL DEFAULT 'manual'`);
    }
    try {
      db.prepare(`SELECT routing_hint FROM worker_sessions LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE worker_sessions ADD COLUMN routing_hint TEXT`);
    }
    try {
      db.prepare(`SELECT queue_hint FROM worker_sessions LIMIT 1`).get();
    } catch {
      db.exec(`ALTER TABLE worker_sessions ADD COLUMN queue_hint TEXT`);
    }
    db.exec(`
      CREATE TABLE IF NOT EXISTS max_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'unknown',
        ts DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL CHECK(category IN ('preference', 'fact', 'project', 'person', 'routine')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS native_session_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS scoped_memories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL CHECK(scope_type IN ('agent', 'session')),
        scope_id TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('preference', 'fact', 'project', 'person', 'routine')),
        content TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_accessed DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_scoped_memories_scope
      ON scoped_memories (scope_type, scope_id, last_accessed DESC, id DESC)
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS channel_accounts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL CHECK(type IN ('telegram', 'tui', 'background')),
        name TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channel_accounts_active_name
      ON channel_accounts (type, name)
      WHERE deleted_at IS NULL
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS channels (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        account_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        display_name TEXT,
        icon TEXT,
        settings TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        deleted_at DATETIME
      )
    `);
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_channels_active_name
      ON channels (account_id, name)
      WHERE deleted_at IS NULL
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_channels_account
      ON channels (account_id, updated_at DESC, id DESC)
    `);
    db.exec(`
      CREATE TABLE IF NOT EXISTS inbox_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        channel_id INTEGER NOT NULL,
        direction TEXT NOT NULL CHECK(direction IN ('in', 'out')),
        role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
        content TEXT NOT NULL,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_inbox_messages_channel
      ON inbox_messages (channel_id, id DESC)
    `);
    // Migrate: if the table already existed with a stricter CHECK, recreate it
    try {
      db.prepare(`INSERT INTO conversation_log (role, content, source) VALUES ('system', '__migration_test__', 'test')`).run();
      db.prepare(`DELETE FROM conversation_log WHERE content = '__migration_test__'`).run();
    } catch {
      // CHECK constraint doesn't allow 'system' — recreate table preserving data
      db.exec(`ALTER TABLE conversation_log RENAME TO conversation_log_old`);
      db.exec(`
        CREATE TABLE conversation_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
          content TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'unknown',
          ts DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      db.exec(`INSERT INTO conversation_log (role, content, source, ts) SELECT role, content, source, ts FROM conversation_log_old`);
      db.exec(`DROP TABLE conversation_log_old`);
    }
    // Prune conversation log at startup
    db.prepare(`DELETE FROM conversation_log WHERE id NOT IN (SELECT id FROM conversation_log ORDER BY id DESC LIMIT 200)`).run();
  }
  return db;
}

export function getState(key: string): string | undefined {
  const db = getDb();
  const row = db.prepare(`SELECT value FROM max_state WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value;
}

export type WorkerSessionSource = "max" | "machine";
export type WorkerActivationMode = "manual" | "suggested" | "pinned";

export interface PersistedWorkerSession {
  name: string;
  copilotSessionId: string | null;
  workingDir: string;
  status: string;
  lastOutput: string | null;
  sessionSource: WorkerSessionSource;
  workspaceLabel: string | null;
  activationMode: WorkerActivationMode;
  routingHint: string | null;
  queueHint: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NativeSessionChatMessage {
  id: number;
  sessionName: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export type MemoryCategory = "preference" | "fact" | "project" | "person" | "routine";
export type MemorySource = "user" | "auto";
export type MemoryScopeType = "agent" | "session";

export interface ScopedMemoryRecord {
  id: number;
  scopeType: MemoryScopeType;
  scopeId: string;
  category: MemoryCategory;
  content: string;
  source: string;
  createdAt: string;
}

export const CHANNEL_ACCOUNT_TYPES = ["telegram", "tui", "background"] as const;
export type ChannelAccountType = (typeof CHANNEL_ACCOUNT_TYPES)[number];
export type InboxMessageDirection = "in" | "out";

export interface ChannelAccountRecord {
  id: number;
  type: ChannelAccountType;
  name: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ChannelRecord {
  id: number;
  accountId: number;
  accountType: ChannelAccountType;
  accountName: string;
  name: string;
  displayName: string | null;
  icon: string | null;
  settings: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface InboxMessageRecord {
  id: number;
  channelId: number;
  direction: InboxMessageDirection;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  channel: {
    id: number;
    name: string;
    displayName: string | null;
    icon: string | null;
  };
  account: {
    id: number;
    type: ChannelAccountType;
    name: string;
  };
}

export type MessageChannelSource =
  | { type: "telegram"; chatId: number; messageId?: number; channelId?: number; routeHint?: string; senderId?: string }
  | { type: "tui"; connectionId: string; channelId?: number; routeHint?: string; senderId?: string }
  | { type: "background"; channelId?: number; routeHint?: string; senderId?: string };

export interface MessageChannelResolution {
  account: ChannelAccountRecord;
  channel: ChannelRecord;
  resolution: "explicit" | "route-hint" | "default";
}

export interface EffectiveChannelPolicy {
  routeHint: string | null;
  allowlistMode: "open" | "allowlist";
  allowlist: string[];
}

export interface MessageChannelAccessDecision {
  resolution: MessageChannelResolution;
  policy: EffectiveChannelPolicy;
  identities: string[];
  allowed: boolean;
  denialReason?: string;
}

export function isChannelAccountType(value: unknown): value is ChannelAccountType {
  return typeof value === "string" && CHANNEL_ACCOUNT_TYPES.includes(value as ChannelAccountType);
}

export function listPersistedWorkerSessions(): PersistedWorkerSession[] {
  const rows = getDb().prepare(`
    SELECT
      name,
      copilot_session_id,
      working_dir,
      status,
      last_output,
      session_source,
      workspace_label,
      activation_mode,
      routing_hint,
      queue_hint,
      created_at,
      updated_at
    FROM worker_sessions
    ORDER BY updated_at DESC, id DESC
  `).all() as Array<{
    name: string;
    copilot_session_id: string | null;
    working_dir: string;
    status: string;
    last_output: string | null;
    session_source: string | null;
    workspace_label: string | null;
    activation_mode: string | null;
    routing_hint: string | null;
    queue_hint: string | null;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
    name: row.name,
    copilotSessionId: row.copilot_session_id,
    workingDir: row.working_dir,
    status: row.status,
    lastOutput: row.last_output,
    sessionSource: row.session_source === "machine" ? "machine" : "max",
    workspaceLabel: row.workspace_label,
    activationMode: row.activation_mode === "pinned" || row.activation_mode === "suggested"
      ? row.activation_mode
      : "manual",
    routingHint: row.routing_hint,
    queueHint: row.queue_hint,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function upsertWorkerSession(input: {
  name: string;
  copilotSessionId: string | null;
  workingDir: string;
  status: string;
  lastOutput?: string | null;
  sessionSource?: WorkerSessionSource;
  workspaceLabel?: string | null;
  activationMode?: WorkerActivationMode;
  routingHint?: string | null;
  queueHint?: string | null;
}): void {
  getDb().prepare(`
    INSERT INTO worker_sessions (
      name,
      copilot_session_id,
      working_dir,
      status,
      last_output,
      session_source,
      workspace_label,
      activation_mode,
      routing_hint,
      queue_hint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET
      copilot_session_id = excluded.copilot_session_id,
      working_dir = excluded.working_dir,
      status = excluded.status,
      last_output = excluded.last_output,
      session_source = excluded.session_source,
      workspace_label = excluded.workspace_label,
      activation_mode = excluded.activation_mode,
      routing_hint = excluded.routing_hint,
      queue_hint = excluded.queue_hint,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    input.name,
    input.copilotSessionId,
    input.workingDir,
    input.status,
    input.lastOutput ?? null,
    input.sessionSource ?? "max",
    input.workspaceLabel ?? null,
    input.activationMode ?? "manual",
    input.routingHint ?? null,
    input.queueHint ?? null
  );
}

export function updateWorkerSessionStatus(name: string, status: string, lastOutput?: string | null): void {
  if (lastOutput === undefined) {
    getDb().prepare(`
      UPDATE worker_sessions
      SET status = ?, updated_at = CURRENT_TIMESTAMP
      WHERE name = ?
    `).run(status, name);
    return;
  }

  getDb().prepare(`
    UPDATE worker_sessions
    SET status = ?, last_output = ?, updated_at = CURRENT_TIMESTAMP
    WHERE name = ?
  `).run(status, lastOutput, name);
}

export function updateWorkerSessionMetadata(name: string, metadata: {
  workspaceLabel?: string | null;
  activationMode?: WorkerActivationMode;
  routingHint?: string | null;
  queueHint?: string | null;
}): void {
  const assignments: string[] = [];
  const values: Array<string | null> = [];

  if (metadata.workspaceLabel !== undefined) {
    assignments.push("workspace_label = ?");
    values.push(metadata.workspaceLabel);
  }
  if (metadata.activationMode !== undefined) {
    assignments.push("activation_mode = ?");
    values.push(metadata.activationMode);
  }
  if (metadata.routingHint !== undefined) {
    assignments.push("routing_hint = ?");
    values.push(metadata.routingHint);
  }
  if (metadata.queueHint !== undefined) {
    assignments.push("queue_hint = ?");
    values.push(metadata.queueHint);
  }

  if (assignments.length === 0) {
    return;
  }

  assignments.push("updated_at = CURRENT_TIMESTAMP");
  getDb().prepare(`
    UPDATE worker_sessions
    SET ${assignments.join(", ")}
    WHERE name = ?
  `).run(...values, name);
}

export function deleteWorkerSession(name: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM native_session_messages WHERE session_name = ?`).run(name);
  db.prepare(`DELETE FROM scoped_memories WHERE scope_type = 'session' AND scope_id = ?`).run(name);
  db.prepare(`DELETE FROM worker_sessions WHERE name = ?`).run(name);
}

function asNativeSessionChatMessage(row: {
  id: number;
  session_name: string;
  role: "user" | "assistant" | "system";
  content: string;
  created_at: string;
}): NativeSessionChatMessage {
  return {
    id: row.id,
    sessionName: row.session_name,
    role: row.role,
    content: row.content,
    createdAt: row.created_at,
  };
}

export function listNativeSessionMessages(sessionName: string, limit = 100): NativeSessionChatMessage[] {
  const safeLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 500) : 100;
  const rows = getDb().prepare(`
    SELECT id, session_name, role, content, created_at
    FROM native_session_messages
    WHERE session_name = ?
    ORDER BY id DESC
    LIMIT ?
  `).all(sessionName, safeLimit) as {
    id: number;
    session_name: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  }[];

  return rows.reverse().map(asNativeSessionChatMessage);
}

export function createNativeSessionMessage(input: {
  sessionName: string;
  role: "user" | "assistant" | "system";
  content: string;
}): NativeSessionChatMessage {
  const content = input.content.trim();
  if (!content) {
    throw new Error("Native session chat message content is required");
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO native_session_messages (session_name, role, content)
    VALUES (?, ?, ?)
  `).run(input.sessionName, input.role, content);

  db.prepare(`
    DELETE FROM native_session_messages
    WHERE session_name = ?
      AND id NOT IN (
        SELECT id
        FROM native_session_messages
        WHERE session_name = ?
        ORDER BY id DESC
        LIMIT 500
      )
  `).run(input.sessionName, input.sessionName);

  const row = db.prepare(`
    SELECT id, session_name, role, content, created_at
    FROM native_session_messages
    WHERE id = ?
  `).get(result.lastInsertRowid) as {
    id: number;
    session_name: string;
    role: "user" | "assistant" | "system";
    content: string;
    created_at: string;
  } | undefined;

  if (!row) {
    throw new Error("Could not load newly created native session chat message");
  }

  return asNativeSessionChatMessage(row);
}

function asScopedMemoryRecord(row: {
  id: number;
  scope_type: MemoryScopeType;
  scope_id: string;
  category: MemoryCategory;
  content: string;
  source: string;
  created_at: string;
}): ScopedMemoryRecord {
  return {
    id: row.id,
    scopeType: row.scope_type,
    scopeId: row.scope_id,
    category: row.category,
    content: row.content,
    source: row.source,
    createdAt: row.created_at,
  };
}

function addScopedMemory(
  scopeType: MemoryScopeType,
  scopeId: string,
  category: MemoryCategory,
  content: string,
  source: MemorySource = "user"
): number {
  const normalizedContent = content.trim();
  if (!normalizedContent) {
    throw new Error("Scoped memory content is required");
  }
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO scoped_memories (scope_type, scope_id, category, content, source)
    VALUES (?, ?, ?, ?, ?)
  `).run(scopeType, scopeId, category, normalizedContent, source);
  return result.lastInsertRowid as number;
}

function searchScopedMemories(
  scopeType: MemoryScopeType,
  scopeId: string,
  keyword?: string,
  category?: string,
  limit = 20
): ScopedMemoryRecord[] {
  const db = getDb();
  const conditions = ["scope_type = ?", "scope_id = ?"];
  const params: Array<string | number> = [scopeType, scopeId];

  if (keyword) {
    conditions.push(`content LIKE ?`);
    params.push(`%${keyword}%`);
  }
  if (category) {
    conditions.push(`category = ?`);
    params.push(category);
  }

  params.push(limit);
  const rows = db.prepare(`
    SELECT id, scope_type, scope_id, category, content, source, created_at
    FROM scoped_memories
    WHERE ${conditions.join(" AND ")}
    ORDER BY last_accessed DESC, id DESC
    LIMIT ?
  `).all(...params) as {
    id: number;
    scope_type: MemoryScopeType;
    scope_id: string;
    category: MemoryCategory;
    content: string;
    source: string;
    created_at: string;
  }[];

  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    db.prepare(`UPDATE scoped_memories SET last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(
      ...rows.map((row) => row.id)
    );
  }

  return rows.map(asScopedMemoryRecord);
}

function removeScopedMemory(scopeType: MemoryScopeType, scopeId: string, id: number): boolean {
  const result = getDb().prepare(`
    DELETE FROM scoped_memories
    WHERE id = ? AND scope_type = ? AND scope_id = ?
  `).run(id, scopeType, scopeId);
  return result.changes > 0;
}

function getScopedMemorySummary(scopeType: MemoryScopeType, scopeId: string, limit = 50): string {
  const rows = searchScopedMemories(scopeType, scopeId, undefined, undefined, limit);
  if (rows.length === 0) return "";

  const grouped: Record<string, ScopedMemoryRecord[]> = {};
  for (const row of rows) {
    if (!grouped[row.category]) grouped[row.category] = [];
    grouped[row.category].push(row);
  }

  return Object.entries(grouped).map(([memoryCategory, items]) => {
    const lines = items.map((item) => `  - [#${item.id}] ${item.content}`).join("\n");
    return `**${memoryCategory}**:\n${lines}`;
  }).join("\n");
}

export function addAgentMemory(
  agentId: number,
  category: MemoryCategory,
  content: string,
  source: MemorySource = "user"
): number {
  return addScopedMemory("agent", String(agentId), category, content, source);
}

export function searchAgentMemories(
  agentId: number,
  keyword?: string,
  category?: string,
  limit = 20
): ScopedMemoryRecord[] {
  return searchScopedMemories("agent", String(agentId), keyword, category, limit);
}

export function removeAgentMemory(agentId: number, id: number): boolean {
  return removeScopedMemory("agent", String(agentId), id);
}

export function getAgentMemorySummary(agentId: number, limit = 50): string {
  return getScopedMemorySummary("agent", String(agentId), limit);
}

export function clearAgentMemories(agentId: number): void {
  getDb().prepare(`DELETE FROM scoped_memories WHERE scope_type = 'agent' AND scope_id = ?`).run(String(agentId));
}

export function addSessionMemory(
  sessionName: string,
  category: MemoryCategory,
  content: string,
  source: MemorySource = "user"
): number {
  return addScopedMemory("session", sessionName, category, content, source);
}

export function searchSessionMemories(
  sessionName: string,
  keyword?: string,
  category?: string,
  limit = 20
): ScopedMemoryRecord[] {
  return searchScopedMemories("session", sessionName, keyword, category, limit);
}

export function removeSessionMemory(sessionName: string, id: number): boolean {
  return removeScopedMemory("session", sessionName, id);
}

export function getSessionMemorySummary(sessionName: string, limit = 50): string {
  return getScopedMemorySummary("session", sessionName, limit);
}

export function clearSessionMemories(sessionName: string): void {
  getDb().prepare(`DELETE FROM scoped_memories WHERE scope_type = 'session' AND scope_id = ?`).run(sessionName);
}

function parseStoredObject(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed persisted JSON and surface the rest of the row.
  }
  return null;
}

function stringifyStoredObject(value: Record<string, unknown> | null | undefined): string | null {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function normalizeRequiredText(value: string, fieldName: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${fieldName} is required`);
  }
  return normalized;
}

function coerceChannelAccountType(value: string): ChannelAccountType {
  if (!isChannelAccountType(value)) {
    throw new Error(`Unknown channel account type '${value}'`);
  }
  return value;
}

function asChannelAccountRecord(row: {
  id: number;
  type: string;
  name: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}): ChannelAccountRecord {
  return {
    id: row.id,
    type: coerceChannelAccountType(row.type),
    name: row.name,
    metadata: parseStoredObject(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function asChannelRecord(row: {
  id: number;
  account_id: number;
  account_type: string;
  account_name: string;
  name: string;
  display_name: string | null;
  icon: string | null;
  settings: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}): ChannelRecord {
  return {
    id: row.id,
    accountId: row.account_id,
    accountType: coerceChannelAccountType(row.account_type),
    accountName: row.account_name,
    name: row.name,
    displayName: row.display_name,
    icon: row.icon,
    settings: parseStoredObject(row.settings),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

function asInboxMessageRecord(row: {
  id: number;
  channel_id: number;
  direction: InboxMessageDirection;
  role: "user" | "assistant" | "system";
  content: string;
  metadata: string | null;
  created_at: string;
  channel_name: string;
  channel_display_name: string | null;
  channel_icon: string | null;
  account_id: number;
  account_type: string;
  account_name: string;
}): InboxMessageRecord {
  return {
    id: row.id,
    channelId: row.channel_id,
    direction: row.direction,
    role: row.role,
    content: row.content,
    metadata: parseStoredObject(row.metadata),
    createdAt: row.created_at,
    channel: {
      id: row.channel_id,
      name: row.channel_name,
      displayName: row.channel_display_name,
      icon: row.channel_icon,
    },
    account: {
      id: row.account_id,
      type: coerceChannelAccountType(row.account_type),
      name: row.account_name,
    },
  };
}

function getChannelAccountRow(accountId: number, includeDeleted = false): ChannelAccountRecord | undefined {
  const row = getDb().prepare(`
    SELECT id, type, name, metadata, created_at, updated_at, deleted_at
    FROM channel_accounts
    WHERE id = ?
      ${includeDeleted ? "" : "AND deleted_at IS NULL"}
  `).get(accountId) as {
    id: number;
    type: string;
    name: string;
    metadata: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  } | undefined;

  return row ? asChannelAccountRecord(row) : undefined;
}

function getActiveChannelAccountByTypeAndName(type: ChannelAccountType, name: string): ChannelAccountRecord | undefined {
  const row = getDb().prepare(`
    SELECT id, type, name, metadata, created_at, updated_at, deleted_at
    FROM channel_accounts
    WHERE type = ? AND name = ? AND deleted_at IS NULL
  `).get(type, name) as {
    id: number;
    type: string;
    name: string;
    metadata: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  } | undefined;

  return row ? asChannelAccountRecord(row) : undefined;
}

function getChannelRow(channelId: number, includeDeleted = false): ChannelRecord | undefined {
  const row = getDb().prepare(`
    SELECT
      c.id,
      c.account_id,
      a.type AS account_type,
      a.name AS account_name,
      c.name,
      c.display_name,
      c.icon,
      c.settings,
      c.created_at,
      c.updated_at,
      c.deleted_at
    FROM channels c
    JOIN channel_accounts a ON a.id = c.account_id
    WHERE c.id = ?
      ${includeDeleted ? "" : "AND c.deleted_at IS NULL AND a.deleted_at IS NULL"}
  `).get(channelId) as {
    id: number;
    account_id: number;
    account_type: string;
    account_name: string;
    name: string;
    display_name: string | null;
    icon: string | null;
    settings: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  } | undefined;

  return row ? asChannelRecord(row) : undefined;
}

function getActiveChannelByAccountAndName(accountId: number, name: string): ChannelRecord | undefined {
  const row = getDb().prepare(`
    SELECT
      c.id,
      c.account_id,
      a.type AS account_type,
      a.name AS account_name,
      c.name,
      c.display_name,
      c.icon,
      c.settings,
      c.created_at,
      c.updated_at,
      c.deleted_at
    FROM channels c
    JOIN channel_accounts a ON a.id = c.account_id
    WHERE c.account_id = ? AND c.name = ? AND c.deleted_at IS NULL AND a.deleted_at IS NULL
  `).get(accountId, name) as {
    id: number;
    account_id: number;
    account_type: string;
    account_name: string;
    name: string;
    display_name: string | null;
    icon: string | null;
    settings: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  } | undefined;

  return row ? asChannelRecord(row) : undefined;
}

function ensureChannelAccount(input: {
  type: ChannelAccountType;
  name: string;
  metadata?: Record<string, unknown> | null;
}): ChannelAccountRecord {
  const normalizedName = normalizeRequiredText(input.name, "Channel account name");
  const existing = getActiveChannelAccountByTypeAndName(input.type, normalizedName);
  if (existing) {
    return existing;
  }

  const result = getDb().prepare(`
    INSERT INTO channel_accounts (type, name, metadata)
    VALUES (?, ?, ?)
  `).run(input.type, normalizedName, stringifyStoredObject(input.metadata));

  const created = getChannelAccountRow(Number(result.lastInsertRowid), true);
  if (!created) {
    throw new Error("Could not load newly created channel account");
  }
  return created;
}

function ensureChannel(input: {
  accountId: number;
  name: string;
  displayName?: string | null;
  icon?: string | null;
  settings?: Record<string, unknown> | null;
}): ChannelRecord {
  const normalizedName = normalizeRequiredText(input.name, "Channel name");
  const existing = getActiveChannelByAccountAndName(input.accountId, normalizedName);
  if (existing) {
    return existing;
  }

  const result = getDb().prepare(`
    INSERT INTO channels (account_id, name, display_name, icon, settings)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.accountId,
    normalizedName,
    input.displayName?.trim() || null,
    input.icon?.trim() || null,
    stringifyStoredObject(input.settings),
  );

  const created = getChannelRow(Number(result.lastInsertRowid), true);
  if (!created) {
    throw new Error("Could not load newly created channel");
  }
  return created;
}

function getRouteHintFromSettings(settings: Record<string, unknown> | null): string | null {
  const routeHint = settings?.routeHint;
  return typeof routeHint === "string" && routeHint.trim().length > 0 ? routeHint.trim() : null;
}

function findChannelByRouteHint(type: ChannelAccountType, routeHint: string): ChannelRecord | undefined {
  const normalizedRouteHint = routeHint.trim();
  if (!normalizedRouteHint) return undefined;

  const rows = getDb().prepare(`
    SELECT
      c.id,
      c.account_id,
      a.type AS account_type,
      a.name AS account_name,
      c.name,
      c.display_name,
      c.icon,
      c.settings,
      c.created_at,
      c.updated_at,
      c.deleted_at
    FROM channels c
    JOIN channel_accounts a ON a.id = c.account_id
    WHERE a.type = ? AND c.deleted_at IS NULL AND a.deleted_at IS NULL
    ORDER BY c.updated_at DESC, c.id DESC
  `).all(type) as Array<{
    id: number;
    account_id: number;
    account_type: string;
    account_name: string;
    name: string;
    display_name: string | null;
    icon: string | null;
    settings: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;

  for (const row of rows) {
    const channel = asChannelRecord(row);
    if (getRouteHintFromSettings(channel.settings) === normalizedRouteHint) {
      return channel;
    }
  }

  return undefined;
}

function getEffectiveChannelPolicy(channel: ChannelRecord): EffectiveChannelPolicy {
  const account = getChannelAccountRow(channel.accountId, true);
  const accountMetadata = account?.metadata ?? null;
  const channelSettings = channel.settings ?? null;

  const accountAllowlist = readStringArray(accountMetadata?.allowlist);
  const channelAllowlist = readStringArray(channelSettings?.allowlist);
  const mergedAllowlist = channelAllowlist.length > 0 ? channelAllowlist : accountAllowlist;

  const accountAllowlistMode = accountMetadata?.allowlistMode === "allowlist";
  const channelAllowlistMode = channelSettings?.allowlistMode === "allowlist";

  return {
    routeHint: getRouteHintFromSettings(channelSettings)
      ?? (typeof accountMetadata?.defaultRouteHint === "string" && accountMetadata.defaultRouteHint.trim().length > 0
        ? accountMetadata.defaultRouteHint.trim()
        : null),
    allowlistMode: channelAllowlistMode || accountAllowlistMode || mergedAllowlist.length > 0
      ? "allowlist"
      : "open",
    allowlist: mergedAllowlist,
  };
}

function getSourceAllowlistIdentities(source: MessageChannelSource): string[] {
  const identities = new Set<string>();

  if (typeof source.senderId === "string" && source.senderId.trim().length > 0) {
    const normalizedSenderId = source.senderId.trim();
    identities.add(normalizedSenderId);
    identities.add(`${source.type}:${normalizedSenderId}`);
  }

  if (source.type === "telegram") {
    identities.add(String(source.chatId));
    identities.add(`telegram:${source.chatId}`);
  } else if (source.type === "tui") {
    identities.add(source.connectionId);
    identities.add(`tui:${source.connectionId}`);
  } else {
    identities.add("background");
  }

  return Array.from(identities);
}

function getDefaultMessageChannel(source: MessageChannelSource): MessageChannelResolution {
  switch (source.type) {
    case "telegram": {
      const account = ensureChannelAccount({
        type: "telegram",
        name: "telegram",
        metadata: { provider: "telegram" },
      });
      const channel = ensureChannel({
        accountId: account.id,
        name: `chat-${source.chatId}`,
        displayName: `Telegram ${source.chatId}`,
        icon: "message-circle",
        settings: { chatId: source.chatId },
      });
      return { account, channel, resolution: "default" };
    }
    case "tui": {
      const account = ensureChannelAccount({
        type: "tui",
        name: "tui",
        metadata: { provider: "tui" },
      });
      const channel = ensureChannel({
        accountId: account.id,
        name: "default",
        displayName: "Terminal UI",
        icon: "terminal",
        settings: { mode: "default" },
      });
      return { account, channel, resolution: "default" };
    }
    case "background": {
      const account = ensureChannelAccount({
        type: "background",
        name: "background",
        metadata: { provider: "background" },
      });
      const channel = ensureChannel({
        accountId: account.id,
        name: "default",
        displayName: "Background",
        icon: "cpu",
        settings: { mode: "background" },
      });
      return { account, channel, resolution: "default" };
    }
  }
}

export function listChannelAccounts(options?: {
  type?: ChannelAccountType;
  includeDeleted?: boolean;
}): ChannelAccountRecord[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];
  if (options?.type) {
    conditions.push("type = ?");
    params.push(options.type);
  }
  if (!options?.includeDeleted) {
    conditions.push("deleted_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb().prepare(`
    SELECT id, type, name, metadata, created_at, updated_at, deleted_at
    FROM channel_accounts
    ${where}
    ORDER BY updated_at DESC, id DESC
  `).all(...params) as Array<{
    id: number;
    type: string;
    name: string;
    metadata: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;

  return rows.map(asChannelAccountRecord);
}

export function getChannelAccount(accountId: number, options?: {
  includeDeleted?: boolean;
}): ChannelAccountRecord | undefined {
  return getChannelAccountRow(accountId, options?.includeDeleted ?? false);
}

export function createChannelAccount(input: {
  type: ChannelAccountType;
  name: string;
  metadata?: Record<string, unknown> | null;
}): ChannelAccountRecord {
  return ensureChannelAccount(input);
}

export function updateChannelAccount(accountId: number, input: {
  name?: string;
  metadata?: Record<string, unknown> | null;
}): ChannelAccountRecord {
  const current = getChannelAccountRow(accountId, false);
  if (!current) {
    throw new Error(`Channel account '${accountId}' was not found`);
  }

  const assignments: string[] = [];
  const values: Array<string | null> = [];

  if (input.name !== undefined) {
    assignments.push("name = ?");
    values.push(normalizeRequiredText(input.name, "Channel account name"));
  }
  if (input.metadata !== undefined) {
    assignments.push("metadata = ?");
    values.push(stringifyStoredObject(input.metadata));
  }
  if (assignments.length === 0) {
    return current;
  }

  assignments.push("updated_at = CURRENT_TIMESTAMP");
  getDb().prepare(`
    UPDATE channel_accounts
    SET ${assignments.join(", ")}
    WHERE id = ? AND deleted_at IS NULL
  `).run(...values, accountId);

  const updated = getChannelAccountRow(accountId, false);
  if (!updated) {
    throw new Error(`Channel account '${accountId}' was not found after update`);
  }
  return updated;
}

export function deleteChannelAccount(accountId: number): boolean {
  const db = getDb();
  const tx = db.transaction((targetId: number) => {
    const existing = db.prepare(`
      SELECT id
      FROM channel_accounts
      WHERE id = ? AND deleted_at IS NULL
    `).get(targetId) as { id: number } | undefined;

    if (!existing) {
      return false;
    }

    db.prepare(`
      UPDATE channels
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE account_id = ? AND deleted_at IS NULL
    `).run(targetId);

    db.prepare(`
      UPDATE channel_accounts
      SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND deleted_at IS NULL
    `).run(targetId);

    return true;
  });

  return tx(accountId);
}

export function listChannels(options?: {
  accountId?: number;
  includeDeleted?: boolean;
}): ChannelRecord[] {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (options?.accountId !== undefined) {
    conditions.push("c.account_id = ?");
    params.push(options.accountId);
  }
  if (!options?.includeDeleted) {
    conditions.push("c.deleted_at IS NULL");
    conditions.push("a.deleted_at IS NULL");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = getDb().prepare(`
    SELECT
      c.id,
      c.account_id,
      a.type AS account_type,
      a.name AS account_name,
      c.name,
      c.display_name,
      c.icon,
      c.settings,
      c.created_at,
      c.updated_at,
      c.deleted_at
    FROM channels c
    JOIN channel_accounts a ON a.id = c.account_id
    ${where}
    ORDER BY c.updated_at DESC, c.id DESC
  `).all(...params) as Array<{
    id: number;
    account_id: number;
    account_type: string;
    account_name: string;
    name: string;
    display_name: string | null;
    icon: string | null;
    settings: string | null;
    created_at: string;
    updated_at: string;
    deleted_at: string | null;
  }>;

  return rows.map(asChannelRecord);
}

export function getChannel(channelId: number, options?: {
  includeDeleted?: boolean;
}): ChannelRecord | undefined {
  return getChannelRow(channelId, options?.includeDeleted ?? false);
}

export function createChannel(input: {
  accountId: number;
  name: string;
  displayName?: string | null;
  icon?: string | null;
  settings?: Record<string, unknown> | null;
}): ChannelRecord {
  const account = getChannelAccountRow(input.accountId, false);
  if (!account) {
    throw new Error(`Channel account '${input.accountId}' was not found`);
  }

  return ensureChannel({
    accountId: account.id,
    name: input.name,
    displayName: input.displayName,
    icon: input.icon,
    settings: input.settings,
  });
}

export function updateChannel(channelId: number, input: {
  name?: string;
  displayName?: string | null;
  icon?: string | null;
  settings?: Record<string, unknown> | null;
}): ChannelRecord {
  const current = getChannelRow(channelId, false);
  if (!current) {
    throw new Error(`Channel '${channelId}' was not found`);
  }

  const assignments: string[] = [];
  const values: Array<string | null> = [];

  if (input.name !== undefined) {
    assignments.push("name = ?");
    values.push(normalizeRequiredText(input.name, "Channel name"));
  }
  if (input.displayName !== undefined) {
    assignments.push("display_name = ?");
    values.push(input.displayName?.trim() || null);
  }
  if (input.icon !== undefined) {
    assignments.push("icon = ?");
    values.push(input.icon?.trim() || null);
  }
  if (input.settings !== undefined) {
    assignments.push("settings = ?");
    values.push(stringifyStoredObject(input.settings));
  }
  if (assignments.length === 0) {
    return current;
  }

  assignments.push("updated_at = CURRENT_TIMESTAMP");
  getDb().prepare(`
    UPDATE channels
    SET ${assignments.join(", ")}
    WHERE id = ? AND deleted_at IS NULL
  `).run(...values, channelId);

  const updated = getChannelRow(channelId, false);
  if (!updated) {
    throw new Error(`Channel '${channelId}' was not found after update`);
  }
  return updated;
}

export function deleteChannel(channelId: number): boolean {
  const result = getDb().prepare(`
    UPDATE channels
    SET deleted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND deleted_at IS NULL
  `).run(channelId);

  return result.changes > 0;
}

export function resolveMessageSourceChannel(source: MessageChannelSource): MessageChannelResolution {
  if (source.channelId !== undefined) {
    const explicitChannel = getChannelRow(source.channelId, false);
    if (explicitChannel) {
      const account = getChannelAccountRow(explicitChannel.accountId, false);
      if (account) {
        return {
          account,
          channel: explicitChannel,
          resolution: "explicit",
        };
      }
    }
  }

  const hintedChannel = typeof source.routeHint === "string"
    ? findChannelByRouteHint(source.type, source.routeHint)
    : undefined;
  if (hintedChannel) {
    const account = getChannelAccountRow(hintedChannel.accountId, false);
    if (account) {
      return {
        account,
        channel: hintedChannel,
        resolution: "route-hint",
      };
    }
  }

  return getDefaultMessageChannel(source);
}

export function resolveMessageChannelAccess(source: MessageChannelSource): MessageChannelAccessDecision {
  const resolution = resolveMessageSourceChannel(source);
  const policy = getEffectiveChannelPolicy(resolution.channel);
  const identities = getSourceAllowlistIdentities(source);

  if (policy.allowlistMode === "open") {
    return {
      resolution,
      policy,
      identities,
      allowed: true,
    };
  }

  const allowed = identities.some((identity) => policy.allowlist.includes(identity));
  if (allowed) {
    return {
      resolution,
      policy,
      identities,
      allowed: true,
    };
  }

  const channelLabel = resolution.channel.displayName ?? resolution.channel.name;
  return {
    resolution,
    policy,
    identities,
    allowed: false,
    denialReason: `Channel '${channelLabel}' is allowlist-only. Provided identities: ${identities.join(", ")}`,
  };
}

export function listChannelInbox(
  channelId: number,
  options?: {
    limit?: number;
    beforeId?: number;
  }
): InboxMessageRecord[] {
  const requestedLimit = options?.limit;
  const safeLimit = typeof requestedLimit === "number" && Number.isInteger(requestedLimit) && requestedLimit > 0
    ? Math.min(requestedLimit, 500)
    : 100;
  const rows = getDb().prepare(`
    SELECT
      i.id,
      i.channel_id,
      i.direction,
      i.role,
      i.content,
      i.metadata,
      i.created_at,
      c.name AS channel_name,
      c.display_name AS channel_display_name,
      c.icon AS channel_icon,
      a.id AS account_id,
      a.type AS account_type,
      a.name AS account_name
    FROM inbox_messages i
    JOIN channels c ON c.id = i.channel_id
    JOIN channel_accounts a ON a.id = c.account_id
    WHERE i.channel_id = ?
      AND (? IS NULL OR i.id < ?)
    ORDER BY i.id DESC
    LIMIT ?
  `).all(channelId, options?.beforeId ?? null, options?.beforeId ?? null, safeLimit) as Array<{
    id: number;
    channel_id: number;
    direction: InboxMessageDirection;
    role: "user" | "assistant" | "system";
    content: string;
    metadata: string | null;
    created_at: string;
    channel_name: string;
    channel_display_name: string | null;
    channel_icon: string | null;
    account_id: number;
    account_type: string;
    account_name: string;
  }>;

  return rows.reverse().map(asInboxMessageRecord);
}

export function createInboxMessage(input: {
  channelId: number;
  direction: InboxMessageDirection;
  role: "user" | "assistant" | "system";
  content: string;
  metadata?: Record<string, unknown> | null;
}): InboxMessageRecord {
  const channel = getChannelRow(input.channelId, true);
  if (!channel) {
    throw new Error(`Channel '${input.channelId}' was not found`);
  }

  const normalizedContent = input.content.trim();
  if (!normalizedContent) {
    throw new Error("Inbox message content is required");
  }

  const db = getDb();
  const result = db.prepare(`
    INSERT INTO inbox_messages (channel_id, direction, role, content, metadata)
    VALUES (?, ?, ?, ?, ?)
  `).run(
    input.channelId,
    input.direction,
    input.role,
    normalizedContent,
    stringifyStoredObject(input.metadata),
  );

  const row = db.prepare(`
    SELECT
      i.id,
      i.channel_id,
      i.direction,
      i.role,
      i.content,
      i.metadata,
      i.created_at,
      c.name AS channel_name,
      c.display_name AS channel_display_name,
      c.icon AS channel_icon,
      a.id AS account_id,
      a.type AS account_type,
      a.name AS account_name
    FROM inbox_messages i
    JOIN channels c ON c.id = i.channel_id
    JOIN channel_accounts a ON a.id = c.account_id
    WHERE i.id = ?
  `).get(Number(result.lastInsertRowid)) as {
    id: number;
    channel_id: number;
    direction: InboxMessageDirection;
    role: "user" | "assistant" | "system";
    content: string;
    metadata: string | null;
    created_at: string;
    channel_name: string;
    channel_display_name: string | null;
    channel_icon: string | null;
    account_id: number;
    account_type: string;
    account_name: string;
  } | undefined;

  if (!row) {
    throw new Error("Could not load newly created inbox message");
  }

  return asInboxMessageRecord(row);
}

export function setState(key: string, value: string): void {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO max_state (key, value) VALUES (?, ?)`).run(key, value);
}

/** Remove a key from persistent state. */
export function deleteState(key: string): void {
  const db = getDb();
  db.prepare(`DELETE FROM max_state WHERE key = ?`).run(key);
}

/** Log a conversation turn (user, assistant, or system). */
export function logConversation(role: "user" | "assistant" | "system", content: string, source: string): void {
  const db = getDb();
  db.prepare(`INSERT INTO conversation_log (role, content, source) VALUES (?, ?, ?)`).run(role, content, source);
  // Keep last 200 entries to support context recovery after session loss
  logInsertCount++;
  if (logInsertCount % 50 === 0) {
    db.prepare(`DELETE FROM conversation_log WHERE id NOT IN (SELECT id FROM conversation_log ORDER BY id DESC LIMIT 200)`).run();
  }
}

/** Get recent conversation history formatted for injection into system message. */
export function getRecentConversation(limit = 20): string {
  const db = getDb();
  const rows = db.prepare(
    `SELECT role, content, source, ts FROM conversation_log ORDER BY id DESC LIMIT ?`
  ).all(limit) as { role: string; content: string; source: string; ts: string }[];

  if (rows.length === 0) return "";

  // Reverse so oldest is first (chronological order)
  rows.reverse();

  return rows.map((r) => {
    const tag = r.role === "user" ? `[${r.source}] User`
      : r.role === "system" ? `[${r.source}] System`
      : "Max";
    // Truncate long messages to keep context manageable
    const content = r.content.length > 500 ? r.content.slice(0, 500) + "…" : r.content;
    return `${tag}: ${content}`;
  }).join("\n\n");
}

/** Add a memory to long-term storage. */
export function addMemory(
  category: "preference" | "fact" | "project" | "person" | "routine",
  content: string,
  source: "user" | "auto" = "user"
): number {
  const db = getDb();
  const result = db.prepare(
    `INSERT INTO memories (category, content, source) VALUES (?, ?, ?)`
  ).run(category, content, source);
  return result.lastInsertRowid as number;
}

/** Search memories by keyword and/or category. */
export function searchMemories(
  keyword?: string,
  category?: string,
  limit = 20
): { id: number; category: string; content: string; source: string; created_at: string }[] {
  const db = getDb();
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (keyword) {
    conditions.push(`content LIKE ?`);
    params.push(`%${keyword}%`);
  }
  if (category) {
    conditions.push(`category = ?`);
    params.push(category);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  params.push(limit);

  const rows = db.prepare(
    `SELECT id, category, content, source, created_at FROM memories ${where} ORDER BY last_accessed DESC LIMIT ?`
  ).all(...params) as { id: number; category: string; content: string; source: string; created_at: string }[];

  // Update last_accessed for returned memories
  if (rows.length > 0) {
    const placeholders = rows.map(() => "?").join(",");
    db.prepare(`UPDATE memories SET last_accessed = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...rows.map((r) => r.id));
  }

  return rows;
}

/** Remove a memory by ID. */
export function removeMemory(id: number): boolean {
  const db = getDb();
  const result = db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
  return result.changes > 0;
}

/** Get a compact summary of all memories for injection into system message. */
export function getMemorySummary(): string {
  const db = getDb();
  const rows = db.prepare(
    `SELECT id, category, content FROM memories ORDER BY category, last_accessed DESC`
  ).all() as { id: number; category: string; content: string }[];

  if (rows.length === 0) return "";

  // Group by category
  const grouped: Record<string, { id: number; content: string }[]> = {};
  for (const r of rows) {
    if (!grouped[r.category]) grouped[r.category] = [];
    grouped[r.category].push({ id: r.id, content: r.content });
  }

  const sections = Object.entries(grouped).map(([cat, items]) => {
    const lines = items.map((i) => `  - [#${i.id}] ${i.content}`).join("\n");
    return `**${cat}**:\n${lines}`;
  });

  return sections.join("\n");
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = undefined;
  }
}
