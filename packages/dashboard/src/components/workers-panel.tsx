"use client";

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

  return (
    <li className="px-4 py-3 flex items-center gap-3 hover:bg-[var(--bg-card-hover)] transition-colors">
      <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: statusColor }} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-mono truncate">{worker.name}</p>
        {worker.lastOutput && (
          <p className="text-xs text-[var(--text-muted)] truncate mt-0.5">{worker.lastOutput}</p>
        )}
      </div>
      {isHarness && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-[var(--accent-glow)] text-[var(--accent)]">
          harness
        </span>
      )}
    </li>
  );
}
