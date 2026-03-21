"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchAgentChatState,
  fetchAgents,
  sendAgentChatMessage,
  type AgentChatMessage,
  type AgentRecord,
} from "@/lib/api";

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function inputClassName() {
  return "w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]";
}

function cardClassName() {
  return "rounded-xl bg-[var(--bg-card)] border border-[var(--border)]";
}

function MessageBubble({ message }: { message: AgentChatMessage }) {
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

export default function AgentChatPage() {
  const [initialAgentId, setInitialAgentId] = useState("");
  const [agents, setAgents] = useState<AgentRecord[]>([]);
  const [selectedAgentId, setSelectedAgentId] = useState("");
  const [messages, setMessages] = useState<AgentChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement | null>(null);

  const selectedAgent = useMemo(
    () => agents.find((agent) => String(agent.id) === selectedAgentId) ?? null,
    [agents, selectedAgentId]
  );

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const agentId = new URLSearchParams(window.location.search).get("agentId") ?? "";
    setInitialAgentId(agentId);
    setSelectedAgentId((prev) => prev || agentId);
  }, []);

  const loadChat = useCallback(async (agentId: string) => {
    if (!agentId) {
      setMessages([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const data = await fetchAgentChatState(Number(agentId));
      setMessages(data.history);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load agent chat");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAgents().catch((err) => {
      setError(err instanceof Error ? err.message : "Failed to load agents");
      setLoading(false);
    });
  }, [loadAgents]);

  useEffect(() => {
    void loadChat(selectedAgentId);
  }, [loadChat, selectedAgentId]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function sendMessage() {
    if (!selectedAgent || !draft.trim()) return;
    setSending(true);
    try {
      const data = await sendAgentChatMessage(selectedAgent.id, draft.trim());
      setMessages(data.history);
      setDraft("");
      setError(null);
      await loadAgents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold">Agent Chat</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            Use your dedicated control-plane agents directly from the dashboard with their own persisted Copilot sessions.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => selectedAgentId && void loadChat(selectedAgentId)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            Refresh chat
          </button>
          <Link
            href="/control"
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--accent)]"
          >
            Back to Control Plane
          </Link>
        </div>
      </div>

      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <div className={`${cardClassName()} p-6 space-y-3`}>
          <p className="text-sm text-[var(--text-muted)]">
            No dedicated agents exist yet. Create one first from the control plane, then come back here to chat with it.
          </p>
          <Link
            href="/control"
            className="inline-flex px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90"
          >
            Create your first agent
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)] gap-6">
          <section className={cardClassName()}>
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--text-muted)]">Agent selector</h3>
            </div>
            <div className="p-4 space-y-4">
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
            </div>
          </section>

          <section className={`${cardClassName()} min-h-[640px] flex flex-col`}>
            <div className="px-4 py-3 border-b border-[var(--border)]">
              <h3 className="text-sm font-medium text-[var(--text-muted)]">
                {selectedAgent ? `${selectedAgent.name} conversation` : "Conversation"}
              </h3>
            </div>

            <div className="flex-1 p-4 space-y-3 overflow-y-auto">
              {loading ? (
                <p className="text-sm text-[var(--text-muted)] animate-pulse">Loading conversation…</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)]">
                  No messages yet. Send the first prompt to bootstrap this dedicated agent session.
                </p>
              ) : (
                messages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
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
                placeholder={selectedAgent ? `Message ${selectedAgent.name}…` : "Select an agent first"}
                disabled={!selectedAgent || sending}
              />
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-[var(--text-muted)]">
                  Press Enter to send, Shift+Enter for a new line.
                </p>
                <button
                  onClick={() => void sendMessage()}
                  disabled={!selectedAgent || sending || !draft.trim()}
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
