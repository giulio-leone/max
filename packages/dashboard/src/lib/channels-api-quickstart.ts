import type { ChannelAccountRecord, ChannelRecord } from "@/lib/api";

export interface ChannelApiExample {
  id: string;
  title: string;
  description: string;
  copyLabel: string;
  snippet: string;
}

function getAccountDefaultRouteHint(account: ChannelAccountRecord | null): string | null {
  const value = account?.metadata?.defaultRouteHint;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function getChannelRouteHint(channel: ChannelRecord | null): string | null {
  const value = channel?.settings?.routeHint;
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function buildBaseCurl(command: string) {
  return [
    "MAX_API_URL=http://localhost:7777",
    'MAX_API_TOKEN="${MAX_API_TOKEN:-$(cat ~/.max/api-token)}"',
    "",
    command,
  ].join("\n");
}

function buildJsonSnippet(lines: string[]) {
  return lines.join("\n");
}

export function buildChannelApiExamples(input: {
  account: ChannelAccountRecord | null;
  channel: ChannelRecord | null;
}): ChannelApiExample[] {
  const { account, channel } = input;
  const examples: ChannelApiExample[] = [
    {
      id: "list-channel-accounts",
      title: "List channel accounts",
      description: "Inspect the configured provider accounts and their saved metadata before changing route policy.",
      copyLabel: "List channel accounts example",
      snippet: buildBaseCurl(
        'curl -sS "$MAX_API_URL/channels/accounts" \\\n' +
        '  -H "Authorization: Bearer $MAX_API_TOKEN"'
      ),
    },
  ];

  if (account) {
    examples.push({
      id: "list-account-channels",
      title: "List channels for the selected account",
      description: "Fetch the current channels under the focused provider account so you can inspect route hints and allowlists.",
      copyLabel: "List account channels example",
      snippet: buildBaseCurl(
        `curl -sS "$MAX_API_URL/channels/accounts/${account.id}/channels" \\\n` +
        '  -H "Authorization: Bearer $MAX_API_TOKEN"'
      ),
    });

    examples.push({
      id: "create-channel",
      title: "Create a channel under the selected account",
      description: "Create a new channel with a display name and optional route hint/settings payload.",
      copyLabel: "Create channel example",
      snippet: buildBaseCurl(
        `curl -sS -X POST "$MAX_API_URL/channels/accounts/${account.id}/channels" \\\n` +
        '  -H "Authorization: Bearer $MAX_API_TOKEN" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        `  -d '${buildJsonSnippet([
          "{",
          '  "name": "triage",',
          '  "displayName": "Ops Triage",',
          '  "settings": {',
          '    "routeHint": "incident-triage"',
          "  }",
          "}",
        ])}'`
      ),
    });
  }

  if (!channel) {
    return examples;
  }

  const routeHint = getChannelRouteHint(channel) ?? getAccountDefaultRouteHint(account);
  const senderPrefix = account?.type ?? "tui";
  const senderId = `${senderPrefix}:operator-demo`;

  examples.push({
    id: "send-explicit-channel-message",
    title: "Send a message to the selected channel",
    description: "Drive ingress explicitly to the focused channel with `channelId`, bypassing route-hint resolution.",
    copyLabel: "Send explicit channel message example",
    snippet: buildBaseCurl(
      'curl -sS -X POST "$MAX_API_URL/message" \\\n' +
      '  -H "Authorization: Bearer $MAX_API_TOKEN" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      `  -d '${buildJsonSnippet([
        "{",
        '  "text": "Triage the latest issue",',
        `  "channelId": ${channel.id},`,
        `  "senderId": "${senderId}"`,
        "}",
      ])}'`
    ),
  });

  if (routeHint) {
    examples.push({
      id: "send-routed-message",
      title: "Route a message by saved hint and sender identity",
      description: "Let Max resolve the target channel using `routeHint`, account defaults, and the allowlist-aware sender identity.",
      copyLabel: "Send routed message example",
      snippet: buildBaseCurl(
        'curl -sS -X POST "$MAX_API_URL/message" \\\n' +
        '  -H "Authorization: Bearer $MAX_API_TOKEN" \\\n' +
        '  -H "Content-Type: application/json" \\\n' +
        `  -d '${buildJsonSnippet([
          "{",
          '  "text": "Route this via saved policy",',
          `  "routeHint": "${routeHint}",`,
          `  "senderId": "${senderId}"`,
          "}",
        ])}'`
      ),
    });
  }

  examples.push({
    id: "read-channel-inbox",
    title: "Read the latest inbox history",
    description: "Fetch the persisted ingress/egress timeline for the selected channel using the same store that powers the dashboard inbox.",
    copyLabel: "Read channel inbox example",
    snippet: buildBaseCurl(
      `curl -sS "$MAX_API_URL/channels/${channel.id}/inbox?limit=50" \\\n` +
      '  -H "Authorization: Bearer $MAX_API_TOKEN"'
    ),
  });

  examples.push({
    id: "patch-channel-policy",
    title: "Update the selected channel policy",
    description: "Patch route policy or advanced settings in place without recreating the channel record.",
    copyLabel: "Patch channel policy example",
    snippet: buildBaseCurl(
      `curl -sS -X PATCH "$MAX_API_URL/channels/${channel.id}" \\\n` +
      '  -H "Authorization: Bearer $MAX_API_TOKEN" \\\n' +
      '  -H "Content-Type: application/json" \\\n' +
      `  -d '${buildJsonSnippet([
        "{",
        `  "displayName": "${channel.displayName ?? "Ops Triage"}",`,
        '  "settings": {',
        `    "routeHint": "${routeHint ?? "incident-triage"}",`,
        '    "priority": "high"',
        "  }",
        "}",
      ])}'`
    ),
  });

  return examples;
}
