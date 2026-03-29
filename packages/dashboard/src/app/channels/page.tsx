"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createChannel,
  createChannelAccount,
  deleteChannel,
  deleteChannelAccount,
  fetchChannelAccounts,
  fetchChannelInbox,
  fetchChannels,
  updateChannel,
  updateChannelAccount,
  type ChannelAccountRecord,
  type ChannelAccountType,
  type ChannelRecord,
  type InboxMessageRecord,
} from "@/lib/api";
import {
  buildChannelApiExamples,
  type ChannelApiExample,
} from "@/lib/channels-api-quickstart";
import {
  filterChannelAccounts,
  filterChannels,
  filterInboxMessages,
  getInboxBeforeId,
  prependInboxMessages,
  type InboxDirectionFilter,
  type InboxRoleFilter,
} from "@/lib/channels-operator";
import { resolveChannelAccountFocus } from "@/lib/operator-context";

const ACCOUNT_TYPE_OPTIONS: Array<{
  id: ChannelAccountType;
  label: string;
  description: string;
}> = [
  {
    id: "tui",
    label: "Terminal / SSE",
    description: "Default account for `/message` and other TUI/SSE-originated turns.",
  },
  {
    id: "telegram",
    label: "Telegram",
    description: "Provider-level account for Telegram chats and their auto-created channels.",
  },
  {
    id: "background",
    label: "Background",
    description: "System-facing account for background completions and internal inbox events.",
  },
];

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString();
}

function prettyJson(value: Record<string, unknown> | null | undefined) {
  return value ? JSON.stringify(value, null, 2) : "";
}

type AllowlistMode = "open" | "allowlist";

function normalizeAllowlistEntries(value: string) {
  return value
    .split(/[\n,]/g)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === "string")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function parseJsonObjectInput(value: string, label: string): Record<string, unknown> | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = JSON.parse(trimmed) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function extractAccountPolicy(metadata: Record<string, unknown> | null | undefined) {
  const base = metadata ? { ...metadata } : {};
  const owner = typeof base.owner === "string" ? base.owner : "";
  delete base.owner;
  const defaultRouteHint = typeof base.defaultRouteHint === "string" ? base.defaultRouteHint : "";
  delete base.defaultRouteHint;
  const allowlist = readStringArray(base.allowlist);
  delete base.allowlist;
  const allowlistMode: AllowlistMode = base.allowlistMode === "allowlist" || allowlist.length > 0
    ? "allowlist"
    : "open";
  delete base.allowlistMode;

  return {
    owner,
    defaultRouteHint,
    allowlistMode,
    allowlistText: allowlist.join("\n"),
    rawMetadata: prettyJson(Object.keys(base).length > 0 ? base : null),
  };
}

function buildAccountMetadata(input: {
  owner: string;
  defaultRouteHint: string;
  allowlistMode: AllowlistMode;
  allowlistText: string;
  rawMetadata: string;
}) {
  const base = parseJsonObjectInput(input.rawMetadata, "Advanced account metadata") ?? {};
  const next: Record<string, unknown> = { ...base };

  const owner = input.owner.trim();
  if (owner) next.owner = owner;
  else delete next.owner;

  const defaultRouteHint = input.defaultRouteHint.trim();
  if (defaultRouteHint) next.defaultRouteHint = defaultRouteHint;
  else delete next.defaultRouteHint;

  const allowlist = normalizeAllowlistEntries(input.allowlistText);
  if (input.allowlistMode === "allowlist") {
    next.allowlistMode = "allowlist";
    next.allowlist = allowlist;
  } else {
    delete next.allowlistMode;
    delete next.allowlist;
  }

  return Object.keys(next).length > 0 ? next : null;
}

function extractChannelPolicy(settings: Record<string, unknown> | null | undefined) {
  const base = settings ? { ...settings } : {};
  const routeHint = typeof base.routeHint === "string" ? base.routeHint : "";
  delete base.routeHint;
  const allowlist = readStringArray(base.allowlist);
  delete base.allowlist;
  const allowlistMode: AllowlistMode = base.allowlistMode === "allowlist" || allowlist.length > 0
    ? "allowlist"
    : "open";
  delete base.allowlistMode;

  return {
    routeHint,
    allowlistMode,
    allowlistText: allowlist.join("\n"),
    rawSettings: prettyJson(Object.keys(base).length > 0 ? base : null),
  };
}

function buildChannelSettings(input: {
  routeHint: string;
  allowlistMode: AllowlistMode;
  allowlistText: string;
  rawSettings: string;
}) {
  const base = parseJsonObjectInput(input.rawSettings, "Advanced channel settings") ?? {};
  const next: Record<string, unknown> = { ...base };

  const routeHint = input.routeHint.trim();
  if (routeHint) next.routeHint = routeHint;
  else delete next.routeHint;

  const allowlist = normalizeAllowlistEntries(input.allowlistText);
  if (input.allowlistMode === "allowlist") {
    next.allowlistMode = "allowlist";
    next.allowlist = allowlist;
  } else {
    delete next.allowlistMode;
    delete next.allowlist;
  }

  return Object.keys(next).length > 0 ? next : null;
}

function inputClassName() {
  return "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:border-[var(--accent)] focus:outline-none";
}

function textareaClassName() {
  return `${inputClassName()} min-h-[120px] font-mono text-xs leading-6`;
}

function cardClassName() {
  return "rounded-xl border border-[var(--border)] bg-[var(--bg-card)]";
}

function buttonClassName(variant: "primary" | "secondary" | "danger" = "secondary") {
  if (variant === "primary") {
    return "rounded-lg bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50";
  }
  if (variant === "danger") {
    return "rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[rgb(248,113,113)] transition hover:bg-[rgba(239,68,68,0.18)] disabled:cursor-not-allowed disabled:opacity-50";
  }
  return "rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)] transition hover:bg-[var(--bg-card-hover)] disabled:cursor-not-allowed disabled:opacity-50";
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      {children}
      {hint ? <p className="text-xs text-[var(--text-muted)]">{hint}</p> : null}
    </label>
  );
}

function InboxItem({ message }: { message: InboxMessageRecord }) {
  const accent = message.direction === "out"
    ? "border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.10)]"
    : message.role === "system"
      ? "border-[rgba(168,85,247,0.35)] bg-[rgba(168,85,247,0.10)]"
      : "border-[var(--border)] bg-[var(--bg)]";

  return (
    <div className={`rounded-xl border p-3 ${accent}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-[var(--text-muted)]">
          <span>{message.direction}</span>
          <span>•</span>
          <span>{message.role}</span>
        </div>
        <span className="text-xs text-[var(--text-muted)]">{formatTimestamp(message.createdAt)}</span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text)]">{message.content}</p>
      {message.metadata ? (
        <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--bg)] p-3 text-xs text-[var(--text-muted)]">
          {JSON.stringify(message.metadata, null, 2)}
        </pre>
      ) : null}
    </div>
  );
}

export default function ChannelsPage() {
  const inboxPageSizeOptions = [25, 50, 100] as const;
  const [accounts, setAccounts] = useState<ChannelAccountRecord[]>([]);
  const [channels, setChannels] = useState<ChannelRecord[]>([]);
  const [inbox, setInbox] = useState<InboxMessageRecord[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState("");
  const [selectedChannelId, setSelectedChannelId] = useState("");
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingChannels, setLoadingChannels] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingOlderInbox, setLoadingOlderInbox] = useState(false);
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [accountQuery, setAccountQuery] = useState("");
  const [channelQuery, setChannelQuery] = useState("");
  const [inboxQuery, setInboxQuery] = useState("");
  const [inboxDirection, setInboxDirection] = useState<InboxDirectionFilter>("all");
  const [inboxRole, setInboxRole] = useState<InboxRoleFilter>("all");
  const [inboxPageSize, setInboxPageSize] = useState<(typeof inboxPageSizeOptions)[number]>(100);
  const [hasOlderInbox, setHasOlderInbox] = useState(false);
  const [urlAccountTypeFilter, setUrlAccountTypeFilter] = useState<string | null>(null);
  const [appliedAccountTypeFilter, setAppliedAccountTypeFilter] = useState<string | null>(null);

  const [accountForm, setAccountForm] = useState({
    type: "tui" as ChannelAccountType,
    name: "",
    owner: "",
    defaultRouteHint: "",
    allowlistMode: "open" as AllowlistMode,
    allowlistText: "",
    rawMetadata: "",
  });
  const [channelForm, setChannelForm] = useState({
    name: "",
    displayName: "",
    icon: "",
    routeHint: "",
    allowlistMode: "open" as AllowlistMode,
    allowlistText: "",
    rawSettings: "",
  });
  const [editingAccountId, setEditingAccountId] = useState<number | null>(null);
  const [editingChannelId, setEditingChannelId] = useState<number | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((account) => String(account.id) === selectedAccountId) ?? null,
    [accounts, selectedAccountId]
  );
  const selectedChannel = useMemo(
    () => channels.find((channel) => String(channel.id) === selectedChannelId) ?? null,
    [channels, selectedChannelId]
  );
  const selectedChannelPolicy = useMemo(
    () => extractChannelPolicy(selectedChannel?.settings),
    [selectedChannel],
  );
  const filteredAccounts = useMemo(
    () => filterChannelAccounts(accounts, accountQuery),
    [accounts, accountQuery],
  );
  const filteredChannels = useMemo(
    () => filterChannels(channels, channelQuery),
    [channels, channelQuery],
  );
  const filteredInbox = useMemo(
    () => filterInboxMessages(inbox, {
      query: inboxQuery,
      direction: inboxDirection,
      role: inboxRole,
    }),
    [inbox, inboxDirection, inboxQuery, inboxRole],
  );
  const apiExamples = useMemo(
    () => buildChannelApiExamples({
      account: selectedAccount,
      channel: selectedChannel,
    }),
    [selectedAccount, selectedChannel],
  );
  const inboxFiltersActive = inboxQuery.trim().length > 0 || inboxDirection !== "all" || inboxRole !== "all";

  const loadAccounts = useCallback(async () => {
    setLoadingAccounts(true);
    try {
      const data = await fetchChannelAccounts();
      setAccounts(data);
      setSelectedAccountId((prev) => {
        if (prev && data.some((account) => String(account.id) === prev)) {
          return prev;
        }
        return data[0] ? String(data[0].id) : "";
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channel accounts");
    } finally {
      setLoadingAccounts(false);
    }
  }, []);

  const loadChannelsForAccount = useCallback(async (accountId: string) => {
    if (!accountId) {
      setChannels([]);
      setSelectedChannelId("");
      return;
    }

    setLoadingChannels(true);
    try {
      const data = await fetchChannels(Number(accountId));
      setChannels(data);
      setSelectedChannelId((prev) => {
        if (prev && data.some((channel) => String(channel.id) === prev)) {
          return prev;
        }
        return data[0] ? String(data[0].id) : "";
      });
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load channels");
    } finally {
      setLoadingChannels(false);
    }
  }, []);

  const loadInboxForChannel = useCallback(async (
    channelId: string,
    options?: { beforeId?: number; appendOlder?: boolean },
  ) => {
    if (!channelId) {
      setInbox([]);
      setHasOlderInbox(false);
      return;
    }

    if (options?.appendOlder) {
      setLoadingOlderInbox(true);
    } else {
      setLoadingInbox(true);
    }
    try {
      const data = await fetchChannelInbox(Number(channelId), {
        limit: inboxPageSize,
        ...(options?.beforeId ? { beforeId: options.beforeId } : {}),
      });
      setInbox((currentMessages) => options?.appendOlder
        ? prependInboxMessages(currentMessages, data.messages)
        : data.messages);
      setHasOlderInbox(data.messages.length === inboxPageSize);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inbox messages");
    } finally {
      if (options?.appendOlder) {
        setLoadingOlderInbox(false);
      } else {
        setLoadingInbox(false);
      }
    }
  }, [inboxPageSize]);

  useEffect(() => {
    void loadAccounts();
  }, [loadAccounts]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const accountType = new URLSearchParams(window.location.search).get("accountType");
    setUrlAccountTypeFilter(accountType);
  }, []);

  useEffect(() => {
    const accountType = urlAccountTypeFilter;
    if (!accountType || accountType === appliedAccountTypeFilter) {
      return;
    }

    const focus = resolveChannelAccountFocus(accounts, accountType);
    setAccountQuery(focus.accountQuery);
    if (focus.selectedAccountId) {
      setSelectedAccountId(focus.selectedAccountId);
    }
    setNotice(focus.notice);
    setAppliedAccountTypeFilter(accountType);
  }, [accounts, appliedAccountTypeFilter, urlAccountTypeFilter]);

  useEffect(() => {
    void loadChannelsForAccount(selectedAccountId);
  }, [loadChannelsForAccount, selectedAccountId]);

  useEffect(() => {
    void loadInboxForChannel(selectedChannelId);
  }, [loadInboxForChannel, selectedChannelId]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2500);
    return () => window.clearTimeout(timer);
  }, [notice]);

  async function submitAction(key: string, action: () => Promise<void>) {
    setSubmitting(key);
    try {
      await action();
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setSubmitting(null);
    }
  }

  async function copyToClipboard(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Failed to copy ${label.toLowerCase()}`);
    }
  }

  function resetAccountForm() {
    setAccountForm({
      type: "tui",
      name: "",
      owner: "",
      defaultRouteHint: "",
      allowlistMode: "open",
      allowlistText: "",
      rawMetadata: "",
    });
    setEditingAccountId(null);
  }

  function resetChannelForm() {
    setChannelForm({
      name: "",
      displayName: "",
      icon: "",
      routeHint: "",
      allowlistMode: "open",
      allowlistText: "",
      rawSettings: "",
    });
    setEditingChannelId(null);
  }

  function beginAccountEdit(account: ChannelAccountRecord) {
    const policy = extractAccountPolicy(account.metadata);
    setEditingAccountId(account.id);
    setAccountForm({
      type: account.type,
      name: account.name,
      owner: policy.owner,
      defaultRouteHint: policy.defaultRouteHint,
      allowlistMode: policy.allowlistMode,
      allowlistText: policy.allowlistText,
      rawMetadata: policy.rawMetadata,
    });
    setSelectedAccountId(String(account.id));
  }

  function beginChannelEdit(channel: ChannelRecord) {
    const policy = extractChannelPolicy(channel.settings);
    setEditingChannelId(channel.id);
    setChannelForm({
      name: channel.name,
      displayName: channel.displayName ?? "",
      icon: channel.icon ?? "",
      routeHint: policy.routeHint,
      allowlistMode: policy.allowlistMode,
      allowlistText: policy.allowlistText,
      rawSettings: policy.rawSettings,
    });
    setSelectedChannelId(String(channel.id));
  }

  async function saveAccount() {
    const metadata = buildAccountMetadata(accountForm);
    await submitAction(editingAccountId ? `account-save-${editingAccountId}` : "account-create", async () => {
      const record = editingAccountId
        ? await updateChannelAccount(editingAccountId, {
          name: accountForm.name,
          metadata,
        })
        : await createChannelAccount({
          type: accountForm.type,
          name: accountForm.name,
          metadata,
        });

      await loadAccounts();
      setSelectedAccountId(String(record.id));
      resetAccountForm();
    });
  }

  async function removeAccount(account: ChannelAccountRecord) {
    await submitAction(`account-delete-${account.id}`, async () => {
      await deleteChannelAccount(account.id);
      await loadAccounts();
      if (String(account.id) === selectedAccountId) {
        setChannels([]);
        setSelectedChannelId("");
        setInbox([]);
      }
      if (editingAccountId === account.id) {
        resetAccountForm();
      }
    });
  }

  async function saveChannel() {
    if (!selectedAccount) {
      setError("Select a channel account before creating or editing a channel");
      return;
    }

    const settings = buildChannelSettings(channelForm);
    await submitAction(editingChannelId ? `channel-save-${editingChannelId}` : "channel-create", async () => {
      const record = editingChannelId
        ? await updateChannel(editingChannelId, {
          name: channelForm.name,
          displayName: channelForm.displayName || null,
          icon: channelForm.icon || null,
          settings,
        })
        : await createChannel(selectedAccount.id, {
          name: channelForm.name,
          displayName: channelForm.displayName || null,
          icon: channelForm.icon || null,
          settings,
        });

      await loadChannelsForAccount(String(selectedAccount.id));
      setSelectedChannelId(String(record.id));
      resetChannelForm();
    });
  }

  async function removeCurrentChannel(channel: ChannelRecord) {
    await submitAction(`channel-delete-${channel.id}`, async () => {
      await deleteChannel(channel.id);
      await loadChannelsForAccount(String(channel.accountId));
      if (editingChannelId === channel.id) {
        resetChannelForm();
      }
    });
  }

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-8">
      <header className="flex flex-col gap-3 rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-[var(--accent)]">Channels</p>
            <h1 className="mt-2 text-3xl font-semibold text-[var(--text)]">Multi-channel inbox foundation</h1>
            <p className="mt-2 max-w-3xl text-sm text-[var(--text-muted)]">
              Manage channel accounts, configure per-channel routing metadata, and inspect the persisted inbox
              that now captures orchestrator ingress and egress. For runtime routing, clients can target a channel
              explicitly with <code className="rounded bg-[var(--bg)] px-1 py-0.5">channelId</code> or route by
              saved policy with <code className="rounded bg-[var(--bg)] px-1 py-0.5">routeHint</code> and
              <code className="mx-1 rounded bg-[var(--bg)] px-1 py-0.5">senderId</code>
              on <code className="rounded bg-[var(--bg)] px-1 py-0.5">POST /message</code>.
            </p>
          </div>
          <button
            type="button"
            className={buttonClassName("secondary")}
            onClick={() => {
              void loadAccounts();
            }}
            disabled={loadingAccounts || submitting !== null}
          >
            Refresh
          </button>
        </div>
        {error ? (
          <div className="rounded-lg border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] px-3 py-2 text-sm text-[rgb(248,113,113)]">
            {error}
          </div>
        ) : null}
        {notice ? (
          <div className="rounded-lg border border-[rgba(59,130,246,0.35)] bg-[rgba(59,130,246,0.10)] px-3 py-2 text-sm text-[rgb(96,165,250)]">
            {notice}
          </div>
        ) : null}
      </header>

      <div className="grid gap-6 xl:grid-cols-[1.15fr,1fr]">
        <section className={`${cardClassName()} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text)]">Channel accounts</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Provider-level ownership. Use metadata JSON for account-wide routing hints or allowlist state.
              </p>
            </div>
            <span className="rounded-full bg-[var(--bg)] px-3 py-1 text-xs text-[var(--text-muted)]">
              {accountQuery.trim() ? `${filteredAccounts.length}/${accounts.length}` : accounts.length} accounts
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              className={`${inputClassName()} max-w-md`}
              value={accountQuery}
              onChange={(event) => setAccountQuery(event.target.value)}
              placeholder="Filter accounts by name, type, owner, or default route hint"
            />
            <button
              type="button"
              className={buttonClassName("secondary")}
              onClick={() => setAccountQuery("")}
              disabled={!accountQuery}
            >
              Clear filter
            </button>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr,0.9fr]">
            <div className="space-y-3">
              {loadingAccounts ? (
                <p className="text-sm text-[var(--text-muted)]">Loading channel accounts…</p>
              ) : accounts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                  No channel accounts yet. Create one to start organizing inboxes.
                </p>
              ) : filteredAccounts.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                  No channel accounts match the current filter.
                </p>
              ) : filteredAccounts.map((account) => {
                const selected = String(account.id) === selectedAccountId;
                const policy = extractAccountPolicy(account.metadata);
                return (
                  <div
                    key={account.id}
                    className={`rounded-xl border p-4 transition ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-glow)]"
                        : "border-[var(--border)] bg-[var(--bg)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setSelectedAccountId(String(account.id))}
                      >
                        <div className="text-sm font-medium text-[var(--text)]">{account.name}</div>
                        <div className="mt-1 text-xs uppercase tracking-wide text-[var(--text-muted)]">
                          {account.type}
                        </div>
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonClassName("secondary")}
                          onClick={() => beginAccountEdit(account)}
                          disabled={submitting !== null}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={buttonClassName("danger")}
                          onClick={() => {
                            void removeAccount(account);
                          }}
                          disabled={submitting !== null}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {policy.owner ? (
                        <span className="rounded-full bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">
                          owner: {policy.owner}
                        </span>
                      ) : null}
                      {policy.defaultRouteHint ? (
                        <span className="rounded-full bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">
                          route: {policy.defaultRouteHint}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">
                        {policy.allowlistMode === "allowlist"
                          ? `allowlist-only (${normalizeAllowlistEntries(policy.allowlistText).length})`
                          : "open"}
                      </span>
                    </div>
                    {policy.rawMetadata ? (
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--bg-card)] p-3 text-xs text-[var(--text-muted)]">
                        {policy.rawMetadata}
                      </pre>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {editingAccountId ? "Edit account" : "New account"}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Keep provider metadata here; fine-grained route policy belongs on individual channels.
                  </p>
                </div>
                {editingAccountId ? (
                  <button type="button" className={buttonClassName("secondary")} onClick={resetAccountForm}>
                    Cancel
                  </button>
                ) : null}
              </div>

              <Field label="Account type">
                <select
                  className={inputClassName()}
                  value={accountForm.type}
                  onChange={(event) => setAccountForm((prev) => ({
                    ...prev,
                    type: event.target.value as ChannelAccountType,
                  }))}
                  disabled={editingAccountId !== null}
                >
                  {ACCOUNT_TYPE_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </Field>

              <Field label="Account name">
                <input
                  className={inputClassName()}
                  value={accountForm.name}
                  onChange={(event) => setAccountForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="ops"
                />
              </Field>

              <Field
                label="Owner / account label"
                hint="Optional human-facing owner tag for the provider account."
              >
                <input
                  className={inputClassName()}
                  value={accountForm.owner}
                  onChange={(event) => setAccountForm((prev) => ({ ...prev, owner: event.target.value }))}
                  placeholder="ops-team"
                />
              </Field>

              <Field
                label="Default route hint"
                hint="Saved as account metadata so future routing logic can prefer this account for a workload."
              >
                <input
                  className={inputClassName()}
                  value={accountForm.defaultRouteHint}
                  onChange={(event) => setAccountForm((prev) => ({ ...prev, defaultRouteHint: event.target.value }))}
                  placeholder="support"
                />
              </Field>

              <Field
                label="Allowlist mode"
                hint="Open keeps the account permissive; allowlist-only persists an explicit set of allowed identities."
              >
                <select
                  className={inputClassName()}
                  value={accountForm.allowlistMode}
                  onChange={(event) => setAccountForm((prev) => ({
                    ...prev,
                    allowlistMode: event.target.value as AllowlistMode,
                  }))}
                >
                  <option value="open">Open</option>
                  <option value="allowlist">Allowlist only</option>
                </select>
              </Field>

              <Field
                label="Allowlist entries"
                hint="Comma or newline separated. These entries are saved as structured metadata for later enforcement."
              >
                <textarea
                  className={textareaClassName()}
                  value={accountForm.allowlistText}
                  onChange={(event) => setAccountForm((prev) => ({ ...prev, allowlistText: event.target.value }))}
                  placeholder={"alice\nops@example.com"}
                />
              </Field>

              <Field
                label="Advanced account metadata JSON"
                hint="Merged with the structured fields above; keep extra provider-specific state here."
              >
                <textarea
                  className={textareaClassName()}
                  value={accountForm.rawMetadata}
                  onChange={(event) => setAccountForm((prev) => ({ ...prev, rawMetadata: event.target.value }))}
                  placeholder='{"provider":"tui"}'
                />
              </Field>

              <button
                type="button"
                className={buttonClassName("primary")}
                onClick={() => {
                  void saveAccount();
                }}
                disabled={submitting !== null}
              >
                {editingAccountId ? "Save account" : "Create account"}
              </button>
            </div>
          </div>
        </section>

        <section className={`${cardClassName()} p-5`}>
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-[var(--text)]">Channels</h2>
              <p className="text-sm text-[var(--text-muted)]">
                Select an account, then create explicit channels with per-channel settings and route policy JSON.
              </p>
            </div>
            <span className="rounded-full bg-[var(--bg)] px-3 py-1 text-xs text-[var(--text-muted)]">
              {selectedAccount
                ? `${channelQuery.trim() ? `${filteredChannels.length}/${channels.length}` : channels.length} channels`
                : "Select an account"}
            </span>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <input
              className={`${inputClassName()} max-w-md`}
              value={channelQuery}
              onChange={(event) => setChannelQuery(event.target.value)}
              placeholder="Filter channels by name, display name, account, or route hint"
              disabled={!selectedAccount}
            />
            <button
              type="button"
              className={buttonClassName("secondary")}
              onClick={() => setChannelQuery("")}
              disabled={!channelQuery}
            >
              Clear filter
            </button>
          </div>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.05fr,0.95fr]">
            <div className="space-y-3">
              {!selectedAccount ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                  Pick a channel account to inspect or create channels.
                </p>
              ) : loadingChannels ? (
                <p className="text-sm text-[var(--text-muted)]">Loading channels…</p>
              ) : channels.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                  No channels yet for <strong>{selectedAccount.name}</strong>.
                </p>
              ) : filteredChannels.length === 0 ? (
                <p className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                  No channels match the current filter for <strong>{selectedAccount.name}</strong>.
                </p>
              ) : filteredChannels.map((channel) => {
                const selected = String(channel.id) === selectedChannelId;
                const policy = extractChannelPolicy(channel.settings);
                return (
                  <div
                    key={channel.id}
                    className={`rounded-xl border p-4 transition ${
                      selected
                        ? "border-[var(--accent)] bg-[var(--accent-glow)]"
                        : "border-[var(--border)] bg-[var(--bg)]"
                    }`}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <button
                        type="button"
                        className="text-left"
                        onClick={() => setSelectedChannelId(String(channel.id))}
                      >
                        <div className="text-sm font-medium text-[var(--text)]">
                          {channel.displayName || channel.name}
                        </div>
                        <div className="mt-1 text-xs text-[var(--text-muted)]">
                          {channel.name} · account {channel.accountName}
                        </div>
                      </button>
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className={buttonClassName("secondary")}
                          onClick={() => beginChannelEdit(channel)}
                          disabled={submitting !== null}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={buttonClassName("danger")}
                          onClick={() => {
                            void removeCurrentChannel(channel);
                          }}
                          disabled={submitting !== null}
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      {policy.routeHint ? (
                        <span className="rounded-full bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">
                          route: {policy.routeHint}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-[var(--bg-card)] px-2 py-1 text-[var(--text-muted)]">
                        {policy.allowlistMode === "allowlist"
                          ? `allowlist-only (${normalizeAllowlistEntries(policy.allowlistText).length})`
                          : "open"}
                      </span>
                    </div>
                    {policy.rawSettings ? (
                      <pre className="mt-3 overflow-x-auto rounded-lg bg-[var(--bg-card)] p-3 text-xs text-[var(--text-muted)]">
                        {policy.rawSettings}
                      </pre>
                    ) : null}
                  </div>
                );
              })}
            </div>

            <div className="space-y-4 rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">
                    {editingChannelId ? "Edit channel" : "New channel"}
                  </h3>
                  <p className="text-xs text-[var(--text-muted)]">
                    Use settings JSON for route policy, allowlists, or future per-channel defaults.
                  </p>
                </div>
                {editingChannelId ? (
                  <button type="button" className={buttonClassName("secondary")} onClick={resetChannelForm}>
                    Cancel
                  </button>
                ) : null}
              </div>

              <Field label="Parent account">
                <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-2 text-sm text-[var(--text)]">
                  {selectedAccount ? `${selectedAccount.name} · ${selectedAccount.type}` : "No account selected"}
                </div>
              </Field>

              <Field label="Channel name">
                <input
                  className={inputClassName()}
                  value={channelForm.name}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="triage"
                />
              </Field>

              <Field label="Display name">
                <input
                  className={inputClassName()}
                  value={channelForm.displayName}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, displayName: event.target.value }))}
                  placeholder="Ops Triage"
                />
              </Field>

              <Field label="Icon">
                <input
                  className={inputClassName()}
                  value={channelForm.icon}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, icon: event.target.value }))}
                  placeholder="inbox"
                />
              </Field>

              <Field
                label="Route hint"
                hint="Structured channel routing hint saved into settings for future channel-aware dispatch."
              >
                <input
                  className={inputClassName()}
                  value={channelForm.routeHint}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, routeHint: event.target.value }))}
                  placeholder="incident-triage"
                />
              </Field>

              <Field
                label="Allowlist mode"
                hint="Use allowlist-only for channels that should only accept or target known identities."
              >
                <select
                  className={inputClassName()}
                  value={channelForm.allowlistMode}
                  onChange={(event) => setChannelForm((prev) => ({
                    ...prev,
                    allowlistMode: event.target.value as AllowlistMode,
                  }))}
                >
                  <option value="open">Open</option>
                  <option value="allowlist">Allowlist only</option>
                </select>
              </Field>

              <Field
                label="Allowlist entries"
                hint="Comma or newline separated values. Stored as structured channel policy metadata."
              >
                <textarea
                  className={textareaClassName()}
                  value={channelForm.allowlistText}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, allowlistText: event.target.value }))}
                  placeholder={"alice\nops@example.com"}
                />
              </Field>

              <Field
                label="Advanced channel settings JSON"
                hint="Merged with route hint and allowlist state, so advanced fields are preserved."
              >
                <textarea
                  className={textareaClassName()}
                  value={channelForm.rawSettings}
                  onChange={(event) => setChannelForm((prev) => ({ ...prev, rawSettings: event.target.value }))}
                  placeholder='{"priority":"high"}'
                />
              </Field>

              <button
                type="button"
                className={buttonClassName("primary")}
                onClick={() => {
                  void saveChannel();
                }}
                disabled={submitting !== null || !selectedAccount}
              >
                {editingChannelId ? "Save channel" : "Create channel"}
              </button>
            </div>
          </div>
        </section>
      </div>

      <section className={`${cardClassName()} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)]">API quickstart</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Copy ready-to-run daemon requests for the currently focused account/channel. These examples target the
              direct Max API on <code className="mx-1 rounded bg-[var(--bg)] px-1 py-0.5">http://localhost:7777</code>
              and reuse the saved token from <code className="rounded bg-[var(--bg)] px-1 py-0.5">~/.max/api-token</code>.
            </p>
          </div>
          <span className="rounded-full bg-[var(--bg)] px-3 py-1 text-xs text-[var(--text-muted)]">
            {apiExamples.length} snippets
          </span>
        </div>

        <div className="mt-5 grid gap-4 xl:grid-cols-2">
          {apiExamples.map((example: ChannelApiExample) => (
            <div key={example.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[var(--text)]">{example.title}</h3>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{example.description}</p>
                </div>
                <button
                  type="button"
                  className={buttonClassName("secondary")}
                  onClick={() => {
                    void copyToClipboard(example.copyLabel, example.snippet);
                  }}
                >
                  Copy
                </button>
              </div>
              <pre className="mt-4 overflow-x-auto rounded-lg bg-[var(--bg-card)] p-3 text-xs text-[var(--text-muted)]">
                {example.snippet}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section className={`${cardClassName()} p-5`}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-[var(--text)]">Inbox</h2>
            <p className="text-sm text-[var(--text-muted)]">
              Persisted ingress/egress for the selected channel. This is backed by the new
              <code className="ml-1 rounded bg-[var(--bg)] px-1 py-0.5">inbox_messages</code> store.
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
            {selectedChannel ? (
              <span className="rounded-full bg-[var(--bg)] px-3 py-1">
                channelId {selectedChannel.id}
              </span>
            ) : null}
            {selectedChannel ? (
              <button
                type="button"
                className={buttonClassName("secondary")}
                onClick={() => {
                  void copyToClipboard("Channel ID", String(selectedChannel.id));
                }}
                disabled={submitting !== null}
              >
                Copy channelId
              </button>
            ) : null}
            {selectedChannel && selectedChannelPolicy.routeHint ? (
              <button
                type="button"
                className={buttonClassName("secondary")}
                onClick={() => {
                  const routeHint = selectedChannelPolicy.routeHint;
                  if (routeHint) {
                    void copyToClipboard("Route hint", routeHint);
                  }
                }}
                disabled={submitting !== null}
              >
                Copy routeHint
              </button>
            ) : null}
            {selectedChannel ? (
              <button
                type="button"
                className={buttonClassName("secondary")}
                onClick={() => beginChannelEdit(selectedChannel)}
                disabled={submitting !== null}
              >
                Edit selected
              </button>
            ) : null}
            <button
              type="button"
              className={buttonClassName("secondary")}
              onClick={() => {
                if (selectedChannelId) {
                  void loadInboxForChannel(selectedChannelId);
                }
              }}
                disabled={!selectedChannelId || loadingInbox || submitting !== null}
              >
                Refresh inbox
              </button>
            <button
              type="button"
              className={buttonClassName("secondary")}
              onClick={() => {
                const beforeId = getInboxBeforeId(inbox);
                if (selectedChannelId && beforeId !== undefined) {
                  void loadInboxForChannel(selectedChannelId, {
                    beforeId,
                    appendOlder: true,
                  });
                }
              }}
              disabled={!selectedChannelId || loadingInbox || loadingOlderInbox || !hasOlderInbox}
            >
              {loadingOlderInbox ? "Loading older…" : "Load older"}
            </button>
          </div>
        </div>

        {selectedChannel ? (
          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr),180px,180px,180px,auto]">
            <input
              className={inputClassName()}
              value={inboxQuery}
              onChange={(event) => setInboxQuery(event.target.value)}
              placeholder="Filter inbox by content, metadata, senderId, or route hint"
            />
            <select
              className={inputClassName()}
              value={inboxDirection}
              onChange={(event) => setInboxDirection(event.target.value as InboxDirectionFilter)}
            >
              <option value="all">All directions</option>
              <option value="in">Inbound</option>
              <option value="out">Outbound</option>
            </select>
            <select
              className={inputClassName()}
              value={inboxRole}
              onChange={(event) => setInboxRole(event.target.value as InboxRoleFilter)}
            >
              <option value="all">All roles</option>
              <option value="user">User</option>
              <option value="assistant">Assistant</option>
              <option value="system">System</option>
            </select>
            <select
              className={inputClassName()}
              value={String(inboxPageSize)}
              onChange={(event) => setInboxPageSize(Number(event.target.value) as (typeof inboxPageSizeOptions)[number])}
            >
              {inboxPageSizeOptions.map((option) => (
                <option key={option} value={option}>
                  {option} per page
                </option>
              ))}
            </select>
            <button
              type="button"
              className={buttonClassName("secondary")}
              onClick={() => {
                setInboxQuery("");
                setInboxDirection("all");
                setInboxRole("all");
              }}
              disabled={!inboxFiltersActive}
            >
              Clear inbox filters
            </button>
          </div>
        ) : null}

        {!selectedChannel ? (
          <p className="mt-5 rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
            Select a channel to inspect its persisted inbox history.
          </p>
        ) : loadingInbox ? (
          <p className="mt-5 text-sm text-[var(--text-muted)]">Loading inbox messages…</p>
        ) : inbox.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
            No inbox messages recorded yet for <strong>{selectedChannel.displayName || selectedChannel.name}</strong>.
          </p>
        ) : filteredInbox.length === 0 ? (
          <p className="mt-5 rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
            No inbox messages match the current filters for <strong>{selectedChannel.displayName || selectedChannel.name}</strong>.
          </p>
        ) : (
          <div className="mt-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs text-[var(--text-muted)]">
              <span>
                Showing {filteredInbox.length}
                {inboxFiltersActive ? ` of ${inbox.length}` : ""} persisted messages
              </span>
            </div>
            {filteredInbox.map((message) => (
              <InboxItem key={message.id} message={message} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
