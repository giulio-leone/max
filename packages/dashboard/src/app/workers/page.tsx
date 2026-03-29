"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchWorkers, type Worker } from "@/lib/api";
import { WorkersPanel } from "@/components/workers-panel";
import { NativeSessionsPanel } from "@/components/native-sessions-panel";

export default function WorkersPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refreshWorkers = useCallback(async () => {
    try {
      setWorkers(await fetchWorkers());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load workers");
    }
  }, []);

  useEffect(() => {
    const poll = async () => {
      await refreshWorkers();
    };
    void poll();
    const id = setInterval(poll, 2000);
    return () => clearInterval(id);
  }, [refreshWorkers]);

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Workers</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Observe active Max workers, attach native Copilot sessions started outside Max, and jump into direct operator chat for attached sessions.
        </p>
      </div>

      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.35)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)] gap-6 items-start">
        <NativeSessionsPanel workers={workers} onWorkersChanged={refreshWorkers} />
        <WorkersPanel workers={workers} />
      </div>
    </div>
  );
}
