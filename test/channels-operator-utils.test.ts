import { describe, expect, it } from "vitest";
import {
  filterChannelAccounts,
  filterChannels,
  filterInboxMessages,
  getInboxBeforeId,
  prependInboxMessages,
  type InboxFilterOptions,
} from "../packages/dashboard/src/lib/channels-operator.js";

describe("channel operator helpers", () => {
  it("filters channel accounts by owner and default route hint metadata", () => {
    const accounts = [
      {
        id: 1,
        type: "tui" as const,
        name: "ops",
        metadata: {
          owner: "ops-team",
          defaultRouteHint: "incident-triage",
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: 2,
        type: "telegram" as const,
        name: "support-bot",
        metadata: {
          owner: "support",
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
    ];

    expect(filterChannelAccounts(accounts, "ops-team").map((account) => account.id)).toEqual([1]);
    expect(filterChannelAccounts(accounts, "incident-triage").map((account) => account.id)).toEqual([1]);
    expect(filterChannelAccounts(accounts, "telegram").map((account) => account.id)).toEqual([2]);
  });

  it("filters channels by route hint, display name, and account context", () => {
    const channels = [
      {
        id: 11,
        accountId: 1,
        accountType: "tui" as const,
        accountName: "ops",
        name: "incident-room",
        displayName: "Incident Triage",
        icon: null,
        settings: {
          routeHint: "incident-triage",
          allowlist: ["operator-1"],
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
      {
        id: 12,
        accountId: 2,
        accountType: "background" as const,
        accountName: "background",
        name: "system-events",
        displayName: "System Events",
        icon: null,
        settings: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
    ];

    expect(filterChannels(channels, "incident-triage").map((channel) => channel.id)).toEqual([11]);
    expect(filterChannels(channels, "system events").map((channel) => channel.id)).toEqual([12]);
    expect(filterChannels(channels, "ops").map((channel) => channel.id)).toEqual([11]);
  });

  it("filters inbox messages by direction, role, content, and metadata", () => {
    const messages = [
      {
        id: 101,
        channelId: 11,
        direction: "in" as const,
        role: "user" as const,
        content: "Need help with incident triage",
        metadata: { senderId: "operator-1", ticket: "INC-42" },
        createdAt: "2026-03-22T00:01:00.000Z",
        channel: {
          id: 11,
          name: "incident-room",
          displayName: "Incident Triage",
          icon: null,
        },
        account: {
          id: 1,
          type: "tui" as const,
          name: "ops",
        },
      },
      {
        id: 102,
        channelId: 11,
        direction: "out" as const,
        role: "system" as const,
        content: "Channel is allowlist-only",
        metadata: { reason: "sender missing" },
        createdAt: "2026-03-22T00:02:00.000Z",
        channel: {
          id: 11,
          name: "incident-room",
          displayName: "Incident Triage",
          icon: null,
        },
        account: {
          id: 1,
          type: "tui" as const,
          name: "ops",
        },
      },
    ];

    const systemFilter: InboxFilterOptions = {
      query: "allowlist",
      direction: "out",
      role: "system",
    };
    expect(filterInboxMessages(messages, systemFilter).map((message) => message.id)).toEqual([102]);

    const metadataFilter: InboxFilterOptions = {
      query: "INC-42",
      direction: "all",
      role: "all",
    };
    expect(filterInboxMessages(messages, metadataFilter).map((message) => message.id)).toEqual([101]);
  });

  it("computes inbox cursors and prepends older pages without duplicates", () => {
    const olderMessages = [
      {
        id: 99,
        channelId: 11,
        direction: "in" as const,
        role: "user" as const,
        content: "Older incident context",
        metadata: null,
        createdAt: "2026-03-22T00:00:00.000Z",
        channel: {
          id: 11,
          name: "incident-room",
          displayName: "Incident Triage",
          icon: null,
        },
        account: {
          id: 1,
          type: "tui" as const,
          name: "ops",
        },
      },
      {
        id: 100,
        channelId: 11,
        direction: "out" as const,
        role: "assistant" as const,
        content: "Previous response",
        metadata: null,
        createdAt: "2026-03-22T00:00:30.000Z",
        channel: {
          id: 11,
          name: "incident-room",
          displayName: "Incident Triage",
          icon: null,
        },
        account: {
          id: 1,
          type: "tui" as const,
          name: "ops",
        },
      },
    ];
    const currentMessages = [
      {
        id: 100,
        channelId: 11,
        direction: "out" as const,
        role: "assistant" as const,
        content: "Previous response",
        metadata: null,
        createdAt: "2026-03-22T00:00:30.000Z",
        channel: {
          id: 11,
          name: "incident-room",
          displayName: "Incident Triage",
          icon: null,
        },
        account: {
          id: 1,
          type: "tui" as const,
          name: "ops",
        },
      },
      {
        id: 101,
        channelId: 11,
        direction: "in" as const,
        role: "user" as const,
        content: "Current incident triage request",
        metadata: null,
        createdAt: "2026-03-22T00:01:00.000Z",
        channel: {
          id: 11,
          name: "incident-room",
          displayName: "Incident Triage",
          icon: null,
        },
        account: {
          id: 1,
          type: "tui" as const,
          name: "ops",
        },
      },
    ];

    expect(getInboxBeforeId(currentMessages)).toBe(100);
    expect(prependInboxMessages(currentMessages, olderMessages).map((message) => message.id)).toEqual([
      99,
      100,
      101,
    ]);
  });
});
