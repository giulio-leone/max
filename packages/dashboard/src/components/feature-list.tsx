"use client";

import type { Feature } from "@/lib/api";

interface FeatureListProps {
  features: Feature[];
  activeFeatureId?: string | null;
}

export function FeatureList({ features, activeFeatureId }: FeatureListProps) {
  if (features.length === 0) {
    return (
      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6 text-center text-[var(--text-muted)]">
        No features yet. Start a harness to begin.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)]">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">Features</h3>
      </div>
      <ul className="divide-y divide-[var(--border)]">
        {features.map((f) => {
          const isActive = f.id === activeFeatureId;
          return (
            <li
              key={f.id}
              className={`px-4 py-3 flex items-center gap-3 transition-colors ${
                isActive ? "bg-[var(--accent-glow)]" : "hover:bg-[var(--bg-card-hover)]"
              }`}
            >
              <span className="text-lg flex-shrink-0">
                {f.passes ? "✅" : isActive ? (
                  <span className="pulse-dot text-[var(--accent)]">🔄</span>
                ) : "⬜"}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{f.title}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{f.description}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full font-mono flex-shrink-0" style={{
                background: f.passes ? "rgba(34,197,94,0.15)" : isActive ? "var(--accent-glow)" : "rgba(122,122,142,0.1)",
                color: f.passes ? "var(--success)" : isActive ? "var(--accent)" : "var(--text-muted)",
              }}>
                {f.passes ? "pass" : isActive ? "running" : "pending"}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
