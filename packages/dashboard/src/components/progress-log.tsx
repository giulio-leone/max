"use client";

interface ProgressLogProps {
  entries: string[];
}

export function ProgressLog({ entries }: ProgressLogProps) {
  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">Progress Log</h3>
      </div>
      <div className="max-h-64 overflow-y-auto p-4 font-mono text-xs space-y-1">
        {entries.length === 0 ? (
          <p className="text-[var(--text-muted)]">No log entries yet.</p>
        ) : (
          entries.map((entry, i) => (
            <p key={i} className="text-[var(--text-muted)] leading-relaxed">
              {entry}
            </p>
          ))
        )}
      </div>
    </div>
  );
}
