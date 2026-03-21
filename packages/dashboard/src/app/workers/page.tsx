"use client";

import { useEffect, useState } from "react";
import { fetchWorkers, type Worker } from "@/lib/api";

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);

  useEffect(() => {
    const poll = async () => {
      try { setWorkers(await fetchWorkers()); } catch { /* */ }
    };
    poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Workers</h2>
      <p className="text-sm text-[var(--text-muted)]">All active Max worker sessions</p>

      {workers.length === 0 ? (
        <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-8 text-center text-[var(--text-muted)]">
          No active workers
        </div>
      ) : (
        <div className="space-y-3">
          {workers.map((w) => (
            <div key={w.name} className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4 flex items-center gap-4">
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: w.status === "running" ? "var(--success)" : "var(--text-muted)" }}
              />
              <div className="flex-1 min-w-0">
                <p className="font-mono text-sm">{w.name}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{w.lastOutput ?? "—"}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full font-mono" style={{
                background: w.status === "running" ? "rgba(34,197,94,0.15)" : "rgba(122,122,142,0.1)",
                color: w.status === "running" ? "var(--success)" : "var(--text-muted)",
              }}>
                {w.status}
              </span>
              {w.isHarnessWorker && (
                <span className="text-xs px-2 py-1 rounded-full bg-[var(--accent-glow)] text-[var(--accent)]">
                  harness
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
