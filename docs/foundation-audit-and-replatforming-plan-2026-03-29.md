# Max Foundation Audit and Replatforming Plan

Date: 2026-03-29

## 1. Scope

This document evaluates the current `Max` codebase as a foundation for a larger multi-provider automation platform and proposes a structural replatforming plan toward:

- Rust for the backend/control plane/runtime kernel
- Next.js 16 + React 19 + TypeScript 6 for the operator frontend
- plugin-based, hexagonal architecture
- reusable agents/sub-agents, provider routing, memory, automation, and connector orchestration

The goal is not to produce a cosmetic refactor. The goal is to define the architecture that can become the durable base of a consultancy-grade automation business.

## 2. Snapshot Of The Current Repository

Observed on local repository state:

- Commit: `67856ad`
- Worktree: dirty, with in-flight changes across control plane, channels, MCP config, worker sessions, dashboard pages, and tests
- Runtime stack: Node `v25.6.1`, npm `11.9.0`
- Code size: about `25,684` lines across `src/`, `packages/dashboard/src/`, and `test/`
- Current backend: TypeScript daemon, Express API, SQLite via `better-sqlite3`, GitHub Copilot SDK
- Current frontend: Next.js 16 dashboard, React 19, Tailwind 4

Current major subsystems already present:

- persistent orchestrator session
- managed worker sessions
- project/agent/task/schedule control plane
- capability registry and MCP server discovery/configuration
- scoped memory
- Telegram/TUI/background channels
- dashboard pages for control, chat, workers, settings, channels

## 3. What Already Has Strategic Value

The current codebase is not throwaway. Several ideas are directionally correct and should survive the replatform:

### 3.1 Persistent agent runtime

The repository already treats agent execution as a long-lived runtime instead of a stateless chat wrapper. This is the right primitive.

Relevant files:

- `src/copilot/orchestrator.ts`
- `src/control-plane/runtime.ts`
- `src/copilot/worker-sessions.ts`

### 3.2 Explicit control plane

Projects, agents, tasks, schedules, and heartbeat execution already exist as first-class records instead of ad hoc prompts.

Relevant files:

- `src/control-plane/store.ts`
- `src/control-plane/runtime.ts`

### 3.3 Emerging capability model

The capability registry and MCP adapter layer are the clearest seeds of a future plugin/capability system.

Relevant files:

- `src/copilot/capability-registry.ts`
- `src/copilot/capability-adapters.ts`
- `src/copilot/mcp-config.ts`
- `src/copilot/mcp-discovery.ts`

### 3.4 Existing UI foothold

The dashboard is not mature enough for the target product, but it proves the operator surface is already becoming a first-class concern rather than a debug-only admin panel.

Relevant files:

- `packages/dashboard/src/app/control/page.tsx`
- `packages/dashboard/src/app/chat/page.tsx`
- `packages/dashboard/src/lib/api.ts`

## 4. Critical Findings

## 4.1 P0: The current architecture is provider-bound, not domain-led

The most important structural problem is that the runtime is still conceptually "a Copilot orchestration app" rather than "an automation platform with interchangeable model and connector runtimes."

Evidence:

- `CopilotClient`, `CopilotSession`, Copilot tool definitions, and Copilot session lifecycle leak across orchestration, agent runtime, worker management, model routing, and MCP wiring.
- Core execution semantics are defined in terms of Copilot sessions, not abstract run/executor/provider contracts.

Consequence:

- OpenAI, Gemini, Codex cloud/server, and future providers would be bolt-ons rather than peers.
- Model/provider routing cannot become a first-class policy engine until the Copilot dependency is pushed behind a port.

Verdict:

- This must be structurally refactored.
- Do not keep Copilot SDK as the application kernel.
- Keep it as one provider adapter.

## 4.2 P0: The current backend is a monolith with global mutable singletons

Important runtime state is stored in module-level globals:

- singleton database handle
- singleton Copilot client
- singleton orchestrator session
- in-memory worker map
- process-local queues and timers

Evidence:

- `src/store/db.ts`
- `src/copilot/client.ts`
- `src/copilot/orchestrator.ts`
- `src/daemon.ts`

Consequence:

- no clean composition root
- weak test isolation
- difficult concurrency guarantees
- difficult multi-tenant or multi-runtime deployment
- hard migration path to service boundaries or background workers

Verdict:

- Replace with explicit services and ports instantiated from a Rust composition root.

## 4.3 P0: The execution model is serialized around a single orchestrator queue

The main orchestration path still serializes work through one queue and one persistent orchestrator session.

Consequence:

- poor fit for 3-4 simultaneous consultancy contexts
- poor fit for multiple client projects with separate budgets, secrets, and priorities
- poor fit for dispatching reusable agent templates into many concurrent runs

Verdict:

- The future architecture needs per-agent or per-run executors coordinated by a scheduler/dispatcher, not a single conversational choke point.

## 4.4 P0: Build and test health are currently broken at the infrastructure layer

`npm test` currently fails because `better-sqlite3` was built for a different Node module ABI.

Observed failure:

- `better_sqlite3.node` compiled for `NODE_MODULE_VERSION 127`
- current Node requires `NODE_MODULE_VERSION 141`
- 12 tests fail for this reason

Implication:

- current local environment is not trustworthy as a baseline for system evolution
- native dependency hygiene is already a friction point

This alone is a strong argument for moving the core runtime to Rust and reducing Node-native backend dependencies.

## 4.5 P1: The plugin story is not yet a true plugin architecture

Today there are useful pieces:

- MCP server config and discovery
- skills
- capability family registry

But the system still lacks a formal plugin contract with:

- manifests
- lifecycle
- permission scopes
- secret requirements
- event subscriptions
- UI contribution points
- compatibility/versioning rules

Verdict:

- "plugin" must become a protocol and manifest boundary, not a folder convention.

## 4.6 P1: The memory model is still primitive for the target business value

Current memory is:

- category-based
- text-only
- mostly keyword search / summary injection
- weakly separated between global, agent, and session scopes

It is not yet:

- episodic
- semantic
- artifact-aware
- budget-aware
- compressible/replayable
- suitable for cross-project consultancy execution traces

Verdict:

- memory must be rebuilt as a layered system, not as a "table of facts."

## 4.7 P1: Channel abstraction is still incomplete for the target surface area

The domain target includes:

- WhatsApp
- Telegram
- Gmail
- Google Calendar / Meet / Drive
- Teams
- GitHub
- Linear
- browser automation/web automation

Current channel/account abstractions are promising but still narrow and backend-specific. They are not yet a general event-ingestion and outbound-delivery plane.

Verdict:

- incoming and outgoing communications must be normalized through an event bus and connector contracts.

## 4.8 P1: The API layer is too coarse for a platform kernel

`src/api/server.ts` is doing too much:

- auth bootstrapping
- HTTP middleware
- dashboard endpoints
- channel operations
- memory endpoints
- MCP config operations
- runtime operations
- harness operations

Verdict:

- future API must be split into bounded contexts exposed through structured application services.

## 4.9 P1: Repository and package management are inconsistent

Observed:

- root `package-lock.json`
- root `pnpm-lock.yaml`
- dashboard nested package with separate lockfile
- no real workspace governance for a platform-scale repo

Verdict:

- do not evolve this into a serious multi-runtime platform without restructuring the repository first.

## 4.10 P2: The current frontend is functional but not product-grade

The dashboard is useful, but architecturally and aesthetically it is not the operator surface for a premium automation platform:

- oversized client components
- broad `useEffect` orchestration in pages
- limited server/client separation
- direct fetch-first patterns
- no serious design system
- visual language is generic and tool-like, not premium and differentiated

Relevant files:

- `packages/dashboard/src/app/layout.tsx`
- `packages/dashboard/src/app/control/page.tsx`
- `packages/dashboard/src/app/chat/page.tsx`
- `packages/dashboard/src/app/globals.css`

Verdict:

- the frontend should be kept, then progressively replaced with a cleaner App Router architecture.

## 5. Strategic Recommendation

Do not do a big-bang rewrite.

Do a controlled replatform with a strangler pattern:

1. freeze the domain model
2. extract contracts
3. stand up the Rust kernel beside the existing TypeScript daemon
4. move one bounded context at a time
5. keep Next.js as the operator UI and repoint it to the Rust API
6. retire the TypeScript daemon only after parity on core flows

This is the only path that is both ambitious and sane.

## 6. Target Architecture

## 6.1 Core principle

The new system should be:

- domain-led
- provider-agnostic
- event-driven
- plugin-oriented
- local-first but cloud-upgradable
- auditable
- reusable across clients/projects/agents without duplication

## 6.2 Architectural style

Recommended style:

- hexagonal architecture for the backend
- explicit bounded contexts
- out-of-process plugins/connectors whenever possible
- event sourcing for operational history where it matters
- durable queues backed by the main database in phase 1

Core layers:

1. `domain`
2. `application`
3. `ports`
4. `adapters`
5. `plugin runtime`
6. `operator API`
7. `operator UI`

## 6.3 Bounded contexts

Recommended backend bounded contexts:

1. Identity and tenancy
2. Projects and client workspaces
3. Agent templates and agent instances
4. Run orchestration and dispatch
5. Connector accounts and subscriptions
6. Memory and knowledge
7. Artifacts and files
8. Budgets, policies, and approvals
9. Observability and audit
10. Automation and scheduling

## 6.4 Canonical domain entities

Recommended core entities:

- `Workspace`
- `Client`
- `Project`
- `Task`
- `AgentTemplate`
- `AgentInstance`
- `SkillProfile`
- `ProviderAccount`
- `ConnectorAccount`
- `CapabilityGrant`
- `Run`
- `RunStep`
- `Message`
- `Artifact`
- `MemoryItem`
- `MemorySummary`
- `Subscription`
- `WebhookEndpoint`
- `BudgetPolicy`
- `ApprovalPolicy`

The current code already approximates parts of this, but not cleanly enough.

## 7. Technology Decisions

## 7.1 Backend

Recommended:

- Rust stable
- `tokio` for async runtime
- `axum` for HTTP/SSE/WebSocket APIs
- `tower` for middleware
- `serde` / `serde_json`
- `sqlx` for database access and migrations
- `tracing` + `tracing-subscriber` for observability
- `uuid`, `time`, `thiserror`, `anyhow`
- `utoipa` or equivalent for OpenAPI generation

Avoid:

- dynamic Rust ABI plugins
- opaque macro-heavy application frameworks
- provider logic inside domain services

## 7.2 Frontend

Recommended:

- Next.js 16 App Router
- React 19
- TypeScript 6
- Tailwind 4 with a custom design system
- server components by default
- client components only for interaction-heavy islands
- route handlers only where the web app genuinely owns the boundary

UI direction:

- premium operator console, not generic admin dashboard
- strong information hierarchy
- command-center interaction model
- timeline + graph + inbox + run detail views
- reusable design tokens and motion system

## 7.3 Database

Recommended phase-1 posture:

- keep SQLite as the primary local-first store
- use WAL mode
- manage schema through `sqlx` migrations
- build all storage behind ports so Postgres remains an upgrade path

Why SQLite still makes sense in phase 1:

- single operator / local-first workflow
- low operational overhead
- simple backups and replication patterns
- strong fit for desktop, edge, and self-hosted single-node runtime

Why SQLite alone is not enough as a permanent assumption:

- webhook fan-in can become bursty
- concurrent execution will grow
- cross-machine deployment will eventually happen
- advanced search products like ParadeDB only apply if you are already on Postgres

Decision:

- start with SQLite
- design for eventual Postgres without hard-committing to it now

## 7.4 Search and embeddings

Recommendation:

- text search: SQLite FTS5
- vector search: SQLite `vec1` extension in phase 1
- embeddings: pluggable provider abstraction, defaulting to a local model if cost/privacy require it

This is the best structural answer to your current constraints.

Why:

- you want local-first
- you do not want Elastic operational weight
- you do not yet need a hard Postgres commitment

Important clarification:

- ParadeDB is a strong option if and when you adopt Postgres
- it is not an argument for SQLite
- it is a Postgres argument

So the clean rule is:

- SQLite + FTS5 + `vec1` now
- Postgres + ParadeDB later, only when the concurrency/operations threshold is actually crossed

## 7.5 Queueing and automation

Phase 1:

- durable DB-backed queue
- `tokio` worker pool
- outbox pattern for connector side effects

Phase 2+:

- optional NATS or Redis for distributed execution

The key change is conceptual:

- heartbeat is only one event source
- it must not remain the dominant automation model

## 7.6 Realtime

Recommended:

- SSE for operator dashboards
- WebSocket only where bidirectional live control is necessary
- append-only event stream for runs and connector events

## 8. Provider Architecture

## 8.1 Required provider interfaces

The backend should define ports like:

- `ReasoningProvider`
- `InteractiveSessionProvider`
- `ToolExecutionProvider`
- `EmbeddingProvider`
- `SearchProvider`
- `ComputerUseProvider`

Concrete adapters then implement those ports:

- `CopilotProviderAdapter`
- `OpenAIProviderAdapter`
- `GeminiProviderAdapter`

## 8.2 Routing policy

Routing must not be keyword-only.

It should consider:

- task class
- cost budget
- latency budget
- tool requirements
- codebase access requirements
- connector affinity
- context size
- privacy tier
- provider availability

Examples:

- GitHub/Copilot SDK: strong fit for repository-native coding sessions
- OpenAI/Codex/OpenAI Responses tools: strong fit for multi-tool general orchestration and Codex-related coding flows
- Gemini: strong fit for long context, Google ecosystem affinity, and live/session flows

## 8.3 Agent templates vs instances

To avoid duplication:

- system prompts, skills, capability grants, and routing defaults live in `AgentTemplate`
- execution-specific state lives in `AgentInstance`
- project/client specialization is configuration, not copy-paste

This is mandatory for your use case.

## 9. Plugin System Recommendation

## 9.1 Do not implement plugins as native dynamic libraries

In Rust, native dynamic plugin loading is fragile and will become a maintenance tax.

Recommended alternative:

- plugin manifest + process boundary + protocol contract

Use plugins as one of:

1. MCP server
2. connector worker
3. tool runtime
4. UI extension descriptor

## 9.2 Plugin manifest

Each plugin should declare:

- id
- version
- kind
- capabilities
- secret requirements
- event subscriptions
- UI surfaces
- healthcheck contract
- compatibility range

Suggested kinds:

- `provider`
- `connector`
- `tool`
- `memory`
- `ui`

## 9.3 Hexagonal wiring

The hexagonal rule should be:

- domain knows nothing about providers
- application knows only ports
- adapters implement ports
- plugins register adapters through manifests and boot contracts

That gives you the wiring flexibility you are looking for without contaminating the core.

## 10. Memory Architecture Recommendation

You specifically called out memory as strategic. It is.

Recommended memory layers:

### 10.1 Operational memory

Append-only run/event history:

- prompts
- tool calls
- provider decisions
- artifacts
- approvals
- connector events

Purpose:

- replay
- audit
- debugging
- summarization input

### 10.2 Episodic memory

Summaries of completed runs, milestones, client context, and decisions.

Purpose:

- fast retrieval of recent or project-specific history

### 10.3 Semantic memory

Embeddings-backed retrieval for:

- client docs
- issue history
- specifications
- transcripts
- run outcomes

### 10.4 Working memory

Short-lived state attached to a run, session, or active agent execution.

### 10.5 Memory scopes

At minimum:

- global
- workspace
- client
- project
- agent template
- agent instance
- run
- connector account

This is how you support reuse without context leakage.

## 11. Connector Strategy

## 11.1 Google

Use your existing Rust MCP server as a first-class adapter instead of rebuilding Google Workspace integration from scratch.

Recommended rule:

- push/webhook where officially supported
- fallback polling/heartbeat only where necessary

Good fits for push/watch:

- Gmail
- Calendar
- Drive
- Meet events via Google Workspace Events API where appropriate

## 11.2 Teams

Treat Teams as a higher-friction enterprise connector:

- Microsoft Graph subscriptions for message change notifications
- bot surface for proactive/interactive messaging
- separate auth and consent flow

## 11.3 Telegram

Keep as a low-friction real-time operator ingress/egress channel.

## 11.4 WhatsApp

Treat as a dedicated connector track, not a quick add-on.

Reason:

- onboarding, templates, webhooks, rate/policy constraints, and account setup create a different operational profile from Telegram

Architectural consequence:

- WhatsApp should be isolated behind its own connector adapter and message normalization layer
- do not let WhatsApp-specific assumptions leak into the messaging core

## 11.5 Linear

Model Linear as both:

- a task source
- a state sink

This means:

- inbound webhooks create normalized events
- outbound sync updates issue status, comments, labels, links, and project state

## 11.6 GitHub

GitHub should remain a first-class connector and coding surface, but not the platform kernel.

## 12. Frontend Product Direction

The future frontend should not be "a dashboard for the daemon."

It should be an operator console with these primary surfaces:

1. Inbox
2. Runs
3. Agents
4. Projects
5. Connectors
6. Memory
7. Automations
8. Budgets and approvals
9. Observability

Recommended UI principles:

- server-rendered data shells
- client-side interactivity only where needed
- run timelines and diffable state changes
- explicit status and budget visibility
- keyboard-first operator flows
- mobile-friendly triage, desktop-heavy operations

## 13. Migration Plan

## Phase 0: Stabilize The Ground

Deliverables:

- choose a single JS package manager
- fix Node/native dependency health
- add repo-wide workspace strategy
- freeze current control-plane schema and domain vocabulary
- write ADRs for provider abstraction, storage abstraction, plugin contract, memory model

Exit criteria:

- green baseline build
- green baseline tests for the surviving TypeScript system
- approved domain glossary

## Phase 1: Create The Rust Kernel

Deliverables:

- Rust workspace
- `domain`, `application`, `ports`, `adapters/http`, `adapters/sqlite`
- initial OpenAPI schema
- run/event model
- project/agent/task/schedule modules

Exit criteria:

- Rust API can serve core CRUD and health endpoints
- Next.js can read from Rust API

## Phase 2: Move The Control Plane

Deliverables:

- projects/agents/tasks/schedules implemented in Rust
- SSE event stream
- DB migrations in Rust
- dashboard repointed from Express to Rust

Exit criteria:

- control plane no longer depends on TypeScript daemon backend

## Phase 3: Introduce Provider Adapters

Deliverables:

- Copilot adapter
- OpenAI adapter
- Gemini adapter
- routing policy engine
- provider credentials model

Exit criteria:

- one task can be dispatched to multiple providers based on policy

## Phase 4: Introduce Event-Driven Connector Plane

Deliverables:

- normalized inbound event model
- webhook ingestion service
- subscription management
- connector account management
- Google connector reuse via your Rust MCP server

Exit criteria:

- at least GitHub, Google, Telegram working through the new connector plane

## Phase 5: Rebuild Memory Properly

Deliverables:

- operational event log
- episodic summaries
- semantic retrieval
- vector index using SQLite `vec1`
- artifact-aware retrieval

Exit criteria:

- runs can retrieve relevant project/client memory without prompt duplication

## Phase 6: Operator UI Rewrite

Deliverables:

- redesigned control surface
- run timeline pages
- connector/account management
- approvals and budgets
- memory explorer

Exit criteria:

- old dashboard pages can be retired

## Phase 7: Decommission The TypeScript Daemon

Deliverables:

- remove Express daemon responsibilities
- keep only frontend TypeScript packages
- retain TS shared SDK/contracts only if they still provide value

Exit criteria:

- backend runtime fully owned by Rust

## 14. Recommended Repository Shape

```text
/
├─ apps/
│  └─ web/                    # Next.js operator console
├─ crates/
│  ├─ domain/
│  ├─ application/
│  ├─ ports/
│  ├─ infra-sqlite/
│  ├─ infra-http/
│  ├─ runtime-dispatch/
│  ├─ runtime-memory/
│  ├─ provider-copilot/
│  ├─ provider-openai/
│  ├─ provider-gemini/
│  ├─ connector-github/
│  ├─ connector-google/
│  ├─ connector-telegram/
│  ├─ connector-teams/
│  ├─ connector-whatsapp/
│  └─ plugin-host/
├─ packages/
│  ├─ ui/
│  ├─ contracts/
│  └─ sdk/
├─ plugins/
│  └─ manifests/
├─ docs/
│  ├─ adr/
│  └─ architecture/
└─ migrations/
```

## 15. Immediate Decisions To Lock Now

These should be decided before serious implementation:

1. The kernel will be Rust, not TypeScript.
2. Copilot SDK will become an adapter, not the core runtime.
3. SQLite remains phase-1 primary storage, but storage is abstracted from day one.
4. Search is SQLite FTS5 + `vec1` in phase 1.
5. Plugins are protocol-based and out-of-process, not native dynamic libraries.
6. Agent prompts/skills are template-driven, not duplicated per client/project.
7. Automation is event-driven first, heartbeat second.
8. Frontend remains Next.js/TypeScript, but moves to server-first App Router patterns.
9. Every connector must implement the same normalized inbound/outbound event contract.
10. Every run must be auditable and replayable.

## 16. Immediate Next 10 Tasks

If the goal is to start building now, the next concrete tasks should be:

1. Create `docs/adr/0001-platform-kernel.md` with the kernel/provider/plugin decisions.
2. Create a formal domain glossary for workspace, client, project, agent template, agent instance, run, artifact, memory.
3. Standardize package management and clean native dependency drift.
4. Scaffold the Rust workspace and composition root.
5. Define the storage port and initial SQLite schema in Rust.
6. Define provider ports and the first adapter capability matrix.
7. Define the normalized connector event envelope.
8. Define the plugin manifest schema.
9. Define the operator API contract and generate typed frontend clients from it.
10. Redesign the dashboard information architecture before rebuilding screens.

## 17. Bottom Line

This repository is a useful precursor, not the final base.

The winning move is:

- preserve the product insights
- preserve the control-plane concepts
- preserve MCP/capability thinking
- preserve the dashboard foothold
- replace the backend kernel
- normalize providers and connectors
- rebuild memory and dispatch as first-class systems

If you do that, this can evolve from a Copilot-centered orchestrator into a genuine multi-provider automation operating system.

## 18. External References Used

- GitHub Copilot SDK documentation via Context7: `/github/copilot-sdk`
- Next.js 16 documentation via Context7: `/vercel/next.js/v16.1.6`
- OpenAI Docs MCP: <https://developers.openai.com/learn/docs-mcp>
- OpenAI Responses API reference: <https://platform.openai.com/docs/api-reference/responses/compact/>
- Gemini API models: <https://ai.google.dev/gemini-api/docs/models>
- Gemini Live API session management: <https://ai.google.dev/gemini-api/docs/live-api/session-management>
- Gmail push notifications: <https://developers.google.com/workspace/gmail/api/guides/push>
- Google Calendar push notifications: <https://developers.google.com/workspace/calendar/api/guides/push>
- Google Drive push notifications: <https://developers.google.com/workspace/drive/api/guides/push>
- Google Meet REST API overview: <https://developers.google.com/workspace/meet/api/guides/overview>
- Microsoft Graph Teams change notifications: <https://learn.microsoft.com/en-us/graph/teams-changenotifications-chatmessage>
- SQLite vec1 extension: <https://sqlite.org/vec1/doc/trunk/doc/vec1.md>
- ParadeDB introduction: <https://docs.paradedb.com/welcome/introduction>
