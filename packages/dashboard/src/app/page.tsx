"use client";

import { useState, useCallback, useEffect } from "react";
import { ProgressBar } from "@/components/progress-bar";
import { FeatureList } from "@/components/feature-list";
import { ProgressLog } from "@/components/progress-log";
import { WorkersPanel } from "@/components/workers-panel";
import { EventStream } from "@/components/event-stream";
import { HarnessControls } from "@/components/harness-controls";
import { useHarnessStatus, useSSE } from "@/hooks/use-harness";
import { startHarness, continueHarness, fetchWorkers, type Worker } from "@/lib/api";

export default function DashboardPage() {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [busy, setBusy] = useState(false);

  const { status, loading, refresh } = useHarnessStatus(projectDir);
  const { events, connected, getConnectionId } = useSSE();

  // Poll workers
  useEffect(() => {
    const poll = async () => {
      try {
        const w = await fetchWorkers();
        setWorkers(w);
      } catch { /* ignore */ }
    };
    poll();
    const id = setInterval(poll, 3000);
    return () => clearInterval(id);
  }, []);

  // Refresh harness status when SSE events arrive
  useEffect(() => {
    if (events.length > 0) {
      const last = events[events.length - 1];
      if (last.type === "harness_started" || last.type === "harness_continued" || last.type === "message") {
        refresh();
      }
    }
  }, [events, refresh]);

  const handleStart = useCallback(async (dir: string, goal: string) => {
    setProjectDir(dir);
    setBusy(true);
    try {
      const connId = getConnectionId();
      if (!connId) { alert("SSE not connected yet — wait a moment"); return; }
      await startHarness(dir, goal, connId);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [getConnectionId]);

  const handleContinue = useCallback(async (dir: string) => {
    setProjectDir(dir);
    setBusy(true);
    try {
      const connId = getConnectionId();
      if (!connId) { alert("SSE not connected yet — wait a moment"); return; }
      await continueHarness(dir, connId);
    } catch (err) {
      alert(`Error: ${err instanceof Error ? err.message : err}`);
    } finally {
      setBusy(false);
    }
  }, [getConnectionId]);

  const features = status?.features ?? [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Harness Dashboard</h2>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            {projectDir ? `Monitoring: ${projectDir}` : "Configure a project directory to begin"}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span
            className="w-2 h-2 rounded-full"
            style={{ background: connected ? "var(--success)" : "var(--danger)" }}
          />
          <span className="text-[var(--text-muted)]">{connected ? "SSE Connected" : "SSE Disconnected"}</span>
        </div>
      </div>

      {/* Controls */}
      <HarnessControls
        phase={status?.phase ?? null}
        onStart={handleStart}
        onContinue={handleContinue}
        disabled={busy}
      />

      {/* Progress */}
      {status && status.phase !== "init" && (
        <ProgressBar
          percent={status.percentComplete}
          passing={status.passing}
          total={status.total}
        />
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="space-y-6">
          <FeatureList features={features} activeFeatureId={status?.nextFeature?.id} />
          <ProgressLog entries={status?.progressLog ?? []} />
        </div>
        <div className="space-y-6">
          <WorkersPanel workers={workers} />
          <EventStream events={events} />
        </div>
      </div>

      {/* Phase badge */}
      {status && (
        <div className="text-center text-xs text-[var(--text-muted)]">
          Phase: <span className="font-mono text-[var(--accent)]">{status.phase}</span>
          {" · "}Goal: <span className="font-mono">{status.projectGoal}</span>
        </div>
      )}
    </div>
  );
}
