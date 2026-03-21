import {
  listSchedules,
  updateScheduleRuntime,
  type ScheduleRecord,
} from "./store.js";
import {
  computeNextScheduleRun,
  formatControlPlaneTimestamp,
  parseControlPlaneTimestamp,
} from "./schedule-expression.js";
import { runScheduleNow } from "./runtime.js";

const SCHEDULER_POLL_INTERVAL_MS = 15_000;

let schedulerTimer: ReturnType<typeof setInterval> | undefined;
let tickInFlight = false;
const runningSchedules = new Set<number>();

function sameTimestamp(left: string | null, right: string | null): boolean {
  return (left ?? null) === (right ?? null);
}

function computeFutureRun(schedule: ScheduleRecord, now: Date): string | null {
  const nextRun = computeNextScheduleRun(schedule.scheduleType, schedule.expression, now);
  return nextRun ? formatControlPlaneTimestamp(nextRun) : null;
}

function readNextRun(schedule: ScheduleRecord): Date | null {
  if (!schedule.nextRunAt) return null;
  try {
    return parseControlPlaneTimestamp(schedule.nextRunAt);
  } catch {
    return null;
  }
}

async function executeScheduledRun(schedule: ScheduleRecord): Promise<void> {
  runningSchedules.add(schedule.id);
  try {
    await runScheduleNow(schedule.id, "scheduler");
  } catch (err) {
    try {
      const fallbackNextRun = computeFutureRun(schedule, new Date());
      updateScheduleRuntime({
        id: schedule.id,
        nextRunAt: fallbackNextRun,
      });
    } catch {
      // The schedule may have been removed while the execution was in flight.
    }
    console.error(`[max] Scheduled execution failed for "${schedule.name}":`, err);
  } finally {
    runningSchedules.delete(schedule.id);
  }
}

async function tickScheduler(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;

  try {
    const now = new Date();
    const schedules = listSchedules();

    for (const schedule of schedules) {
      if (!schedule.enabled) {
        if (schedule.nextRunAt !== null) {
          updateScheduleRuntime({ id: schedule.id, nextRunAt: null });
        }
        continue;
      }

      if (schedule.scheduleType === "manual") {
        if (schedule.nextRunAt !== null) {
          updateScheduleRuntime({ id: schedule.id, nextRunAt: null });
        }
        continue;
      }

      const desiredNextRun = readNextRun(schedule) ?? computeNextScheduleRun(schedule.scheduleType, schedule.expression, now);

      if (!desiredNextRun) {
        if (schedule.nextRunAt !== null) {
          updateScheduleRuntime({ id: schedule.id, nextRunAt: null });
        }
        continue;
      }

      const desiredNextRunText = formatControlPlaneTimestamp(desiredNextRun);
      if (!sameTimestamp(schedule.nextRunAt, desiredNextRunText) && desiredNextRun > now) {
        updateScheduleRuntime({ id: schedule.id, nextRunAt: desiredNextRunText });
      }

      if (desiredNextRun > now || runningSchedules.has(schedule.id)) {
        continue;
      }

      void executeScheduledRun(schedule);
    }
  } catch (err) {
    console.error("[max] Control-plane scheduler tick failed:", err);
  } finally {
    tickInFlight = false;
  }
}

export function startControlPlaneScheduler(): void {
  if (schedulerTimer) return;

  console.log(`[max] Control-plane scheduler polling every ${Math.round(SCHEDULER_POLL_INTERVAL_MS / 1000)}s`);
  void tickScheduler();
  schedulerTimer = setInterval(() => {
    void tickScheduler();
  }, SCHEDULER_POLL_INTERVAL_MS);
}

export function stopControlPlaneScheduler(): void {
  if (!schedulerTimer) return;
  clearInterval(schedulerTimer);
  schedulerTimer = undefined;
  runningSchedules.clear();
}
