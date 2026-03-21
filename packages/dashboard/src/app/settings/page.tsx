"use client";

import { useState } from "react";

export default function SettingsPage() {
  const [token, setToken] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("max-api-token") ?? "" : ""
  );
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    localStorage.setItem("max-api-token", token);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 max-w-2xl mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>
      <p className="text-sm text-[var(--text-muted)]">Configure dashboard connection to Max daemon</p>

      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6 space-y-4">
        <div>
          <label className="text-sm font-medium text-[var(--text-muted)] block mb-1.5">
            API Token
          </label>
          <p className="text-xs text-[var(--text-muted)] mb-2">
            Found in <code className="px-1 py-0.5 rounded bg-[var(--bg)] text-[var(--accent)]">~/.max/api-token</code>
          </p>
          <input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your Max API token"
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)] font-mono"
          />
        </div>
        <button
          onClick={handleSave}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 transition-opacity"
        >
          {saved ? "✓ Saved" : "Save Token"}
        </button>
      </div>

      <div className="rounded-xl bg-[var(--bg-card)] border border-[var(--border)] p-6 space-y-2">
        <h3 className="text-sm font-medium text-[var(--text-muted)]">Connection Info</h3>
        <div className="text-xs font-mono text-[var(--text-muted)] space-y-1">
          <p>API Base: <span className="text-[var(--text)]">http://localhost:7777</span></p>
          <p>SSE Endpoint: <span className="text-[var(--text)]">http://localhost:7777/stream</span></p>
          <p>Dashboard Proxy: <span className="text-[var(--text)]">/api/max/*</span></p>
        </div>
      </div>
    </div>
  );
}
