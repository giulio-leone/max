import { describe, expect, it } from "vitest";
import {
  computeNextScheduleRun,
  formatControlPlaneTimestamp,
  normalizeScheduleType,
  parseControlPlaneTimestamp,
  validateScheduleDefinition,
} from "../src/control-plane/schedule-expression.js";

describe("schedule-expression", () => {
  it("normalizes supported schedule types", () => {
    expect(normalizeScheduleType("cron")).toBe("cron");
    expect(normalizeScheduleType("INTERVAL")).toBe("interval");
    expect(normalizeScheduleType(" manual ")).toBe("manual");
  });

  it("rejects unsupported schedule types", () => {
    expect(() => normalizeScheduleType("weekly")).toThrow(/Unsupported schedule type/);
  });

  it("validates interval expressions", () => {
    expect(validateScheduleDefinition("interval", "every-300s")).toEqual({
      scheduleType: "interval",
      expression: "every-300s",
    });
    expect(() => validateScheduleDefinition("interval", "later")).toThrow(/Unsupported interval expression/);
  });

  it("computes the next interval run", () => {
    const now = new Date("2026-03-21T20:00:00.000Z");
    const next = computeNextScheduleRun("interval", "5m", now);
    expect(next?.toISOString()).toBe("2026-03-21T20:05:00.000Z");
  });

  it("computes the next cron run in UTC", () => {
    const now = new Date("2026-03-21T20:45:11.000Z");
    const next = computeNextScheduleRun("cron", "0 2 * * *", now);
    expect(next?.toISOString()).toBe("2026-03-22T02:00:00.000Z");
  });

  it("returns null for manual schedules", () => {
    expect(computeNextScheduleRun("manual", "on-demand", new Date("2026-03-21T20:45:11.000Z"))).toBeNull();
  });

  it("round-trips control-plane timestamps", () => {
    const timestamp = "2026-03-21 20:45:11";
    expect(formatControlPlaneTimestamp(parseControlPlaneTimestamp(timestamp))).toBe(timestamp);
  });
});
