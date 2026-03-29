import { describe, expect, it } from "vitest";
import {
  indexWorkersByControlAgentId,
  resolveChannelAccountFocus,
} from "../packages/dashboard/src/lib/operator-context.js";

describe("operator context helpers", () => {
  it("resolves a focused account selection from an account type filter", () => {
    const focus = resolveChannelAccountFocus([
      {
        id: 1,
        type: "tui",
        name: "ops",
        metadata: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: 2,
        type: "telegram",
        name: "support",
        metadata: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
    ], "telegram");

    expect(focus).toEqual({
      accountQuery: "telegram",
      selectedAccountId: "2",
      notice: "Focused telegram channel accounts.",
    });
  });

  it("keeps the filter text even when no matching account exists", () => {
    const focus = resolveChannelAccountFocus([], "background");

    expect(focus).toEqual({
      accountQuery: "background",
      selectedAccountId: null,
      notice: "Filtering accounts for background.",
    });
  });

  it("indexes only workers that expose a controlAgentId", () => {
    const map = indexWorkersByControlAgentId([
      {
        name: "control-agent-9",
        workingDir: "/tmp/max",
        status: "running",
        controlAgentId: 9,
        originChannel: "telegram",
      },
      {
        name: "machine-max",
        workingDir: "/tmp/max",
        status: "idle",
        sessionSource: "machine",
        controlAgentId: null,
      },
    ]);

    expect(Array.from(map.keys())).toEqual([9]);
    expect(map.get(9)).toMatchObject({
      name: "control-agent-9",
      originChannel: "telegram",
    });
  });
});
