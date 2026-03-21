"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { fetchHarnessStatus, connectSSE, type HarnessStatus, type SSEEvent } from "@/lib/api";

export function useHarnessStatus(dir: string | null, pollInterval = 5000) {
  const [status, setStatus] = useState<HarnessStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!dir) return;
    try {
      const data = await fetchHarnessStatus(dir);
      setStatus(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }, [dir]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, pollInterval);
    return () => clearInterval(id);
  }, [refresh, pollInterval]);

  return { status, loading, error, refresh };
}

export function useSSE() {
  const [events, setEvents] = useState<SSEEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const connectionRef = useRef<{ close: () => void; getConnectionId: () => string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    connectSSE((event) => {
      if (cancelled) return;
      if (event.connectionId) setConnected(true);
      if (event.type === "error") setConnected(false);
      setEvents((prev) => [...prev.slice(-100), event]);
    }).then((conn) => {
      if (cancelled) { conn.close(); return; }
      connectionRef.current = conn;
    });
    return () => { cancelled = true; connectionRef.current?.close(); };
  }, []);

  const getConnectionId = useCallback(() => {
    return connectionRef.current?.getConnectionId() ?? null;
  }, []);

  return { events, connected, getConnectionId };
}
