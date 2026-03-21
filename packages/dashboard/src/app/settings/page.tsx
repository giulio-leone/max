"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import {
  createSkill,
  deleteSkill,
  fetchSkill,
  fetchSkills,
  setStoredApiToken,
  updateSkill,
  type SkillDetail,
  type SkillSource,
  type SkillSummary,
} from "@/lib/api";

const EMPTY_SKILL_FORM = {
  slug: "",
  name: "",
  description: "",
  instructions: "",
};

type SkillEditorMode = "create" | "edit" | "inspect";

type AggregatedSkill = {
  slug: string;
  name: string;
  description: string;
  directory: string;
  effectiveSource: SkillSource;
  sources: SkillSource[];
};

const SOURCE_PRIORITY: Record<SkillSource, number> = {
  local: 0,
  global: 1,
  bundled: 2,
};

function cardClassName() {
  return "rounded-xl bg-[var(--bg-card)] border border-[var(--border)]";
}

function inputClassName() {
  return "w-full px-3 py-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]";
}

function textareaClassName() {
  return `${inputClassName()} min-h-[220px] resize-y font-mono`;
}

function buttonClassName(kind: "primary" | "secondary" | "danger" = "secondary") {
  if (kind === "primary") {
    return "px-4 py-2 rounded-lg text-sm font-medium bg-[var(--accent)] text-white hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed transition-opacity";
  }
  if (kind === "danger") {
    return "px-4 py-2 rounded-lg text-sm font-medium border border-[var(--danger)] text-[var(--danger)] hover:bg-[rgba(239,68,68,0.08)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
  }
  return "px-4 py-2 rounded-lg text-sm font-medium border border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-60 disabled:cursor-not-allowed transition-colors";
}

function sourceBadgeClassName(source: SkillSource) {
  if (source === "local") return "bg-[rgba(16,185,129,0.15)] text-[#34d399] border-[rgba(16,185,129,0.35)]";
  if (source === "global") return "bg-[rgba(99,102,241,0.15)] text-[#a5b4fc] border-[rgba(99,102,241,0.35)]";
  return "bg-[rgba(245,158,11,0.15)] text-[#fbbf24] border-[rgba(245,158,11,0.35)]";
}

function formatSourceLabel(source: SkillSource) {
  return source.charAt(0).toUpperCase() + source.slice(1);
}

function Field({
  label,
  helper,
  children,
}: {
  label: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
        {helper && <span className="text-[11px] text-[var(--text-muted)]">{helper}</span>}
      </div>
      {children}
    </label>
  );
}

function SourceBadge({ source }: { source: SkillSource }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${sourceBadgeClassName(source)}`}>
      {formatSourceLabel(source)}
    </span>
  );
}

export default function SettingsPage() {
  const [token, setToken] = useState(() =>
    typeof window !== "undefined" ? localStorage.getItem("max-api-token") ?? "" : ""
  );
  const [saved, setSaved] = useState(false);

  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [selectedSkill, setSelectedSkill] = useState<SkillDetail | null>(null);
  const [editorMode, setEditorMode] = useState<SkillEditorMode>("create");
  const [skillForm, setSkillForm] = useState(EMPTY_SKILL_FORM);
  const [loadingSkills, setLoadingSkills] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [submitting, setSubmitting] = useState<"create" | "update" | "delete" | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [skillNotice, setSkillNotice] = useState<string | null>(null);

  const syncTokenFromStorage = useCallback(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem("max-api-token") ?? "";
    if (stored) {
      setToken((current) => current || stored);
    }
  }, []);

  const loadSkillsList = useCallback(async (preferredSlug?: string | null) => {
    setLoadingSkills(true);
    try {
      const nextSkills = await fetchSkills();
      setSkills(nextSkills);
      setSkillsError(null);
      syncTokenFromStorage();
      setSelectedSlug((current) => {
        if (preferredSlug === null) return null;
        const target = preferredSlug ?? current;
        if (target && nextSkills.some((skill) => skill.slug === target)) return target;
        return nextSkills[0]?.slug ?? null;
      });
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : "Failed to load skills");
    } finally {
      setLoadingSkills(false);
    }
  }, [syncTokenFromStorage]);

  useEffect(() => {
    void loadSkillsList();
  }, [loadSkillsList]);

  useEffect(() => {
    if (!selectedSlug) {
      setSelectedSkill(null);
      setLoadingDetail(false);
      return;
    }

    const slug = selectedSlug;
    let cancelled = false;

    async function loadSkillDetail() {
      setLoadingDetail(true);
      try {
        const detail = await fetchSkill(slug);
        if (cancelled) return;
        setSelectedSkill(detail);
        setSkillForm({
          slug: detail.slug,
          name: detail.name,
          description: detail.description,
          instructions: detail.instructions,
        });
        setEditorMode(detail.source === "local" ? "edit" : "inspect");
        setSkillsError(null);
      } catch (err) {
        if (cancelled) return;
        setSkillsError(err instanceof Error ? err.message : "Failed to load skill detail");
      } finally {
        if (!cancelled) {
          setLoadingDetail(false);
        }
      }
    }

    void loadSkillDetail();
    return () => {
      cancelled = true;
    };
  }, [selectedSlug]);

  const aggregatedSkills = useMemo(() => {
    const bySlug = new Map<string, AggregatedSkill>();

    for (const skill of skills) {
      const existing = bySlug.get(skill.slug);
      if (!existing) {
        bySlug.set(skill.slug, {
          slug: skill.slug,
          name: skill.name,
          description: skill.description,
          directory: skill.directory,
          effectiveSource: skill.source,
          sources: [skill.source],
        });
        continue;
      }

      if (!existing.sources.includes(skill.source)) {
        existing.sources = [...existing.sources, skill.source].sort(
          (left, right) => SOURCE_PRIORITY[left] - SOURCE_PRIORITY[right]
        );
      }

      if (SOURCE_PRIORITY[skill.source] < SOURCE_PRIORITY[existing.effectiveSource]) {
        existing.name = skill.name;
        existing.description = skill.description;
        existing.directory = skill.directory;
        existing.effectiveSource = skill.source;
      }
    }

    return Array.from(bySlug.values()).sort((left, right) => {
      const sourceDelta = SOURCE_PRIORITY[left.effectiveSource] - SOURCE_PRIORITY[right.effectiveSource];
      if (sourceDelta !== 0) return sourceDelta;
      return left.name.localeCompare(right.name);
    });
  }, [skills]);

  const selectedSkillSummary = useMemo(
    () => aggregatedSkills.find((skill) => skill.slug === selectedSlug) ?? null,
    [aggregatedSkills, selectedSlug]
  );

  const isCreateMode = editorMode === "create";
  const isInspectMode = editorMode === "inspect";
  const isLocalEditable = selectedSkill?.source === "local";

  function resetNoticeState() {
    setSkillNotice(null);
    setSkillsError(null);
  }

  function beginCreateSkill(prefill?: Partial<typeof EMPTY_SKILL_FORM>) {
    setSelectedSlug(null);
    setSelectedSkill(null);
    setEditorMode("create");
    setSkillForm({
      ...EMPTY_SKILL_FORM,
      ...prefill,
    });
    resetNoticeState();
  }

  const handleSaveToken = () => {
    setStoredApiToken(token.trim());
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    void loadSkillsList(selectedSlug);
  };

  async function handleSkillSubmit() {
    const normalized = {
      slug: skillForm.slug.trim(),
      name: skillForm.name.trim(),
      description: skillForm.description.trim(),
      instructions: skillForm.instructions,
    };

    if (!normalized.slug || !normalized.name || !normalized.description || !normalized.instructions.trim()) {
      setSkillsError("Slug, name, description, and instructions are required.");
      return;
    }

    const action = isCreateMode ? "create" : "update";
    setSubmitting(action);
    resetNoticeState();

    try {
      const result = isCreateMode
        ? await createSkill(normalized)
        : await updateSkill(selectedSkill?.slug ?? normalized.slug, {
          name: normalized.name,
          description: normalized.description,
          instructions: normalized.instructions,
        });

      setSkillNotice(result.message);
      await loadSkillsList(result.skill.slug);
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : "Failed to save skill");
    } finally {
      setSubmitting(null);
    }
  }

  async function handleDeleteSkill() {
    if (!selectedSkill || selectedSkill.source !== "local") return;
    if (!window.confirm(`Delete local skill '${selectedSkill.slug}'?`)) return;

    setSubmitting("delete");
    resetNoticeState();

    try {
      const result = await deleteSkill(selectedSkill.slug);
      setSkillNotice(result.message);
      await loadSkillsList(selectedSkill.slug);
    } catch (err) {
      setSkillsError(err instanceof Error ? err.message : "Failed to delete skill");
    } finally {
      setSubmitting(null);
    }
  }

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6">
      <div>
        <h2 className="text-2xl font-bold">Settings</h2>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          Configure the dashboard connection and manage the skill catalog available to Max.
        </p>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        <section className={`${cardClassName()} p-6 space-y-4`}>
          <div>
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Dashboard Access</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Save the API token used by the dashboard proxy and live API calls.
            </p>
          </div>

          <Field
            label="API Token"
            helper="Found in ~/.max/api-token"
          >
            <input
              type="password"
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="Paste your Max API token"
              className={`${inputClassName()} font-mono`}
            />
          </Field>

          <div className="flex items-center gap-3">
            <button
              onClick={handleSaveToken}
              className={buttonClassName("primary")}
            >
              {saved ? "✓ Saved" : "Save Token"}
            </button>
            <span className="text-xs text-[var(--text-muted)]">
              Updating the token also refreshes dashboard API usage in the current tab.
            </span>
          </div>
        </section>

        <section className={`${cardClassName()} p-6 space-y-3`}>
          <div>
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Connection Info</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Current endpoints used by the dashboard.
            </p>
          </div>
          <div className="text-xs font-mono text-[var(--text-muted)] space-y-1">
            <p>API Base: <span className="text-[var(--text)]">http://localhost:7777</span></p>
            <p>SSE Endpoint: <span className="text-[var(--text)]">http://localhost:7777/stream</span></p>
            <p>Dashboard Proxy: <span className="text-[var(--text)]">/api/max/*</span></p>
          </div>
        </section>
      </div>

      <section className={cardClassName()}>
        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-sm font-medium text-[var(--text-muted)]">Skills</h3>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Inspect bundled/global skills and create editable local skills directly from the dashboard.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => void loadSkillsList(selectedSlug)}
              className={buttonClassName()}
              disabled={loadingSkills}
            >
              {loadingSkills ? "Refreshing..." : "Refresh"}
            </button>
            <button
              onClick={() => beginCreateSkill()}
              className={buttonClassName("primary")}
            >
              New Local Skill
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-[320px_minmax(0,1fr)]">
          <aside className="border-b xl:border-b-0 xl:border-r border-[var(--border)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs uppercase tracking-wide text-[var(--text-muted)]">Catalog</p>
              <span className="text-xs text-[var(--text-muted)]">{aggregatedSkills.length} skills</span>
            </div>

            {loadingSkills && aggregatedSkills.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                Loading skills…
              </div>
            )}

            {!loadingSkills && aggregatedSkills.length === 0 && (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--text-muted)]">
                No skills found yet. Create a local skill to start curating the catalog.
              </div>
            )}

            <div className="space-y-2">
              {aggregatedSkills.map((skill) => {
                const selected = skill.slug === selectedSlug && !isCreateMode;
                return (
                  <button
                    key={skill.slug}
                    onClick={() => {
                      resetNoticeState();
                      setSelectedSlug(skill.slug);
                    }}
                    className={`w-full rounded-xl border p-3 text-left transition-colors ${
                      selected
                        ? "border-[var(--accent)] bg-[rgba(99,102,241,0.12)]"
                        : "border-[var(--border)] hover:border-[var(--accent)]"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-[var(--text)] truncate">{skill.name}</p>
                        <p className="text-[11px] font-mono text-[var(--text-muted)] mt-1">{skill.slug}</p>
                      </div>
                      <SourceBadge source={skill.effectiveSource} />
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-2 line-clamp-2">{skill.description}</p>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                      {skill.sources.map((source) => (
                        <SourceBadge key={`${skill.slug}-${source}`} source={source} />
                      ))}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <div className="p-4 md:p-6 space-y-4">
            {skillsError && (
              <div className="rounded-lg bg-[rgba(239,68,68,0.15)] border border-[var(--danger)] p-3 text-sm text-[var(--danger)]">
                {skillsError}
              </div>
            )}

            {skillNotice && (
              <div className="rounded-lg bg-[rgba(16,185,129,0.15)] border border-[rgba(16,185,129,0.35)] p-3 text-sm text-[#34d399]">
                {skillNotice}
              </div>
            )}

            {isCreateMode ? (
              <div className="space-y-4">
                <div>
                  <h4 className="text-lg font-semibold">Create Local Skill</h4>
                  <p className="text-sm text-[var(--text-muted)] mt-1">
                    Local skills live in <code className="px-1 py-0.5 rounded bg-[var(--bg)] text-[var(--accent)]">~/.max/skills</code> and take priority over global or bundled skills with the same slug.
                  </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Slug" helper="Used as the folder name">
                    <input
                      value={skillForm.slug}
                      onChange={(event) => setSkillForm((current) => ({ ...current, slug: event.target.value }))}
                      placeholder="browser-check"
                      className={`${inputClassName()} font-mono`}
                    />
                  </Field>
                  <Field label="Name">
                    <input
                      value={skillForm.name}
                      onChange={(event) => setSkillForm((current) => ({ ...current, name: event.target.value }))}
                      placeholder="Browser Check"
                      className={inputClassName()}
                    />
                  </Field>
                </div>

                <Field label="Description">
                  <input
                    value={skillForm.description}
                    onChange={(event) => setSkillForm((current) => ({ ...current, description: event.target.value }))}
                    placeholder="Explain when the skill should be used."
                    className={inputClassName()}
                  />
                </Field>

                <Field label="Instructions" helper="Saved inside SKILL.md">
                  <textarea
                    value={skillForm.instructions}
                    onChange={(event) => setSkillForm((current) => ({ ...current, instructions: event.target.value }))}
                    placeholder="Write the skill instructions here…"
                    className={textareaClassName()}
                  />
                </Field>

                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={() => void handleSkillSubmit()}
                    disabled={submitting !== null}
                    className={buttonClassName("primary")}
                  >
                    {submitting === "create" ? "Creating…" : "Create Local Skill"}
                  </button>
                  <button
                    onClick={() => {
                      setSkillForm(EMPTY_SKILL_FORM);
                      resetNoticeState();
                    }}
                    disabled={submitting !== null}
                    className={buttonClassName()}
                  >
                    Reset Form
                  </button>
                </div>
              </div>
            ) : loadingDetail ? (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
                Loading skill detail…
              </div>
            ) : selectedSkill ? (
              <div className="space-y-4">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <h4 className="text-lg font-semibold">{selectedSkill.name}</h4>
                    <div className="flex flex-wrap items-center gap-2 mt-2">
                      <code className="px-2 py-1 rounded bg-[var(--bg)] text-[var(--accent)] text-xs font-mono">
                        {selectedSkill.slug}
                      </code>
                      {(selectedSkillSummary?.sources ?? [selectedSkill.source]).map((source) => (
                        <SourceBadge key={`${selectedSkill.slug}-${source}`} source={source} />
                      ))}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] mt-3 break-all">
                      Effective directory: <span className="font-mono">{selectedSkill.directory}</span>
                    </p>
                  </div>

                  {isInspectMode && (
                    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs text-[var(--text-muted)] max-w-md">
                      This skill comes from the <strong>{formatSourceLabel(selectedSkill.source)}</strong> catalog, so it is inspect-only here. Create a local copy to customize it without changing the original source.
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Field label="Slug" helper={isLocalEditable ? "Local skills keep a stable slug" : "Inspect-only"}>
                    <input
                      value={skillForm.slug}
                      disabled
                      className={`${inputClassName()} font-mono opacity-70`}
                    />
                  </Field>
                  <Field label="Name">
                    <input
                      value={skillForm.name}
                      disabled={isInspectMode}
                      onChange={(event) => setSkillForm((current) => ({ ...current, name: event.target.value }))}
                      className={`${inputClassName()} ${isInspectMode ? "opacity-70" : ""}`}
                    />
                  </Field>
                </div>

                <Field label="Description">
                  <input
                    value={skillForm.description}
                    disabled={isInspectMode}
                    onChange={(event) => setSkillForm((current) => ({ ...current, description: event.target.value }))}
                    className={`${inputClassName()} ${isInspectMode ? "opacity-70" : ""}`}
                  />
                </Field>

                <Field label="Instructions" helper="Rendered from SKILL.md">
                  <textarea
                    value={skillForm.instructions}
                    disabled={isInspectMode}
                    onChange={(event) => setSkillForm((current) => ({ ...current, instructions: event.target.value }))}
                    className={`${textareaClassName()} ${isInspectMode ? "opacity-70" : ""}`}
                  />
                </Field>

                <div className="flex flex-wrap gap-3">
                  {isLocalEditable ? (
                    <>
                      <button
                        onClick={() => void handleSkillSubmit()}
                        disabled={submitting !== null}
                        className={buttonClassName("primary")}
                      >
                        {submitting === "update" ? "Saving…" : "Save Changes"}
                      </button>
                      <button
                        onClick={() => void handleDeleteSkill()}
                        disabled={submitting !== null}
                        className={buttonClassName("danger")}
                      >
                        {submitting === "delete" ? "Deleting…" : "Delete Local Skill"}
                      </button>
                    </>
                  ) : (
                    <button
                      onClick={() => beginCreateSkill({
                        slug: selectedSkill.slug,
                        name: selectedSkill.name,
                        description: selectedSkill.description,
                        instructions: selectedSkill.instructions,
                      })}
                      className={buttonClassName("primary")}
                    >
                      Create Local Copy
                    </button>
                  )}

                  <button
                    onClick={() => beginCreateSkill()}
                    className={buttonClassName()}
                  >
                    New Local Skill
                  </button>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-[var(--border)] p-6 text-sm text-[var(--text-muted)]">
                Select a skill from the catalog or create a new local skill to get started.
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
