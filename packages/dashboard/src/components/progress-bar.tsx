"use client";

interface ProgressBarProps {
  percent: number;
  passing: number;
  total: number;
}

export function ProgressBar({ percent, passing, total }: ProgressBarProps) {
  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">Overall Progress</h3>
        <span className="text-2xl font-bold tabular-nums">
          {Math.round(percent)}%
        </span>
      </div>
      <div className="w-full h-3 bg-[var(--border)] rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700 ease-out progress-bar-animated"
          style={{
            width: `${percent}%`,
            background: percent === 100
              ? "var(--success)"
              : "linear-gradient(90deg, var(--accent), #818cf8)",
          }}
        />
      </div>
      <p className="text-xs text-[var(--text-muted)] mt-2">
        {passing} of {total} features passing
      </p>
    </div>
  );
}
