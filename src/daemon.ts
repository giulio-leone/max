import { getClient, stopClient } from "./copilot/client.js";
import { initOrchestrator, setMessageLogger, setProactiveNotify, getWorkers } from "./copilot/orchestrator.js";
import { startApiServer, broadcastToSSE } from "./api/server.js";
import { createBot, startBot, stopBot, sendProactiveMessage } from "./telegram/bot.js";
import { closeDb, deleteWorkerSession, getDb } from "./store/db.js";
import { config } from "./config.js";
import { spawn } from "child_process";
import { checkForUpdate } from "./update.js";
import { startControlPlaneScheduler, stopControlPlaneScheduler } from "./control-plane/scheduler.js";
import {
  startControlPlaneHeartbeatMonitor,
  stopControlPlaneHeartbeatMonitor,
} from "./control-plane/heartbeat-monitor.js";
import { runControlPlaneLegacyCutoff } from "./control-plane/store.js";
import {
  listDestroyableWorkers,
  listPersistentMachineWorkers,
  recoverPersistedWorkerSessions,
} from "./copilot/worker-sessions.js";

function truncate(text: string, max = 200): string {
  const oneLine = text.replace(/\n/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

async function main(): Promise<void> {
  console.log("[max] Starting Max daemon...");
  if (config.selfEditEnabled) {
    console.log("[max] ⚠ Self-edit mode enabled — Max can modify his own source code");
  }

  // Set up message logging to daemon console
  setMessageLogger((direction, source, text) => {
    const arrow = direction === "in" ? "⟶" : "⟵";
    const tag = source.padEnd(8);
    console.log(`[max] ${tag} ${arrow}  ${truncate(text)}`);
  });

  // Initialize SQLite
  getDb();
  console.log("[max] Database initialized");
  const legacyCutoff = runControlPlaneLegacyCutoff();
  if (
    legacyCutoff.normalizedStatuses > 0
    || legacyCutoff.migratedHeartbeatPrompts > 0
    || legacyCutoff.disabledLegacyAutomation > 0
    || legacyCutoff.deletedLegacyMessages > 0
  ) {
    console.log(
      `[max] Control-plane legacy cutoff applied `
      + `(statuses: ${legacyCutoff.normalizedStatuses}, `
      + `migrated prompts: ${legacyCutoff.migratedHeartbeatPrompts}, `
      + `disabled automation: ${legacyCutoff.disabledLegacyAutomation}, `
      + `deleted legacy messages: ${legacyCutoff.deletedLegacyMessages})`
    );
  }

  // Start Copilot SDK client
  console.log("[max] Starting Copilot SDK client...");
  const client = await getClient();
  console.log("[max] Copilot SDK client ready");

  // Initialize orchestrator session
  console.log("[max] Creating orchestrator session...");
  await initOrchestrator(client);
  console.log("[max] Orchestrator session ready");

  const recoveredWorkers = await recoverPersistedWorkerSessions({
    client,
    workers: getWorkers(),
  });
  if (recoveredWorkers.recovered > 0 || recoveredWorkers.cleared > 0) {
    console.log(
      `[max] Recovered ${recoveredWorkers.recovered} persisted worker session(s)`
      + (recoveredWorkers.cleared > 0 ? ` and cleared ${recoveredWorkers.cleared} stale session(s)` : "")
    );
  }

  // Wire up proactive notifications — route to the originating channel
  setProactiveNotify((text, channel) => {
    console.log(`[max] bg-notify (${channel ?? "all"}) ⟵  ${truncate(text)}`);
    if (!channel || channel === "telegram") {
      if (config.telegramEnabled) sendProactiveMessage(text);
    }
    if (!channel || channel === "tui") {
      broadcastToSSE(text);
    }
  });

  // Start HTTP API for TUI
  await startApiServer();
  startControlPlaneScheduler();
  startControlPlaneHeartbeatMonitor();

  // Start Telegram bot (if configured)
  if (config.telegramEnabled) {
    createBot();
    await startBot();
  } else if (!config.telegramBotToken && config.authorizedUserId === undefined) {
    console.log("[max] Telegram not configured — skipping bot. Run 'max setup' to configure.");
  } else if (!config.telegramBotToken) {
    console.log("[max] Telegram bot token missing — skipping bot. Run 'max setup' and enter your bot token.");
  } else {
    console.log("[max] Telegram user ID missing — skipping bot. Run 'max setup' and enter your Telegram user ID (get it from @userinfobot).");
  }

  console.log("[max] Max is fully operational.");

  // Non-blocking update check
  checkForUpdate()
    .then(({ updateAvailable, current, latest }) => {
      if (updateAvailable) {
        console.log(`[max] ⬆ Update available: v${current} → v${latest}  —  run 'max update' to install`);
      }
    })
    .catch(() => {});  // silent — network may be unavailable

  // Notify user if this is a restart (not a fresh start)
  if (config.telegramEnabled && process.env.MAX_RESTARTED === "1") {
    await sendProactiveMessage("I'm back online 🟢").catch(() => {});
    delete process.env.MAX_RESTARTED;
  }
}

// Graceful shutdown
let shutdownState: "idle" | "warned" | "shutting_down" = "idle";
async function shutdown(): Promise<void> {
  if (shutdownState === "shutting_down") {
    console.log("\n[max] Forced exit.");
    process.exit(1);
  }

  // Check for active workers before shutting down
  const workers = getWorkers();
  const destroyableWorkers = listDestroyableWorkers(workers);
  const persistentMachineWorkers = listPersistentMachineWorkers(workers);
  const running = destroyableWorkers.filter(w => w.status === "running");

  if (running.length > 0 && shutdownState === "idle") {
    const names = running.map(w => w.name).join(", ");
    console.log(`\n[max] ⚠ ${running.length} active worker(s) will be destroyed: ${names}`);
    console.log("[max] Press Ctrl+C again to shut down, or wait for workers to finish.");
    shutdownState = "warned";
    return;
  }

  shutdownState = "shutting_down";
  console.log("\n[max] Shutting down... (Ctrl+C again to force)");

  // Force exit after 3 seconds no matter what
  const forceTimer = setTimeout(() => {
    console.log("[max] Shutdown timed out — forcing exit.");
    process.exit(1);
  }, 3000);
  forceTimer.unref();

  if (config.telegramEnabled) {
    try { await stopBot(); } catch { /* best effort */ }
  }

  stopControlPlaneScheduler();
  stopControlPlaneHeartbeatMonitor();

  if (persistentMachineWorkers.length > 0) {
    console.log(`[max] Detaching ${persistentMachineWorkers.length} attached machine session(s) without destroying them`);
  }

  await Promise.allSettled(
    destroyableWorkers.map((w) => w.session.destroy())
  );
  for (const worker of destroyableWorkers) {
    deleteWorkerSession(worker.name);
  }
  workers.clear();

  try { await stopClient(); } catch { /* best effort */ }
  closeDb();
  console.log("[max] Goodbye.");
  process.exit(0);
}

/** Restart the daemon by spawning a new process and exiting. */
export async function restartDaemon(): Promise<void> {
  console.log("[max] Restarting...");

  const activeWorkers = getWorkers();
  const destroyableWorkers = listDestroyableWorkers(activeWorkers);
  const persistentMachineWorkers = listPersistentMachineWorkers(activeWorkers);
  const runningCount = destroyableWorkers.filter(w => w.status === "running").length;
  if (runningCount > 0) {
    console.log(`[max] ⚠ Destroying ${runningCount} active worker(s) for restart`);
  }
  if (persistentMachineWorkers.length > 0) {
    console.log(`[max] Keeping ${persistentMachineWorkers.length} attached machine session(s) available for recovery after restart`);
  }

  if (config.telegramEnabled) {
    await sendProactiveMessage("Restarting — back in a sec ⏳").catch(() => {});
    try { await stopBot(); } catch { /* best effort */ }
  }

  stopControlPlaneScheduler();
  stopControlPlaneHeartbeatMonitor();

  // Destroy Max-owned worker sessions. Attached machine sessions stay alive and are recovered on boot.
  await Promise.allSettled(
    destroyableWorkers.map((w) => w.session.destroy())
  );
  for (const worker of destroyableWorkers) {
    deleteWorkerSession(worker.name);
  }
  activeWorkers.clear();

  try { await stopClient(); } catch { /* best effort */ }
  closeDb();

  // Spawn a detached replacement process with the same args (include execArgv for tsx/loaders)
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    detached: true,
    stdio: "inherit",
    env: { ...process.env, MAX_RESTARTED: "1" },
  });
  child.unref();

  console.log("[max] New process spawned. Exiting old process.");
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Prevent unhandled errors from crashing the daemon
process.on("unhandledRejection", (reason) => {
  console.error("[max] Unhandled rejection (kept alive):", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[max] Uncaught exception — shutting down:", err);
  process.exit(1);
});

main().catch((err) => {
  console.error("[max] Fatal error:", err);
  process.exit(1);
});
