"use client";

import type { SSEEvent } from "@/lib/api";
import { useEffect, useRef } from "react";

interface EventStreamProps {
  events: SSEEvent[];
}

export function EventStream({ events }: EventStreamProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [events.length]);

  const recent = events.slice(-50);

  return (
    <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] overflow-hidden">
      <div className="px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">Live Stream</h3>
        <span className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--success)] pulse-dot" />
          SSE
        </span>
      </div>
      <div className="max-h-48 overflow-y-auto p-3 font-mono text-xs space-y-0.5">
        {recent.length === 0 ? (
          <p className="text-[var(--text-muted)]">Waiting for events...</p>
        ) : (
          recent.map((evt, i) => {
            const color =
              evt.type === "error" ? "var(--danger)" :
              evt.type === "harness_started" || evt.type === "harness_continued" ? "var(--success)" :
              evt.type === "delta" ? "var(--text-muted)" :
              "var(--text)";
            return (
              <p key={i} style={{ color }} className="leading-relaxed break-all">
                <span className="opacity-40">[{evt.type}]</span>{" "}
                {evt.content?.slice(0, 200) ?? ""}
              </p>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
