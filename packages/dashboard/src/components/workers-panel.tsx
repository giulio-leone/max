"use client";

import Link from "next/link";
import type { Worker } from "@/lib/api";

interface WorkersPanelProps {
  workers: Worker[];
}

export function WorkersPanel({ workers }: WorkersPanelProps) {
  const harnessWorkers = workers.filter((w) => w.isHarnessWorker);
  const otherWorkers = workers.filter((w) => !w.isHarnessWorker);

  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">Active Workers</h3>
        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-glow)] text-[var(--accent)] font-mono">
          {workers.length}
        </span>
      </div>
      {workers.length === 0 ? (
        <div className="p-4 text-xs text-[var(--text-muted)]">No active workers.</div>
      ) : (
        <ul className="divide-y divide-[var(--border)]">
          {harnessWorkers.map((w) => (
            <WorkerRow key={w.name} worker={w} isHarness />
          ))}
          {otherWorkers.map((w) => (
            <WorkerRow key={w.name} worker={w} />
          ))}
        </ul>
      )}
    </div>
  );
}

function WorkerRow({ worker, isHarness }: { worker: Worker; isHarness?: boolean }) {
  const statusColor =
    worker.status === "running" ? "var(--success)" :
    worker.status === "complete" ? "var(--text-muted)" :
    "var(--warning)";
  const isMachineSession = worker.sessionSource === "machine";

  return (
    <li className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-card-hover)] transition-colors">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <p className="text-sm font-mono truncate">{worker.name}</p>
          {isMachineSession && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(99,102,241,0.15)] text-[#a5b4fc]">
              machine
            </span>
          )}
          {worker.activationMode && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(59,130,246,0.15)] text-[#93c5fd]">
              {worker.activationMode}
            </span>
          )}
          {worker.originChannel && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[rgba(16,185,129,0.15)] text-[#86efac]">
              via {worker.originChannel}
            </span>
          )}
          {isHarness && (
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-glow)] text-[var(--accent)]">
              harness
            </span>
          )}
        </div>
        <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{worker.workingDir}</p>
        {worker.copilotSessionId && (
          <p className="text-[11px] text-[var(--text-muted)] font-mono truncate mt-0.5">
            Session {worker.copilotSessionId}
          </p>
        )}
        {isMachineSession && (
          <p className="text-[11px] text-[var(--text-muted)] truncate mt-0.5">
            Workspace {worker.workspaceLabel || "—"} · Route {worker.routingHint || "—"} · Queue {worker.queueHint || "—"}
          </p>
        )}
        {worker.lastOutput && (
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{worker.lastOutput}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
          {worker.sessionSource === "machine" ? (
            <Link
              href={`/chat?mode=native&sessionName=${encodeURIComponent(worker.name)}`}
              className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              Open chat
            </Link>
          ) : null}
          {worker.originChannel ? (
            <Link
              href={`/channels?accountType=${encodeURIComponent(worker.originChannel)}`}
              className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] transition hover:border-[var(--accent)] hover:text-[var(--accent)]"
            >
              View {worker.originChannel} channels
            </Link>
          ) : null}
        </div>
      </div>
      <span className="text-xs px-2 py-0.5 rounded-full border border-[var(--border)] text-[var(--text-muted)] font-mono">
        {worker.status}
      </span>
    </li>
  );
}
