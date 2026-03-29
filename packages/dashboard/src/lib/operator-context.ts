import type { ChannelAccountRecord, Worker } from "@/lib/api";

export interface ChannelAccountFocus {
  accountQuery: string;
  selectedAccountId: string | null;
  notice: string;
}

export function resolveChannelAccountFocus(
  accounts: ChannelAccountRecord[],
  accountType: string,
): ChannelAccountFocus {
  const matchingAccount = accounts.find((account) => account.type === accountType) ?? null;

  return {
    accountQuery: accountType,
    selectedAccountId: matchingAccount ? String(matchingAccount.id) : null,
    notice: matchingAccount
      ? `Focused ${accountType} channel accounts.`
      : `Filtering accounts for ${accountType}.`,
  };
}

export function indexWorkersByControlAgentId(workers: Worker[]): Map<number, Worker> {
  return new Map(
    workers
      .filter((worker): worker is Worker & { controlAgentId: number } => typeof worker.controlAgentId === "number")
      .map((worker) => [worker.controlAgentId, worker]),
  );
}
