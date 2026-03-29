import type { ChannelAccountRecord, ChannelRecord, InboxMessageRecord } from "./api.js";

export type InboxDirectionFilter = "all" | "in" | "out";
export type InboxRoleFilter = "all" | "user" | "assistant" | "system";

export interface InboxFilterOptions {
  query: string;
  direction: InboxDirectionFilter;
  role: InboxRoleFilter;
}

function normalizeSearchValue(value: string): string {
  return value.trim().toLowerCase();
}

function stringifySearchableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function joinSearchableValues(values: unknown[]): string {
  return values
    .map((value) => stringifySearchableValue(value))
    .filter((value) => value.length > 0)
    .join(" ")
    .toLowerCase();
}

export function filterChannelAccounts(accounts: ChannelAccountRecord[], query: string): ChannelAccountRecord[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return accounts;

  return accounts.filter((account) => {
    const metadata = account.metadata ?? {};
    const searchable = joinSearchableValues([
      account.name,
      account.type,
      metadata.owner,
      metadata.defaultRouteHint,
      metadata,
    ]);
    return searchable.includes(normalizedQuery);
  });
}

export function filterChannels(channels: ChannelRecord[], query: string): ChannelRecord[] {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) return channels;

  return channels.filter((channel) => {
    const settings = channel.settings ?? {};
    const searchable = joinSearchableValues([
      channel.name,
      channel.displayName,
      channel.accountName,
      channel.accountType,
      settings.routeHint,
      settings.allowlist,
      settings,
    ]);
    return searchable.includes(normalizedQuery);
  });
}

export function filterInboxMessages(
  messages: InboxMessageRecord[],
  options: InboxFilterOptions,
): InboxMessageRecord[] {
  const normalizedQuery = normalizeSearchValue(options.query);

  return messages.filter((message) => {
    if (options.direction !== "all" && message.direction !== options.direction) {
      return false;
    }
    if (options.role !== "all" && message.role !== options.role) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }

    const searchable = joinSearchableValues([
      message.content,
      message.direction,
      message.role,
      message.channel.name,
      message.channel.displayName,
      message.account.name,
      message.account.type,
      message.metadata,
    ]);
    return searchable.includes(normalizedQuery);
  });
}

export function getInboxBeforeId(messages: InboxMessageRecord[]): number | undefined {
  return messages[0]?.id;
}

export function prependInboxMessages(
  existingMessages: InboxMessageRecord[],
  olderMessages: InboxMessageRecord[],
): InboxMessageRecord[] {
  if (olderMessages.length === 0) return existingMessages;

  const seenIds = new Set(existingMessages.map((message) => message.id));
  const merged = [
    ...olderMessages.filter((message) => !seenIds.has(message.id)),
    ...existingMessages,
  ];
  return merged.slice().sort((left, right) => left.id - right.id);
}
