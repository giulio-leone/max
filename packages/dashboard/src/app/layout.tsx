import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Max Dashboard",
  description: "Agent harness monitoring dashboard for Max AI orchestrator",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[var(--bg)] antialiased">
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-56 border-r border-[var(--border)] bg-[var(--bg-card)] flex flex-col">
            <div className="p-4 border-b border-[var(--border)]">
              <h1 className="text-lg font-bold text-[var(--accent)] flex items-center gap-2">
                <span className="text-2xl">⚡</span> Max
              </h1>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">Agent Harness Dashboard</p>
            </div>
            <nav className="flex-1 p-2">
              <a
                href="/"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-[var(--accent-glow)] text-[var(--accent)] font-medium"
              >
                <span>📊</span> Dashboard
              </a>
              <a
                href="/workers"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)] mt-1"
              >
                <span>🤖</span> Workers
              </a>
              <a
                href="/settings"
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card-hover)] mt-1"
              >
                <span>⚙️</span> Settings
              </a>
            </nav>
            <div className="p-3 border-t border-[var(--border)]">
              <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <span className="w-2 h-2 rounded-full bg-[var(--success)]" />
                Connected
              </div>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 overflow-y-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
