"use client";

import { useState, useEffect } from "react";

interface HarnessControlsProps {
  phase: "init" | "coding" | "complete" | null;
  onStart: (dir: string, goal: string) => void;
  onContinue: (dir: string) => void;
  disabled?: boolean;
  initialDir?: string;
}

export function HarnessControls({ phase, onStart, onContinue, disabled, initialDir }: HarnessControlsProps) {
  const [dir, setDir] = useState(initialDir ?? "");
  const [goal, setGoal] = useState("");

  // Sync with parent-provided dir
  useEffect(() => {
    if (initialDir && !dir) setDir(initialDir);
  }, [initialDir, dir]);

  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-4">
      <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">Controls</h3>

      <div className="space-y-2 mb-4">
        <input
          type="text"
          value={dir}
          onChange={(e) => setDir(e.target.value)}
          placeholder="Project directory (e.g. /tmp/my-project)"
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
        />
        {(!phase || phase === "init") && (
          <input
            type="text"
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            placeholder="Project goal (e.g. Build a REST API...)"
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
          />
        )}
      </div>

      <div className="flex gap-2">
        {(!phase || phase === "init") && (
          <button
            onClick={() => { if (dir && goal) onStart(dir, goal); }}
            disabled={disabled || !dir || !goal}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            🚀 Start Harness
          </button>
        )}
        {phase === "coding" && (
          <button
            onClick={() => { if (dir) onContinue(dir); }}
            disabled={disabled || !dir}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--success)] text-white hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            ▶️ Continue Next Feature
          </button>
        )}
        {phase === "complete" && (
          <span className="px-4 py-2 rounded-lg text-sm font-medium bg-[rgba(34,197,94,0.15)] text-[var(--success)]">
            🎉 All features complete!
          </span>
        )}
      </div>
    </div>
  );
}
