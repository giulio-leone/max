"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  attachNativeSession,
  detachNativeSession,
  discoverNativeSessions,
  previewNativeSessionRoute,
  updateNativeSessionMetadata,
  type NativeMachineSession,
  type Worker,
} from "@/lib/api";

interface NativeSessionsPanelProps {
  workers: Worker[];
  onWorkersChanged: () => Promise<void>;
}

type ActivationMode = "manual" | "suggested" | "pinned";

function cardClassName() {
  return "rounded-xl bg-[var(--bg-card)] border border-[var(--border)]";
}

function inputClassName() {
  return "w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]";
}

function selectClassName() {
  return `${inputClassName()} pr-10`;
}

function buttonClassName(kind: "primary" | "secondary" | "danger" = "secondary") {
  if (kind === "primary") {
    return "px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity";
  }
  if (kind === "danger") {
    return "px-4 py-2 rounded-lg text-sm font-medium border border-[var(--danger)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.08)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
  }
  return "px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
}

function formatUpdatedAt(value: string) {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

function suggestWorkerName(session: NativeMachineSession) {
  const lastPathSegment = session.workingDir.split(/[\\/]/).filter(Boolean).pop();
  const base = (lastPathSegment || session.summary || session.id)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base.length > 0 ? `machine-${base}` : `machine-${session.id.slice(0, 8)}`;
}

function toManagedForm(worker: Worker | null) {
  return {
    workspaceLabel: worker?.workspaceLabel ?? "",
    activationMode: worker?.activationMode ?? "manual" as ActivationMode,
    routingHint: worker?.routingHint ?? "",
    queueHint: worker?.queueHint ?? "",
  };
}

export function NativeSessionsPanel({ workers, onWorkersChanged }: NativeSessionsPanelProps) {
  const [cwdFilter, setCwdFilter] = useState("");
  const [discovered, setDiscovered] = useState<NativeMachineSession[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [attachName, setAttachName] = useState("");
  const [loadingDiscover, setLoadingDiscover] = useState(false);
  const [attaching, setAttaching] = useState(false);

  const [selectedManagedName, setSelectedManagedName] = useState<string | null>(null);
  const [managedForm, setManagedForm] = useState(() => toManagedForm(null));
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [detachingName, setDetachingName] = useState<string | null>(null);

  const [routeQuery, setRouteQuery] = useState({
    workspaceLabel: "",
    routingHint: "",
    queueHint: "",
  });
  const [routeResults, setRouteResults] = useState<Worker[]>([]);
  const [routingBusy, setRoutingBusy] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const managedMachineWorkers = useMemo(
    () => workers.filter((worker) => worker.sessionSource === "machine"),
    [workers]
  );

  const selectedSession = useMemo(
    () => discovered.find((session) => session.id === selectedSessionId) ?? null,
    [discovered, selectedSessionId]
  );

  const selectedManagedWorker = useMemo(
    () => managedMachineWorkers.find((worker) => worker.name === selectedManagedName) ?? null,
    [managedMachineWorkers, selectedManagedName]
  );

  useEffect(() => {
    if (managedMachineWorkers.length === 0) {
      setSelectedManagedName(null);
      setManagedForm(toManagedForm(null));
      return;
    }

    const selectedStillExists = selectedManagedName
      ? managedMachineWorkers.some((worker) => worker.name === selectedManagedName)
      : false;

    const nextSelectedName = selectedStillExists
      ? selectedManagedName
      : managedMachineWorkers[0].name;
    const nextSelectedWorker = managedMachineWorkers.find((worker) => worker.name === nextSelectedName) ?? null;
    setSelectedManagedName(nextSelectedName);
    setManagedForm(toManagedForm(nextSelectedWorker));
  }, [managedMachineWorkers, selectedManagedName]);

  async function handleDiscover() {
    setLoadingDiscover(true);
    try {
      const sessions = await discoverNativeSessions({
        cwdFilter: cwdFilter.trim() || undefined,
        limit: 50,
      });
      setDiscovered(sessions);
      setError(null);
      setNotice(sessions.length > 0 ? `Loaded ${sessions.length} native Copilot session(s).` : "No matching Copilot sessions found.");
      const nextSelected = sessions[0] ?? null;
      setSelectedSessionId(nextSelected?.id ?? null);
      setAttachName(nextSelected ? suggestWorkerName(nextSelected) : "");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to discover native sessions");
    } finally {
      setLoadingDiscover(false);
    }
  }

  function handleSelectSession(session: NativeMachineSession) {
    setSelectedSessionId(session.id);
    setAttachName(suggestWorkerName(session));
    setNotice(null);
    setError(null);
  }

  function handleSelectManagedWorker(worker: Worker) {
    setSelectedManagedName(worker.name);
    setManagedForm(toManagedForm(worker));
    setNotice(null);
    setError(null);
  }

  async function handleAttach() {
    if (!selectedSession) {
      setError("Choose a Copilot session to attach first.");
      return;
    }
    if (!attachName.trim()) {
      setError("Provide a worker name before attaching.");
      return;
    }

    setAttaching(true);
    try {
      const result = await attachNativeSession({
        sessionId: selectedSession.id,
        name: attachName.trim(),
      });
      await onWorkersChanged();
      setNotice(result.message);
      setError(null);
      setSelectedManagedName(result.worker.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to attach native session");
    } finally {
      setAttaching(false);
    }
  }

  async function handleDetach(name: string) {
    setDetachingName(name);
    try {
      const result = await detachNativeSession(name);
      await onWorkersChanged();
      setNotice(result.message);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to detach native session");
    } finally {
      setDetachingName(null);
    }
  }

  async function handleSaveMetadata() {
    if (!selectedManagedWorker) {
      setError("Choose an attached native session first.");
      return;
    }

    setSavingMetadata(true);
    try {
      const result = await updateNativeSessionMetadata(selectedManagedWorker.name, {
        workspaceLabel: managedForm.workspaceLabel.trim() || null,
        activationMode: managedForm.activationMode,
        routingHint: managedForm.routingHint.trim() || null,
        queueHint: managedForm.queueHint.trim() || null,
      });
      await onWorkersChanged();
      setNotice(result.message);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save session metadata");
    } finally {
      setSavingMetadata(false);
    }
  }

  async function handlePreviewRoute() {
    setRoutingBusy(true);
    try {
      const sessions = await previewNativeSessionRoute({
        workspaceLabel: routeQuery.workspaceLabel.trim() || undefined,
        routingHint: routeQuery.routingHint.trim() || undefined,
        queueHint: routeQuery.queueHint.trim() || undefined,
      });
      setRouteResults(sessions);
      setNotice(sessions.length > 0 ? `Routing preview returned ${sessions.length} candidate session(s).` : "No attached native sessions matched the routing preview.");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to preview routing");
    } finally {
      setRoutingBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className={`${cardClassName()} p-5 space-y-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Managed Native Sessions</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Native Copilot sessions attached into Max stay recoverable across daemon restarts and now carry routing metadata.
            </p>
          </div>
          <span className="text-xs px-2 py-1 rounded-full bg-[rgba(99,102,241,0.15)] text-[#a5b4fc] font-mono">
            {managedMachineWorkers.length} attached
          </span>
        </div>

        {error && (
          <div className="rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.35)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg bg-[rgba(59,130,246,0.12)] border border-[rgba(59,130,246,0.35)] px-3 py-2 text-sm text-[#93c5fd]">
            {notice}
          </div>
        )}

        <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)] gap-4">
          <div className="space-y-3">
            {managedMachineWorkers.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                No native Copilot sessions are attached yet.
              </div>
            ) : (
              managedMachineWorkers.map((worker) => {
                const isSelected = worker.name === selectedManagedName;
                return (
                  <div
                    key={worker.name}
                    className={`w-full text-left rounded-lg border p-4 transition-colors ${
                      isSelected
                        ? "border-[var(--accent)] bg-[rgba(59,130,246,0.08)]"
                        : "border-[var(--border)] hover:border-[var(--accent)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => handleSelectManagedWorker(worker)}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="font-mono text-sm truncate">{worker.name}</p>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.15)] text-[#a5b4fc]">
                            {worker.activationMode ?? "manual"}
                          </span>
                          {worker.originChannel && (
                            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.15)] text-[#86efac]">
                              via {worker.originChannel}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--text-muted)] truncate mt-1">{worker.workingDir}</p>
                        <p className="text-[11px] text-[var(--text-muted)] mt-1">
                          Workspace: {worker.workspaceLabel || "—"} · Route: {worker.routingHint || "—"} · Queue: {worker.queueHint || "—"}
                        </p>
                      </button>
                      <div className="flex flex-col items-end gap-2">
                        <a
                          href={`/chat?mode=native&sessionName=${encodeURIComponent(worker.name)}`}
                          className={`${buttonClassName("secondary")} inline-flex items-center justify-center`}
                        >
                          Open chat
                        </a>
                        {worker.originChannel ? (
                          <Link
                            href={`/channels?accountType=${encodeURIComponent(worker.originChannel)}`}
                            className={`${buttonClassName("secondary")} inline-flex items-center justify-center`}
                          >
                            View channels
                          </Link>
                        ) : null}
                        <button
                          type="button"
                          className={buttonClassName("danger")}
                          disabled={detachingName === worker.name}
                          onClick={() => void handleDetach(worker.name)}
                        >
                          {detachingName === worker.name ? "Detaching…" : "Detach"}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="space-y-4">
            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <div>
                <h4 className="text-sm font-medium">Session metadata</h4>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Use metadata to make routing decisions safer before Max exposes deeper agent-style session management.
                </p>
              </div>

              {selectedManagedWorker ? (
                <>
                  <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3 space-y-1">
                    <p className="text-xs font-mono break-all">{selectedManagedWorker.name}</p>
                    <p className="text-xs text-[var(--text-muted)] break-all">{selectedManagedWorker.workingDir}</p>
                  </div>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Workspace label</span>
                    <input
                      className={inputClassName()}
                      value={managedForm.workspaceLabel}
                      onChange={(event) => setManagedForm((current) => ({ ...current, workspaceLabel: event.target.value }))}
                      placeholder="max-core"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Activation mode</span>
                    <select
                      className={selectClassName()}
                      value={managedForm.activationMode}
                      onChange={(event) => setManagedForm((current) => ({
                        ...current,
                        activationMode: event.target.value as ActivationMode,
                      }))}
                    >
                      <option value="manual">manual</option>
                      <option value="suggested">suggested</option>
                      <option value="pinned">pinned</option>
                    </select>
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Routing hint</span>
                    <input
                      className={inputClassName()}
                      value={managedForm.routingHint}
                      onChange={(event) => setManagedForm((current) => ({ ...current, routingHint: event.target.value }))}
                      placeholder="frontend triage"
                    />
                  </label>
                  <label className="block space-y-1.5">
                    <span className="text-xs font-medium text-[var(--text-muted)]">Queue hint</span>
                    <input
                      className={inputClassName()}
                      value={managedForm.queueHint}
                      onChange={(event) => setManagedForm((current) => ({ ...current, queueHint: event.target.value }))}
                      placeholder="docs-review"
                    />
                  </label>
                  <button
                    type="button"
                    className={buttonClassName("primary")}
                    disabled={savingMetadata}
                    onClick={() => void handleSaveMetadata()}
                  >
                    {savingMetadata ? "Saving…" : "Save metadata"}
                  </button>
                </>
              ) : (
                <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                  Attach or select a native session to edit its metadata.
                </div>
              )}
            </div>

            <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
              <div>
                <h4 className="text-sm font-medium">Routing preview</h4>
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  Preview how Max would rank attached sessions for a workspace or hint combination.
                </p>
              </div>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">Workspace label or path</span>
                <input
                  className={inputClassName()}
                  value={routeQuery.workspaceLabel}
                  onChange={(event) => setRouteQuery((current) => ({ ...current, workspaceLabel: event.target.value }))}
                  placeholder="max-core"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">Routing hint</span>
                <input
                  className={inputClassName()}
                  value={routeQuery.routingHint}
                  onChange={(event) => setRouteQuery((current) => ({ ...current, routingHint: event.target.value }))}
                  placeholder="frontend triage"
                />
              </label>
              <label className="block space-y-1.5">
                <span className="text-xs font-medium text-[var(--text-muted)]">Queue hint</span>
                <input
                  className={inputClassName()}
                  value={routeQuery.queueHint}
                  onChange={(event) => setRouteQuery((current) => ({ ...current, queueHint: event.target.value }))}
                  placeholder="docs-review"
                />
              </label>
              <button
                type="button"
                className={buttonClassName("secondary")}
                disabled={routingBusy}
                onClick={() => void handlePreviewRoute()}
              >
                {routingBusy ? "Ranking…" : "Preview route"}
              </button>

              {routeResults.length > 0 && (
                <div className="space-y-2">
                  {routeResults.map((worker, index) => (
                    <div key={worker.name} className="rounded-lg bg-[var(--bg)] border border-[var(--border)] px-3 py-2">
                      <p className="text-sm font-mono">
                        #{index + 1} {worker.name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)] mt-1">
                        {worker.workspaceLabel || "—"} · {worker.activationMode || "manual"} · {worker.routingHint || "—"} · {worker.queueHint || "—"}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>

      <section className={`${cardClassName()} p-5 space-y-4`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-base font-semibold">Discover Copilot Sessions</h3>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Scan `~/.copilot/session-state` and attach a VS Code or terminal session into Max.
            </p>
          </div>
          <button
            type="button"
            className={buttonClassName("secondary")}
            disabled={loadingDiscover}
            onClick={() => void handleDiscover()}
          >
            {loadingDiscover ? "Scanning…" : "Discover"}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] gap-4">
          <div className="space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-[var(--text-muted)]">Directory filter</span>
              <input
                className={inputClassName()}
                value={cwdFilter}
                onChange={(event) => setCwdFilter(event.target.value)}
                placeholder="/Users/giulioleone/Sviluppo/Max"
              />
            </label>

            {discovered.length === 0 ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                Run discovery to load native Copilot sessions available on this machine.
              </div>
            ) : (
              <div className="space-y-3">
                {discovered.map((session) => {
                  const isSelected = session.id === selectedSessionId;
                  return (
                    <button
                      type="button"
                      key={session.id}
                      className={`w-full text-left rounded-lg border p-4 transition-colors ${
                        isSelected
                          ? "border-[var(--accent)] bg-[rgba(59,130,246,0.08)]"
                          : "border-[var(--border)] hover:border-[var(--accent)]"
                      }`}
                      onClick={() => handleSelectSession(session)}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-mono text-sm break-all">{session.id}</p>
                          <p className="text-xs text-[var(--text-muted)] truncate mt-1">{session.workingDir}</p>
                          <p className="text-xs text-[var(--text-muted)] mt-2">
                            {session.summary || "No summary available"}
                          </p>
                        </div>
                        <span className="text-[11px] text-[var(--text-muted)] whitespace-nowrap">
                          {formatUpdatedAt(session.updatedAt)}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
            <div>
              <h4 className="text-sm font-medium">Attach selected session</h4>
              <p className="text-xs text-[var(--text-muted)] mt-1">
                Max will keep the attachment recoverable across daemon restarts without deleting the original Copilot session.
              </p>
            </div>

            {selectedSession ? (
              <>
                <div className="rounded-lg bg-[var(--bg)] border border-[var(--border)] p-3 space-y-1">
                  <p className="text-xs font-mono break-all">{selectedSession.id}</p>
                  <p className="text-xs text-[var(--text-muted)] break-all">{selectedSession.workingDir}</p>
                </div>
                <label className="block space-y-1.5">
                  <span className="text-xs font-medium text-[var(--text-muted)]">Worker name</span>
                  <input
                    className={inputClassName()}
                    value={attachName}
                    onChange={(event) => setAttachName(event.target.value)}
                    placeholder="machine-my-project"
                  />
                </label>
                <button
                  type="button"
                  className={buttonClassName("primary")}
                  disabled={attaching}
                  onClick={() => void handleAttach()}
                >
                  {attaching ? "Attaching…" : "Attach to Max"}
                </button>
              </>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                Select a discovered Copilot session to prepare the attachment.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
