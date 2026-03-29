import type { AgentRecord, CapabilityFamily, ToolProfile } from "@/lib/api";

const CAPABILITY_FAMILIES: CapabilityFamily[] = [
  "browser",
  "web",
  "fs",
  "runtime",
  "message",
  "cron",
  "image",
  "sessions",
];

const TOOL_PROFILES: ToolProfile[] = ["all", "core", "delivery", "automation"];

export function normalizeCapabilityFamilyList(value: unknown): CapabilityFamily[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is CapabilityFamily =>
    typeof entry === "string" && CAPABILITY_FAMILIES.includes(entry as CapabilityFamily),
  );
}

export function normalizeToolProfile(value: unknown): ToolProfile {
  return typeof value === "string" && TOOL_PROFILES.includes(value as ToolProfile)
    ? value as ToolProfile
    : "all";
}

export function normalizeAgentRecord(record: AgentRecord): AgentRecord {
  return {
    ...record,
    toolProfile: normalizeToolProfile(record.toolProfile),
    allowedCapabilityFamilies: normalizeCapabilityFamilyList(record.allowedCapabilityFamilies),
    blockedCapabilityFamilies: normalizeCapabilityFamilyList(record.blockedCapabilityFamilies),
    automationEnabled: typeof record.automationEnabled === "boolean" ? record.automationEnabled : true,
  };
}
