import { describe, expect, it } from "vitest";
import { buildChannelApiExamples } from "../packages/dashboard/src/lib/channels-api-quickstart.js";

describe("channel API quickstart helpers", () => {
  it("always includes a base account discovery example", () => {
    const examples = buildChannelApiExamples({
      account: null,
      channel: null,
    });

    expect(examples.map((example) => example.id)).toEqual(["list-channel-accounts"]);
    expect(examples[0].snippet).toContain('curl -sS "$MAX_API_URL/channels/accounts"');
  });

  it("adds account-scoped channel examples when an account is selected", () => {
    const examples = buildChannelApiExamples({
      account: {
        id: 7,
        type: "telegram",
        name: "support-bot",
        metadata: {
          owner: "support",
          defaultRouteHint: "customer-support",
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
      channel: null,
    });

    expect(examples.map((example) => example.id)).toEqual([
      "list-channel-accounts",
      "list-account-channels",
      "create-channel",
    ]);
    expect(examples[1].snippet).toContain("channels/accounts/7/channels");
    expect(examples[2].snippet).toContain('"displayName": "Ops Triage"');
  });

  it("adds channel-specific message, inbox, and patch examples", () => {
    const examples = buildChannelApiExamples({
      account: {
        id: 3,
        type: "tui",
        name: "ops",
        metadata: {
          defaultRouteHint: "incident-triage",
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
      channel: {
        id: 11,
        accountId: 3,
        accountType: "tui",
        accountName: "ops",
        name: "incident-room",
        displayName: "Incident Triage",
        icon: null,
        settings: {
          routeHint: "incident-triage",
        },
        createdAt: "2026-03-22T00:00:00.000Z",
        updatedAt: "2026-03-22T00:00:00.000Z",
        deletedAt: null,
      },
    });

    expect(examples.map((example) => example.id)).toEqual([
      "list-channel-accounts",
      "list-account-channels",
      "create-channel",
      "send-explicit-channel-message",
      "send-routed-message",
      "read-channel-inbox",
      "patch-channel-policy",
    ]);
    expect(examples[3].snippet).toContain('"channelId": 11');
    expect(examples[3].snippet).toContain('"senderId": "tui:operator-demo"');
    expect(examples[4].snippet).toContain('"routeHint": "incident-triage"');
    expect(examples[5].snippet).toContain('channels/11/inbox?limit=50');
    expect(examples[6].snippet).toContain('PATCH "$MAX_API_URL/channels/11"');
  });
});
