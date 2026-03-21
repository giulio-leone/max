const API_BASE = "/api/max";

function getAuthHeaders(): HeadersInit {
  const token = typeof window !== "undefined" ? localStorage.getItem("max-api-token") : null;
  return token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
}

export interface Feature {
  id: string;
  title: string;
  description: string;
  passes: boolean;
}

export interface HarnessStatus {
  phase: "init" | "coding" | "complete";
  total: number;
  passing: number;
  failing: number;
  percentComplete: number;
  nextFeature: Feature | null;
  projectGoal: string;
  progressLog: string[];
  features: Feature[];
}

export interface Worker {
  name: string;
  status: string;
  lastOutput?: string;
  isHarnessWorker?: boolean;
}

export interface MaxStatus {
  status: string;
  workers: Worker[];
}

export async function fetchHarnessStatus(dir: string): Promise<HarnessStatus> {
  const res = await fetch(`${API_BASE}/harness?dir=${encodeURIComponent(dir)}`, {
    headers: getAuthHeaders(),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchMaxStatus(): Promise<MaxStatus> {
  const res = await fetch(`${API_BASE}/status`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function fetchWorkers(): Promise<Worker[]> {
  const res = await fetch(`${API_BASE}/sessions`, { headers: getAuthHeaders() });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function startHarness(dir: string, goal: string, connectionId: string) {
  const res = await fetch(`${API_BASE}/harness/start`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ dir, goal, connectionId }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export async function continueHarness(dir: string, connectionId: string) {
  const res = await fetch(`${API_BASE}/harness/continue`, {
    method: "POST",
    headers: getAuthHeaders(),
    body: JSON.stringify({ dir, connectionId }),
  });
  if (!res.ok) throw new Error(`API error: ${res.status}`);
  return res.json();
}

export interface SSEEvent {
  type: string;
  content?: string;
  connectionId?: string;
}

export function connectSSE(onEvent: (event: SSEEvent) => void): {
  close: () => void;
  getConnectionId: () => string | null;
} {
  let connectionId: string | null = null;
  const token = typeof window !== "undefined" ? localStorage.getItem("max-api-token") : null;
  const url = token ? `${API_BASE}/stream?token=${token}` : `${API_BASE}/stream`;
  const eventSource = new EventSource(url);

  eventSource.onmessage = (event) => {
    try {
      const data: SSEEvent = JSON.parse(event.data);
      if (data.connectionId) connectionId = data.connectionId;
      onEvent(data);
    } catch {
      // ignore parse errors
    }
  };

  eventSource.onerror = () => {
    onEvent({ type: "error", content: "SSE connection lost" });
  };

  return {
    close: () => eventSource.close(),
    getConnectionId: () => connectionId,
  };
}
