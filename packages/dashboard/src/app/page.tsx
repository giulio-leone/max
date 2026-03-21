"use client";

import { useState, useCallback, useEffect } from "react";
import { ProgressBar } from "@/components/progress-bar";
import { FeatureList } from "@/components/feature-list";
import { ProgressLog } from "@/components/progress-log";
import { WorkersPanel } from "@/components/workers-panel";
import { EventStream } from "@/components/event-stream";
import { HarnessControls } from "@/components/harness-controls";
import { useHarnessStatus, useSSE } from "@/hooks/use-harness";
import { startHarness, continueHarness, fetchWorkers, fetchRecentHarnessDirs, type Worker } from "@/lib/api";

export default function DashboardPage() {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [busy, setBusy] = useState(false);

  // Auto-load projectDir from URL ?dir= or localStorage
  useEffect(() => {
    let cancelled = false;
    const loadInitialDir = async () => {
      const params = new URLSearchParams(window.location.search);
      const urlDir = params.get("dir");
      if (urlDir) {
        if (!cancelled) setProjectDir(urlDir);
        localStorage.setItem("max-harness-dir", urlDir);
        return;
      }

      const saved = localStorage.getItem("max-harness-dir");
      if (saved) {
        if (!cancelled) setProjectDir(saved);
        return;
      }

      try {
        const recent = await fetchRecentHarnessDirs();
        const latest = recent[0];
        if (latest && !cancelled) {
          setProjectDir(latest);
          localStorage.setItem("max-harness-dir", latest);
        }
      } catch {
        // ignore bootstrap failures
      }
    };

    void loadInitialDir();
    return () => {
      cancelled = true;
    };
  }, []);

  const { status, loading, error, refresh } = useHarnessStatus(projectDir);
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

  useEffect(() => {
    if (projectDir) return;
    const activeHarness = workers.find((worker) => worker.isHarnessWorker && worker.workingDir);
    if (!activeHarness) return;
    setProjectDir(activeHarness.workingDir);
    localStorage.setItem("max-harness-dir", activeHarness.workingDir);
  }, [workers, projectDir]);

  // Refresh harness status when SSE events arrive
  useEffect(() => {
    if (events.length > 0) {
      const last = events[events.length - 1];
      if (last.type === "harness_started" || last.type === "harness_continued" || last.type === "message" || last.type === "connected") {
        refresh();
      }
    }
  }, [events, refresh]);

  const handleStart = useCallback(async (dir: string, goal: string) => {
    setProjectDir(dir);
    localStorage.setItem("max-harness-dir", dir);
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
    localStorage.setItem("max-harness-dir", dir);
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
  const progressEntries = status?.progressLog
    ? status.progressLog.split("\n").filter((l) => l.trim())
    : [];

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

      {/* Error banner */}
      {error && (
        <div className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
          {error}
        </div>
      )}

      {/* Controls */}
      <HarnessControls
        phase={status?.phase ?? null}
        onStart={handleStart}
        onContinue={handleContinue}
        disabled={busy}
        initialDir={projectDir ?? ""}
      />

      {/* Loading state */}
      {loading && projectDir && (
        <div className="text-center text-sm text-[var(--text-muted)] animate-pulse">Loading harness status…</div>
      )}

      {/* Progress */}
      {status && (
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
          <ProgressLog entries={progressEntries} />
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
          {status.projectGoal && (
            <>
              {" · "}Goal: <span className="font-mono">{status.projectGoal}</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}
