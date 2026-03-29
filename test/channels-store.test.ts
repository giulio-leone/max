import { mkdirSync, rmSync } from "fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const hoisted = vi.hoisted(() => {
  const tempHome = `/tmp/max-channels-store-${Math.random().toString(36).slice(2)}`;
  return {
    tempHome,
    dbPath: `${tempHome}/max.db`,
  };
});

vi.mock("../src/paths.js", () => ({
  DB_PATH: hoisted.dbPath,
  ensureMaxHome: () => {
    mkdirSync(hoisted.tempHome, { recursive: true });
  },
}));

describe("channel inbox store", () => {
  beforeEach(() => {
    rmSync(hoisted.tempHome, { recursive: true, force: true });
    mkdirSync(hoisted.tempHome, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    rmSync(hoisted.tempHome, { recursive: true, force: true });
  });

  it("creates default telegram routing and stores chronological inbox history", async () => {
    const db = await import("../src/store/db.js");
    const resolved = db.resolveMessageSourceChannel({
      type: "telegram",
      chatId: 42,
      messageId: 7,
    });

    expect(resolved.resolution).toBe("default");
    expect(resolved.account.type).toBe("telegram");
    expect(resolved.channel.name).toBe("chat-42");

    db.createInboxMessage({
      channelId: resolved.channel.id,
      direction: "in",
      role: "user",
      content: "hello from telegram",
      metadata: { chatId: 42 },
    });
    db.createInboxMessage({
      channelId: resolved.channel.id,
      direction: "out",
      role: "assistant",
      content: "hello back",
      metadata: { chatId: 42 },
    });

    const inbox = db.listChannelInbox(resolved.channel.id);
    expect(inbox).toHaveLength(2);
    expect(inbox.map((message) => message.content)).toEqual([
      "hello from telegram",
      "hello back",
    ]);
    expect(inbox[0].account.type).toBe("telegram");
    expect(inbox[0].channel.name).toBe("chat-42");
  });

  it("supports manual channel lifecycle while retaining inbox history after soft delete", async () => {
    const db = await import("../src/store/db.js");
    const account = db.createChannelAccount({
      type: "tui",
      name: "ops",
      metadata: { owner: "ops-team" },
    });
    const channel = db.createChannel({
      accountId: account.id,
      name: "triage",
      displayName: "Ops Triage",
      settings: { priority: "high" },
    });

    const updated = db.updateChannel(channel.id, {
      displayName: "Ops Inbox",
      icon: "inbox",
    });

    expect(updated.displayName).toBe("Ops Inbox");
    expect(updated.icon).toBe("inbox");

    db.createInboxMessage({
      channelId: channel.id,
      direction: "in",
      role: "user",
      content: "new incident",
      metadata: { severity: "high" },
    });

    expect(db.listChannels({ accountId: account.id })).toHaveLength(1);
    expect(db.deleteChannel(channel.id)).toBe(true);
    expect(db.getChannel(channel.id)).toBeUndefined();
    expect(db.getChannel(channel.id, { includeDeleted: true })?.deletedAt).toBeTruthy();
    expect(db.listChannelInbox(channel.id)).toHaveLength(1);
  });

  it("resolves route hints and enforces allowlist-only channels", async () => {
    const db = await import("../src/store/db.js");
    const account = db.createChannelAccount({
      type: "tui",
      name: "ops",
    });
    const channel = db.createChannel({
      accountId: account.id,
      name: "incident-room",
      settings: {
        routeHint: "incident-triage",
        allowlistMode: "allowlist",
        allowlist: ["operator-1"],
      },
    });

    const allowed = db.resolveMessageChannelAccess({
      type: "tui",
      connectionId: "conn-1",
      routeHint: "incident-triage",
      senderId: "operator-1",
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.resolution.channel.id).toBe(channel.id);
    expect(allowed.resolution.resolution).toBe("route-hint");

    const denied = db.resolveMessageChannelAccess({
      type: "tui",
      connectionId: "conn-2",
      routeHint: "incident-triage",
      senderId: "operator-2",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.denialReason).toMatch(/allowlist-only/i);
  });

  it("inherits account-level allowlists and lets explicit channel ids win over route hints", async () => {
    const db = await import("../src/store/db.js");
    const account = db.createChannelAccount({
      type: "tui",
      name: "ops",
      metadata: {
        allowlistMode: "allowlist",
        allowlist: ["tui:trusted-conn"],
      },
    });
    db.createChannel({
      accountId: account.id,
      name: "incident-room",
      settings: {
        routeHint: "incident-triage",
      },
    });
    const explicitChannel = db.createChannel({
      accountId: account.id,
      name: "private-room",
    });

    const allowed = db.resolveMessageChannelAccess({
      type: "tui",
      connectionId: "trusted-conn",
      channelId: explicitChannel.id,
      routeHint: "incident-triage",
    });
    expect(allowed.allowed).toBe(true);
    expect(allowed.resolution.channel.id).toBe(explicitChannel.id);
    expect(allowed.resolution.resolution).toBe("explicit");
    expect(allowed.policy.allowlist).toEqual(["tui:trusted-conn"]);

    const denied = db.resolveMessageChannelAccess({
      type: "tui",
      connectionId: "untrusted-conn",
      channelId: explicitChannel.id,
      routeHint: "incident-triage",
    });
    expect(denied.allowed).toBe(false);
    expect(denied.resolution.channel.id).toBe(explicitChannel.id);
    expect(denied.denialReason).toContain("untrusted-conn");
  });
});
