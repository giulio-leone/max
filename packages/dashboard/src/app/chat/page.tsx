"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createAgentMemory,
  createNativeSessionMemory,
  deleteAgentMemory,
  deleteNativeSessionMemory,
  fetchAgentChatState,
  fetchAgentMemories,
  fetchAgents,
  fetchNativeSessionChatState,
  fetchNativeSessionMemories,
  fetchWorkers,
  sendAgentChatMessage,
  sendNativeSessionChatMessage,
  type AgentChatMessage,
  type AgentRecord,
  type NativeSessionChatMessage,
  type ScopedMemoryRecord,
  type Worker,
} from "@/lib/api";

type ChatMode = "agent" | "native";
type ChatMessage = AgentChatMessage | NativeSessionChatMessage;
type MemoryCategory = ScopedMemoryRecord["category"];

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function inputClassName() {
  return "w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]";
}

function cardClassName() {
  return "rounded-xl bg-[var(--bg-card)] border border-[var(--border)]";
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const palette = message.role === "assistant"
    ? "bg-[rgba(59,130,246,0.14)] border-[rgba(59,130,246,0.35)]"
    : message.role === "system"
      ? "bg-[rgba(168,85,247,0.14)] border-[rgba(168,85,247,0.35)]"
      : "bg-[var(--bg)] border-[var(--border)]";

  return (
    <div className={`rounded-xl border p-3 ${palette}`}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs font-medium uppercase tracking-wide text-[var(--text-muted)]">
          {message.role}
        </span>
        <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(message.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{message.content}</p>
    </div>
  );
}

export default function OperatorChatPage() {
  const [initialAgentId, setInitialAgentId] = useState("");
  const [initialSessionName, setInitialSessionName] = useState("");
  const [chatMode, setChatMode] = useState<ChatMode>("agent");

  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [nativeSessions, setNativeSessions] = useState<Worker[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [selectedSessionName, setSelectedSessionName] = useState("");

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [memories, setMemories] = useState<ScopedMemoryRecord[]>([]);
  const [draft, setDraft] = useState("");
  const [memoryDraft, setMemoryDraft] = useState("");
  const [memoryCategory, setMemoryCategory] = useState<MemoryCategory>("project");

  const [loading, setLoading] = useState(true);
  const [memoryLoading, setMemoryLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [savingMemory, setSavingMemory] = useState(false);
  const [deletingMemoryId, setDeletingMemoryId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [memoryError, setMemoryError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => String(agent.id) === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );
  const selectedSession = useMemo(
    () => nativeSessions.find((worker) => worker.name === selectedSessionName) ?? null,
    [nativeSessions, selectedSessionName]
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const mode = params.get("mode") === "native" ? "native" : "agent";
    const agentId = params.get("agentId") ?? "";
    const sessionName = params.get("sessionName") ?? "";

    setInitialAgentId(agentId);
    setInitialSessionName(sessionName);
    setChatMode(mode);
    setSelectedAgentId((prev) => prev || agentId);
    setSelectedSessionName((prev) => prev || sessionName);
  }, []);

  const loadAgents = useCallback(async () => {
    const data = await fetchAgents();
    setAgents(data);
    setSelectedAgentId((prev) => {
      if (prev && data.some((agent) => String(agent.id) === prev)) {
        return prev;
      }
      if (initialAgentId && data.some((agent) => String(agent.id) === initialAgentId)) {
        return initialAgentId;
      }
      return data[0] ? String(data[0].id) : "";
    });
    return data;
  }, [initialAgentId]);

  const loadNativeSessions = useCallback(async () => {
    const workers = await fetchWorkers();
    const sessions = workers.filter((worker) => worker.sessionSource === "machine");
    setNativeSessions(sessions);
    setSelectedSessionName((prev) => {
      if (prev && sessions.some((worker) => worker.name === prev)) {
        return prev;
      }
      if (initialSessionName && sessions.some((worker) => worker.name === initialSessionName)) {
        return initialSessionName;
      }
      return sessions[0]?.name ?? "";
    });
    return sessions;
  }, [initialSessionName]);

  useEffect(() => {
    void Promise.all([loadAgents(), loadNativeSessions()]).catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load chat targets");
      setLoading(false);
    });
  }, [loadAgents, loadNativeSessions]);

  const loadCurrentConversation = useCallback(async () => {
    setLoading(true);
    try {
      if (chatMode === "agent") {
        if (!selectedAgentId) {
          setMessages([]);
          setError(null);
          return;
        }
        const data = await fetchAgentChatState(Number(selectedAgentId));
        setMessages(data.history);
      } else {
        if (!selectedSessionName) {
          setMessages([]);
          setError(null);
          return;
        }
        const data = await fetchNativeSessionChatState(selectedSessionName);
        setMessages(data.history);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load conversation");
    } finally {
      setLoading(false);
    }
  }, [chatMode, selectedAgentId, selectedSessionName]);

  const loadMemories = useCallback(async () => {
    setMemoryLoading(true);
    try {
      if (chatMode === "agent") {
        if (!selectedAgentId) {
          setMemories([]);
          setMemoryError(null);
          return;
        }
        setMemories(await fetchAgentMemories(Number(selectedAgentId)));
      } else {
        if (!selectedSessionName) {
          setMemories([]);
          setMemoryError(null);
          return;
        }
        setMemories(await fetchNativeSessionMemories(selectedSessionName));
      }
      setMemoryError(null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to load scoped memories");
    } finally {
      setMemoryLoading(false);
    }
  }, [chatMode, selectedAgentId, selectedSessionName]);

  useEffect(() => {
    void loadCurrentConversation();
  }, [loadCurrentConversation]);

  useEffect(() => {
    void loadMemories();
  }, [loadMemories]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!draft.trim()) return;
    setSending(true);
    try {
      if (chatMode === "agent") {
        if (!selectedAgent) return;
        const data = await sendAgentChatMessage(selectedAgent.id, draft.trim());
        setMessages(data.history);
        await loadAgents();
      } else {
        if (!selectedSession) return;
        const data = await sendNativeSessionChatMessage(selectedSession.name, draft.trim());
        setMessages(data.history);
        await loadNativeSessions();
      }
      setDraft("");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  async function saveMemory() {
    if (!memoryDraft.trim()) return;
    setSavingMemory(true);
    try {
      if (chatMode === "agent") {
        if (!selectedAgent) return;
        await createAgentMemory(selectedAgent.id, {
          category: memoryCategory,
          content: memoryDraft.trim(),
        });
      } else {
        if (!selectedSession) return;
        await createNativeSessionMemory(selectedSession.name, {
          category: memoryCategory,
          content: memoryDraft.trim(),
        });
      }
      setMemoryDraft("");
      await loadMemories();
      setMemoryError(null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to save scoped memory");
    } finally {
      setSavingMemory(false);
    }
  }

  async function removeMemory(memoryId: number) {
    setDeletingMemoryId(memoryId);
    try {
      if (chatMode === "agent") {
        if (!selectedAgent) return;
        await deleteAgentMemory(selectedAgent.id, memoryId);
      } else {
        if (!selectedSession) return;
        await deleteNativeSessionMemory(selectedSession.name, memoryId);
      }
      await loadMemories();
      setMemoryError(null);
    } catch (err) {
      setMemoryError(err instanceof Error ? err.message : "Failed to delete scoped memory");
    } finally {
      setDeletingMemoryId(null);
    }
  }

  const hasTargets = chatMode === "agent" ? agents.length > 0 : nativeSessions.length > 0;
  const conversationTitle = chatMode === "agent"
    ? (selectedAgent ? `${selectedAgent.name} conversation` : "Agent conversation")
    : (selectedSession ? `${selectedSession.name} conversation` : "Native session conversation");
  const memoryHint = chatMode === "agent"
    ? "Agent memories are injected into the dedicated system prompt on the next agent turn."
    : "Session memories are prepended to future manual chat prompts for this attached native session.";

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Operator Chat</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Chat with dedicated control-plane agents or directly with attached native Copilot sessions from one place.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadCurrentConversation()}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            Refresh chat
          </button>
          <Link
            href={chatMode === "native" ? "/workers" : "/control"}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent)]"
          >
            {chatMode === "native" ? "Back to Workers" : "Back to Control Plane"}
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {!hasTargets ? (
        <div className={`${cardClassName()} p-6 space-y-4`}>
          <label className="block space-y-1.5 max-w-sm">
            <span className="text-xs font-medium text-[var(--text-muted)]">Chat target type</span>
            <select
              className={inputClassName()}
              value={chatMode}
              onChange={(event) => setChatMode(event.target.value as ChatMode)}
            >
              <option value="agent">Dedicated agents</option>
              <option value="native">Native sessions</option>
            </select>
          </label>
          <p className="text-sm text-[var(--text-muted)]">
            {chatMode === "agent"
              ? "No dedicated agents exist yet. Create one first from the control plane, then come back here to chat with it."
              : "No attached native sessions exist yet. Attach one from the workers page, then come back here to chat with it."}
          </p>
          <Link
            href={chatMode === "agent" ? "/control" : "/workers"}
            className="inline-flex px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            {chatMode === "agent" ? "Create your first agent" : "Attach a native session"}
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[360px_minmax(0,1fr)] gap-6">
          <section className={cardClassName()}>
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--text-muted)]">Chat target</h3>
            </div>
            <div className="p-4 space-y-4">
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">Target type</span>
                <select
                  className={inputClassName()}
                  value={chatMode}
                  onChange={(event) => setChatMode(event.target.value as ChatMode)}
                >
                  <option value="agent">Dedicated agents</option>
                  <option value="native">Native sessions</option>
                </select>
              </label>

              {chatMode === "agent" ? (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Dedicated agent</span>
                    <select
                      className={inputClassName()}
                      value={selectedAgentId}
                      onChange={(event) => setSelectedAgentId(event.target.value)}
                    >
                      {agents.map((agent) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} · {agent.projectName}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedAgent && (
                    <div className="space-y-3 text-sm">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="font-medium">{selectedAgent.name}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1">
                          {selectedAgent.projectName} · {selectedAgent.agentType}
                        </p>
                      </div>
                      <Detail label="Model" value={selectedAgent.model ?? "Max default"} />
                      <Detail label="Status" value={selectedAgent.status} />
                      <Detail label="Working dir" value={selectedAgent.workingDir ?? "Not set"} mono />
                      <Detail label="Last heartbeat" value={selectedAgent.lastHeartbeatAt ? formatTimestamp(selectedAgent.lastHeartbeatAt) : "—"} />
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-medium text-[var(--text-muted)]">Default prompt</p>
                        <p className="text-sm mt-2 whitespace-pre-wrap text-[var(--text-muted)]">
                          {selectedAgent.defaultPrompt ?? "No default prompt configured."}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Attached native session</span>
                    <select
                      className={inputClassName()}
                      value={selectedSessionName}
                      onChange={(event) => setSelectedSessionName(event.target.value)}
                    >
                      {nativeSessions.map((session) => (
                        <option key={session.name} value={session.name}>
                          {session.name} · {session.workspaceLabel || session.workingDir}
                        </option>
                      ))}
                    </select>
                  </label>

                  {selectedSession && (
                    <div className="space-y-3 text-sm">
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="font-medium font-mono break-all">{selectedSession.name}</p>
                        <p className="text-xs text-[var(--text-muted)] mt-1 break-all">
                          {selectedSession.workingDir}
                        </p>
                      </div>
                      <Detail label="Status" value={selectedSession.status} />
                      <Detail label="Copilot session" value={selectedSession.copilotSessionId ?? "Unknown"} mono />
                      <Detail label="Workspace label" value={selectedSession.workspaceLabel ?? "—"} />
                      <Detail label="Activation mode" value={selectedSession.activationMode ?? "manual"} />
                      <Detail label="Origin channel" value={selectedSession.originChannel ?? "—"} />
                      <Detail label="Routing hint" value={selectedSession.routingHint ?? "—"} />
                      <Detail label="Queue hint" value={selectedSession.queueHint ?? "—"} />
                      {selectedSession.originChannel && (
                        <Link
                          href={`/channels?accountType=${encodeURIComponent(selectedSession.originChannel)}`}
                          className="inline-flex items-center justify-center rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-medium text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
                        >
                          View {selectedSession.originChannel} channels
                        </Link>
                      )}
                      <div className="rounded-lg border border-[var(--border)] p-3">
                        <p className="text-xs font-medium text-[var(--text-muted)]">Latest output</p>
                        <p className="text-sm mt-2 whitespace-pre-wrap text-[var(--text-muted)]">
                          {selectedSession.lastOutput ?? "No output recorded yet."}
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                <div>
                  <h4 className="text-sm font-medium">Scoped memory</h4>
                  <p className="text-xs text-[var(--text-muted)] mt-1">{memoryHint}</p>
                </div>

                {memoryError && (
                  <div className="rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.35)] px-3 py-2 text-xs text-[var(--danger)]">
                    {memoryError}
                  </div>
                )}

                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--text-muted)]">Category</span>
                  <select
                    className={inputClassName()}
                    value={memoryCategory}
                    onChange={(event) => setMemoryCategory(event.target.value as MemoryCategory)}
                  >
                    <option value="project">project</option>
                    <option value="preference">preference</option>
                    <option value="fact">fact</option>
                    <option value="person">person</option>
                    <option value="routine">routine</option>
                  </select>
                </label>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--text-muted)]">Memory entry</span>
                  <textarea
                    className={`${inputClassName()} min-h-24`}
                    value={memoryDraft}
                    onChange={(event) => setMemoryDraft(event.target.value)}
                    placeholder={chatMode === "agent"
                      ? "Remember something only for this agent…"
                      : "Remember something only for this attached session…"}
                  />
                </label>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                  onClick={() => void saveMemory()}
                  disabled={savingMemory || !memoryDraft.trim()}
                >
                  {savingMemory ? "Saving…" : "Save memory"}
                </button>

                <div className="space-y-2">
                  {memoryLoading ? (
                    <p className="text-xs text-[var(--text-muted)] animate-pulse">Loading scoped memories…</p>
                  ) : memories.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]">
                      No scoped memories yet for this {chatMode === "agent" ? "agent" : "session"}.
                    </p>
                  ) : (
                    memories.map((memory) => (
                      <div key={memory.id} className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3">
                        <div className="flex items-center justify-between gap-3">
                          <span className="text-[11px] uppercase tracking-wide text-[var(--text-muted)]">
                            {memory.category}
                          </span>
                          <button
                            type="button"
                            className="text-xs text-[var(--danger)] hover:underline disabled:opacity-50"
                            disabled={deletingMemoryId === memory.id}
                            onClick={() => void removeMemory(memory.id)}
                          >
                            {deletingMemoryId === memory.id ? "Deleting…" : "Delete"}
                          </button>
                        </div>
                        <p className="mt-2 text-sm whitespace-pre-wrap">{memory.content}</p>
                        <p className="mt-2 text-[11px] text-[var(--text-muted)]">
                          {memory.source} · {formatTimestamp(memory.createdAt)}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className={`${cardClassName()} min-h-[640px] flex flex-col`}>
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--text-muted)]">{conversationTitle}</h3>
            </div>

            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              {loading ? (
                <p className="text-sm text-[var(--text-muted)] animate-pulse">Loading conversation…</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  {chatMode === "agent"
                    ? "No messages yet. Send the first prompt to bootstrap this dedicated agent session."
                    : "No messages yet. Send the first prompt to use this attached native Copilot session interactively."}
                </p>
              ) : (
                messages.map((message) => (
                  <MessageBubble key={`${message.role}-${message.id}`} message={message} />
                ))
              )}
              <div ref={endRef} />
            </div>

            <div className="p-4 border-t border-[var(--border)] space-y-3">
              <textarea
                className={`${inputClassName()} min-h-28`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void sendMessage();
                  }
                }}
                placeholder={
                  chatMode === "agent"
                    ? (selectedAgent ? `Message ${selectedAgent.name}…` : "Select an agent first")
                    : (selectedSession ? `Message ${selectedSession.name}…` : "Select a native session first")
                }
                disabled={(!selectedAgent && chatMode === "agent") || (!selectedSession && chatMode === "native") || sending}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-muted)]">
                  Press Enter to send, Shift+Enter for a new line.
                </p>
                <button
                  onClick={() => void sendMessage()}
                  disabled={((!selectedAgent && chatMode === "agent") || (!selectedSession && chatMode === "native")) || sending || !draft.trim()}
                  className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-50"
                >
                  {sending ? "Sending..." : "Send"}
                </button>
              </div>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-[var(--border)] p-3">
      <p className="text-xs font-medium text-[var(--text-muted)]">{label}</p>
      <p className={`mt-2 text-sm ${mono ? "font-mono break-all" : ""}`}>{value}</p>
    </div>
  );
}
