<p align="center">
  <img src="assets/images/memento_mcp_logo_transparent.png" width="400" alt="Memento MCP Logo">
</p>

<p align="center">
  <a href="https://lobehub.com/mcp/jinho-von-choi-memento-mcp">
    <img src="https://lobehub.com/badge/mcp/jinho-von-choi-memento-mcp" alt="MCP Badge" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/releases">
    <img src="https://img.shields.io/github/v/release/JinHo-von-Choi/memento-mcp?style=flat&label=release&color=4c8bf5" alt="GitHub Release" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/stargazers">
    <img src="https://img.shields.io/github/stars/JinHo-von-Choi/memento-mcp?style=flat&color=f5c542" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/issues">
    <img src="https://img.shields.io/github/issues/JinHo-von-Choi/memento-mcp?style=flat&color=e05d44" alt="GitHub Issues" />
  </a>
  <a href="https://github.com/JinHo-von-Choi/memento-mcp/commits/main">
    <img src="https://img.shields.io/github/last-commit/JinHo-von-Choi/memento-mcp?style=flat&color=brightgreen" alt="Last Commit" />
  </a>
  <a href="LICENSE">
    <img src="https://img.shields.io/badge/license-Apache%202.0-blue?style=flat" alt="License" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-%3E%3D20-339933?style=flat&logo=node.js&logoColor=white" alt="Node.js" />
  <img src="https://img.shields.io/badge/PostgreSQL-pgvector%20HNSW-4169E1?style=flat&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/Redis-L1%20Cache-DC382D?style=flat&logo=redis&logoColor=white" alt="Redis" />
  <img src="https://img.shields.io/badge/MCP-2025--11--25-7c3aed?style=flat" alt="MCP Protocol" />
  <img src="https://img.shields.io/badge/transport-Streamable%20HTTP%20%7C%20SSE-0ea5e9?style=flat" alt="Transport" />
  <img src="https://img.shields.io/badge/auth-OAuth%202.0%20PKCE-f59e0b?style=flat" alt="Auth" />
</p>

# Memento MCP

Quick entry points:

- [Quick Start](docs/getting-started/quickstart.md)
- [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md)
- [Windows PowerShell Setup](docs/getting-started/windows-powershell.md)
- [Claude Code Configuration](docs/getting-started/claude-code.md)
- [First Memory Flow](docs/getting-started/first-memory-flow.md)
- [Troubleshooting](docs/getting-started/troubleshooting.md)
- [Installation Guide](docs/INSTALL.en.md)
- [AI Skill Reference](SKILL.md)

## Table of Contents

- [Quick Start](#quick-start)
- [Supported Environments](#supported-environments)
- [When You Need Claude Code](#when-you-need-claude-code)
- [Overview](#overview)
- [System Architecture](#system-architecture)
- [Database Schema](#database-schema)
- [Prompts](#prompts)
- [Resources](#resources)
- [3-Layer Search](#3-layer-search)
- [TTL Tiers](#ttl-tiers)
- [MCP Tools](#mcp-tools)
- [Recommended Usage Flow](#recommended-usage-flow)
- [MemoryEvaluator](#memoryevaluator)
- [MemoryConsolidator](#memoryconsolidator)
- [Contradiction Detection Pipeline](#contradiction-detection-pipeline)
- [MEMORY_CONFIG](#memory_config)
- [Environment Variables](#environment-variables)
- [Switching Embedding Providers](#switching-embedding-providers)
- [HTTP Endpoints](#http-endpoints)
- [Tech Stack](#tech-stack)
- [Tests](#tests)
- [Installation](#installation)
- [Why I Built This](#why-i-built-this)

## Quick Start

Minimum requirements:

- Required: Node.js 20+, PostgreSQL, `vector` extension
- Optional: Redis
- Optional: Embedding provider
- Optional: Claude Code integration

Shortest path to running:

```bash
cp .env.example.minimal .env
# Edit .env values, then export them to the shell
export $(grep -v '^#' .env | grep '=' | xargs)
npm install
psql "$DATABASE_URL" -c "CREATE EXTENSION IF NOT EXISTS vector;"
psql "$DATABASE_URL" -f lib/memory/memory-schema.sql
node server.js
```

Once the server is up, verify `remember`, `recall`, and `context` calls via [First Memory Flow](docs/getting-started/first-memory-flow.md).

## Supported Environments

| Environment | Recommendation | Getting Started |
|-------------|----------------|-----------------|
| Linux / macOS | Recommended | [Quick Start](docs/getting-started/quickstart.md) |
| Windows + WSL2 | Most recommended | [Windows WSL2 Setup](docs/getting-started/windows-wsl2.md) |
| Windows + PowerShell | Limited support | [Windows PowerShell Setup](docs/getting-started/windows-powershell.md) |

## When You Need Claude Code

- Running the memento server standalone: No Claude Code configuration needed
- Letting Claude Code use memory tools directly: [Claude Code Configuration](docs/getting-started/claude-code.md) required

## Overview

Memento MCP is an MCP (Model Context Protocol) based long-term memory server for AI agents. It persists important facts, decisions, error patterns, and procedures across sessions, restoring them when a new session begins.

Knowledge is decomposed into atomic units of 1-3 sentences called **fragments**. Storing entire session summaries would clutter the context window with irrelevant content and make it difficult to isolate specific information. By breaking knowledge into fragments, the system returns precisely what is needed at search time.

Fragments are classified into six types: `fact`, `decision`, `error`, `preference`, `procedure`, `relation`. Each type has different default importance and decay rates.

![Knowledge Network](assets/images/knowledge-graph.png)

Search passes through three layers in sequence. Redis Set intersection finds keyword matches, PostgreSQL GIN indexes perform array searches, and pgvector HNSW computes cosine similarity. Storing memories well is only half the battle -- retrieving them effectively matters just as much. A memory that cannot be found is no different from one that never existed.

![Token Efficiency](assets/images/token-efficiency.png)

Embeddings are not generated inline at remember time. The EmbeddingWorker consumes fragment IDs from a Redis queue, generates embeddings asynchronously, and emits an `embedding_ready` event upon completion. GraphLinker subscribes to this event and automatically creates relationships between similar fragments. All fragments are embedding targets regardless of importance.

An asynchronous quality evaluation worker monitors new fragments in the background. It calls Gemini CLI to review the content's soundness and updates the utility_score. A periodic maintenance pipeline handles importance decay, TTL transitions, duplicate merging, contradiction detection, and orphan link cleanup. Contradiction detection operates as a 3-stage hybrid -- pgvector similarity filter, NLI (Natural Language Inference) classification, and Gemini CLI escalation. NLI resolves clear logical contradictions at low cost immediately, while only cases that NLI finds ambiguous (numerical/domain contradictions) are escalated to Gemini. When a session ends, reflect runs automatically and persists session activities as structured fragments. Memory does not end at storage. It must be managed.

MCP protocol versions 2025-11-25, 2025-06-18, 2025-03-26, and 2024-11-05 are supported. Streamable HTTP and Legacy SSE are served simultaneously, with built-in OAuth 2.0 PKCE authentication. The server listens on port 57332.

---

## System Architecture

![System Architecture](assets/images/memento_architecture.svg)

```
server.js  (HTTP server)
    |
    +-- POST /mcp          Streamable HTTP -- JSON-RPC receiver
    +-- GET  /mcp          Streamable HTTP -- SSE stream
    +-- DELETE /mcp        Streamable HTTP -- Session termination
    +-- GET  /sse          Legacy SSE -- Session creation
    +-- POST /message      Legacy SSE -- JSON-RPC receiver
    +-- GET  /health       Health check
    +-- GET  /metrics      Prometheus metrics
    +-- GET  /authorize    OAuth 2.0 authorization endpoint
    +-- POST /token        OAuth 2.0 token endpoint
    +-- GET  /.well-known/oauth-authorization-server
    +-- GET  /.well-known/oauth-protected-resource
    |
    +-- lib/jsonrpc.js        JSON-RPC 2.0 parsing and method dispatch
    +-- lib/tool-registry.js  12 memory tool registration and routing
    |
    +-- lib/memory/
            +-- MemoryManager.js          Business logic facade (singleton)
            +-- FragmentFactory.js        Fragment creation, validation, PII masking
            +-- FragmentStore.js          PostgreSQL CRUD facade (delegates to FragmentReader + FragmentWriter)
            +-- FragmentReader.js         Fragment reads (getById, getByIds, getHistory, searchByKeywords, searchBySemantic)
            +-- FragmentWriter.js         Fragment writes (insert, update, delete, incrementAccess, touchLinked)
            +-- FragmentSearch.js         3-layer search orchestration (structural: L1->L2, semantic: L1->L2||L3 RRF merge)
            +-- FragmentIndex.js          Redis L1 index management, getFragmentIndex() singleton factory
            +-- EmbeddingWorker.js        Redis queue-based async embedding worker (EventEmitter)
            +-- GraphLinker.js            Embedding-ready event subscriber for auto-linking + retroactive linking + Hebbian co-retrieval linking
            +-- MemoryConsolidator.js     18-step maintenance pipeline (NLI + Gemini hybrid)
            +-- MemoryEvaluator.js        Async Gemini CLI quality evaluation worker (singleton)
            +-- NLIClassifier.js          NLI-based contradiction classifier (mDeBERTa ONNX, CPU)
            +-- SessionActivityTracker.js Per-session tool call/fragment activity tracking (Redis)
            +-- ConflictResolver.js       Conflict detection, supersede, autoLinkOnRemember (topic-based structural linking)
            +-- SessionLinker.js          Session fragment consolidation, auto-linking, cycle detection
            +-- LinkStore.js              Fragment link management (fragment_links CRUD + RCA chains)
            +-- FragmentGC.js             Fragment expiration/deletion, exponential decay, TTL tier transitions (permanent parole + EMA batch decay)
            +-- ConsolidatorGC.js         Feedback reports, stale fragment collection/cleanup, long fragment splitting, feedback-based correction
            +-- ContradictionDetector.js  Contradiction detection, supersede relation detection, pending queue processing
            +-- AutoReflect.js            Session-end auto reflect orchestrator
            +-- decay.js                  Exponential decay half-life constants, pure computation functions, ACT-R EMA activation approximation (`updateEmaActivation`, `computeEmaRankBoost`), EMA-based dynamic half-life (`computeDynamicHalfLife`), age-weighted utility score (`computeUtilityScore`)
            +-- SearchMetrics.js          L1/L2/L3/total layer-level latency collection (Redis circular buffer, P50/P90/P99)
            +-- SearchEventAnalyzer.js    Search event analysis, query pattern tracking (reads from SearchEventRecorder)
            +-- SearchEventRecorder.js    FragmentSearch.search() result to search_events table recording
            +-- EvaluationMetrics.js      tool_feedback-based implicit Precision@5 and downstream task success rate computation
            +-- memory-schema.sql         PostgreSQL schema definition
            +-- migration-001-temporal.sql Temporal schema migration (valid_from/to/superseded_by)
            +-- migration-002-decay.sql   Decay idempotency migration (last_decay_at)
            +-- migration-003-api-keys.sql API key management tables (api_keys, api_key_usage)
            +-- migration-004-key-isolation.sql fragments.key_id column (API key-based memory isolation)
            +-- migration-005-gc-columns.sql   GC policy hardening indexes (utility_score, access_count)
            +-- migration-006-superseded-by-constraint.sql fragment_links CHECK adds superseded_by
            +-- migration-007-link-weight.sql  fragment_links.weight column (link strength quantification)
            +-- migration-008-morpheme-dict.sql Morpheme dictionary table (morpheme_dict)
            +-- migration-009-co-retrieved.sql fragment_links CHECK adds co_retrieved (Hebbian linking)
            +-- migration-010-ema-activation.sql fragments.ema_activation/ema_last_updated columns
            +-- migration-011-key-groups.sql  API key group N:M mapping (api_key_groups, api_key_group_members)
            +-- migration-012-quality-verified.sql fragments.quality_verified column (MemoryEvaluator verdict persistence)
            +-- migration-013-search-events.sql search_events table (search query/result observability)
```

Supporting modules:

```
lib/
+-- config.js          Environment variables exposed as constants
+-- auth.js            Bearer token validation
+-- oauth.js           OAuth 2.0 PKCE authorization/token handling
+-- sessions.js        Streamable/Legacy SSE session lifecycle
+-- redis.js           ioredis client (Sentinel support)
+-- gemini.js          Google Gemini API/CLI client (geminiCLIJson, isGeminiCLIAvailable)
+-- compression.js     Response compression (gzip/deflate)
+-- metrics.js         Prometheus metric collection (prom-client)
+-- logger.js          Winston logger (daily rotate)
+-- rate-limiter.js    IP-based sliding window rate limiter
+-- rbac.js            RBAC authorization (read/write/admin tool-level permissions)
+-- http-handlers.js   MCP/SSE HTTP handlers (Admin routes separated into admin-routes.js)
+-- scheduler.js       Periodic task scheduler (setInterval task management)
+-- utils.js           Origin validation, JSON body parsing (2MB cap), SSE output

lib/admin/
+-- ApiKeyStore.js     API key CRUD, group CRUD, authentication verification (SHA-256 hash storage, raw key returned once only)
+-- admin-auth.js      Admin auth routes (POST /auth, session cookie issuance)
+-- admin-keys.js      API key management routes
+-- admin-memory.js    Memory operations routes (overview, fragments, anomalies, graph)
+-- admin-sessions.js  Session management routes
+-- admin-logs.js      Log viewing routes
+-- admin-export.js    Fragment export/import routes (export, import)

assets/admin/
+-- index.html         Admin SPA app shell (login form + container)
+-- admin.css          Admin UI stylesheet
+-- admin.js           Admin UI logic (7 navigation sections: overview, API keys, groups, memory ops, sessions, logs, knowledge graph)

lib/http/
+-- helpers.js         HTTP SSE stream helpers and request parsing utilities

lib/logging/
+-- audit.js           Audit logging and access history recording
```

Tool implementations are separated into `lib/tools/`.

```
lib/tools/
+-- memory.js    12 MCP tool handlers
+-- memory-schemas.js  Tool schema definitions (inputSchema)
+-- db.js        PostgreSQL connection pool, RLS-applied query helper (not exposed via MCP)
+-- db-tools.js  MCP DB tool handlers (per-tool logic split from db.js)
+-- embedding.js OpenAI text embedding generation
+-- stats.js     Access statistics collection and storage
+-- prompts.js   MCP Prompts definitions (analyze-session, retrieve-relevant-memory, etc.)
+-- resources.js MCP Resources definitions (memory://stats, memory://topics, etc.)
+-- index.js     Tool handler exports
```

One-time utility scripts are in `scripts/`.

```
scripts/
+-- backfill-embeddings.js                       Embedding backfill (one-time)
+-- normalize-vectors.js                         Vector L2 normalization (one-time)
+-- migrate.js                                   DB migration runner (schema_migrations-based incremental)
+-- migration-007-flexible-embedding-dims.js     Embedding dimension migration
```

`config/memory.js` is a separate configuration file for the memory system. It holds time-semantic composite ranking weights, stale thresholds, embedding worker settings, context injection, pagination, and GC policies.

---

## Database Schema

The schema name is `agent_memory`. Schema file: `lib/memory/memory-schema.sql`.

```mermaid
erDiagram
    fragments ||--o{ fragment_links : "from/to"
    fragments ||--o{ fragment_versions : "history"
    fragments {
        text id PK
        text content "PII Masked"
        text topic
        text_array keywords
        text type "fact/decision/error..."
        real importance
        text content_hash "Unique"
        text_array linked_to
        text agent_id "RLS Key"
        integer access_count
        real utility_score
        vector embedding "OpenAI 1536, L2 normalized"
        boolean is_anchor
        timestamptz valid_from "Temporal valid start"
        timestamptz valid_to "Temporal valid end (NULL=current)"
        text superseded_by "Superseding fragment ID"
        timestamptz last_decay_at "Last decay timestamp"
        text key_id "API key isolation (NULL=master)"
        float ema_activation "ACT-R EMA activation approximation (DEFAULT 0.0)"
        timestamptz ema_last_updated "EMA last update timestamp"
        boolean quality_verified "MemoryEvaluator verdict: NULL=unevaluated, TRUE=keep, FALSE=downgrade/discard"
    }
    fragment_links {
        bigserial id PK
        text from_id FK
        text to_id FK
        text relation_type
        integer weight "Link strength (co_retrieved count accumulation)"
    }
    tool_feedback {
        bigserial id PK
        text tool_name
        boolean relevant
        boolean sufficient
        text session_id
    }
    task_feedback {
        bigserial id PK
        text session_id
        boolean overall_success
    }
```

### fragments

The store for all fragments. This is the core table of the system.

| Column | Type | Constraint | Description |
|--------|------|------------|-------------|
| id | TEXT | PRIMARY KEY | Fragment unique identifier |
| content | TEXT | NOT NULL | Memory content body (300 characters recommended, atomic 1-3 sentences) |
| topic | TEXT | NOT NULL | Topic label (e.g., database, deployment, security) |
| keywords | TEXT[] | NOT NULL DEFAULT '{}' | Search keyword array (GIN indexed) |
| type | TEXT | NOT NULL, CHECK | fact / decision / error / preference / procedure / relation |
| importance | REAL | 0.0~1.0 CHECK | Importance. Defaults per type, decayed by MemoryConsolidator |
| content_hash | TEXT | UNIQUE | SHA hash-based duplicate prevention |
| source | TEXT | | Source identifier (session ID, tool name, etc.) |
| linked_to | TEXT[] | DEFAULT '{}' | Connected fragment ID list (GIN indexed) |
| agent_id | TEXT | NOT NULL DEFAULT 'default' | RLS isolation agent ID |
| access_count | INTEGER | DEFAULT 0 | Recall count -- factored into utility_score |
| accessed_at | TIMESTAMPTZ | | Last recall timestamp |
| created_at | TIMESTAMPTZ | DEFAULT NOW() | Creation timestamp |
| ttl_tier | TEXT | CHECK | hot / warm (default) / cold / permanent |
| estimated_tokens | INTEGER | DEFAULT 0 | cl100k_base token count -- used for tokenBudget calculation |
| utility_score | REAL | DEFAULT 1.0 | Usefulness score updated by MemoryEvaluator/MemoryConsolidator |
| verified_at | TIMESTAMPTZ | DEFAULT NOW() | Last quality verification timestamp |
| embedding | vector(1536) | | OpenAI text-embedding-3-small vector. L2-normalized (unit vector) before storage |
| is_anchor | BOOLEAN | DEFAULT FALSE | When true, exempt from decay, TTL demotion, and expiration deletion |
| valid_from | TIMESTAMPTZ | DEFAULT NOW() | Temporal validity start. Lower bound for `asOf` queries |
| valid_to | TIMESTAMPTZ | | Temporal validity end. NULL means currently valid |
| superseded_by | TEXT | | ID of the fragment that supersedes this one |
| last_decay_at | TIMESTAMPTZ | | Last decay application timestamp. When NULL, falls back to accessed_at/created_at |
| key_id | TEXT | FK -> api_keys.id, ON DELETE SET NULL | API key-based memory isolation. NULL means stored via master key (MEMENTO_ACCESS_KEY). When set, only that API key can query the fragment |
| ema_activation | FLOAT | DEFAULT 0.0 | ACT-R base-level activation EMA approximation. Updated on `incrementAccess()` via `alpha * (dt_sec)^{-0.5} + (1-alpha) * prev` (alpha=0.3). Not updated on L1 fallback path (noEma=true). Used as importance boost in `_computeRankScore()` |
| ema_last_updated | TIMESTAMPTZ | | EMA last update timestamp. Falls back to created_at when NULL |
| quality_verified | BOOLEAN | DEFAULT NULL | MemoryEvaluator quality verdict. NULL=unevaluated, TRUE=keep (verified), FALSE=downgrade/discard (rejected). Used in permanent promotion Circuit Breaker |

Index list: content_hash (UNIQUE), topic (B-tree), type (B-tree), keywords (GIN), importance DESC (B-tree), created_at DESC (B-tree), agent_id (B-tree), linked_to (GIN), (ttl_tier, created_at) (B-tree), source (B-tree), verified_at (B-tree), is_anchor WHERE TRUE (partial index), valid_from (B-tree), (topic, type) WHERE valid_to IS NULL (partial index), id WHERE valid_to IS NULL (partial UNIQUE).

The HNSW vector index is created as a conditional index on `embedding IS NOT NULL`. Parameters: m=16 (neighbor connections), ef_construction=64 (index build search depth), distance function vector_cosine_ops.

### fragment_links

A dedicated table for the relationship graph between fragments. Exists alongside the linked_to array in the fragments table.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL PK | Auto-increment identifier |
| from_id | TEXT | Source fragment (ON DELETE CASCADE) |
| to_id | TEXT | Target fragment (ON DELETE CASCADE) |
| relation_type | TEXT | related / caused_by / resolved_by / part_of / contradicts / superseded_by / co_retrieved |
| weight | INTEGER | Link strength. `co_retrieved` relations increment +1 on each co-recall. Default 1 |
| created_at | TIMESTAMPTZ | Relation creation timestamp |

A UNIQUE constraint on (from_id, to_id) prevents duplicate links; instead, weight is incremented.

`co_retrieved` links are created asynchronously by `GraphLinker.buildCoRetrievalLinks()` when a recall result returns 2 or more fragments. Following Hebbian associative learning, fragment pairs frequently retrieved together accumulate higher weights.

### tool_feedback

Tool usefulness feedback. Records whether recall returned results matching the intent and whether they were sufficient for task completion.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL PK | |
| tool_name | TEXT | Name of the evaluated tool |
| relevant | BOOLEAN | Was the result relevant to the request intent |
| sufficient | BOOLEAN | Was the result sufficient for task completion |
| suggestion | TEXT | Improvement suggestion (100 characters recommended) |
| context | TEXT | Usage context summary (50 characters recommended) |
| session_id | TEXT | Session identifier |
| trigger_type | TEXT | sampled (hook sampling) / voluntary (AI voluntary call) |
| created_at | TIMESTAMPTZ | |

### task_feedback

Per-session task effectiveness. Recorded via the reflect tool's task_effectiveness parameter.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL PK | |
| session_id | TEXT | Session identifier |
| overall_success | BOOLEAN | Whether the session's primary task completed successfully |
| tool_highlights | TEXT[] | Especially useful tools and reasons |
| tool_pain_points | TEXT[] | Tools needing improvement and reasons |
| created_at | TIMESTAMPTZ | |

### fragment_versions

Each time a fragment is modified via the amend tool, the previous version is preserved here. An audit trail of edit history.

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL PK | |
| fragment_id | TEXT | Original fragment ID (ON DELETE CASCADE) |
| content | TEXT | Pre-edit content |
| topic | TEXT | Pre-edit topic |
| keywords | TEXT[] | Pre-edit keywords |
| type | TEXT | Pre-edit type |
| importance | REAL | Pre-edit importance |
| amended_at | TIMESTAMPTZ | Edit timestamp |
| amended_by | TEXT | Editing agent_id |

### Row-Level Security

RLS is enabled on the fragments table. The policy name is `fragment_isolation_policy`. It evaluates the session variable `app.current_agent_id`.

```sql
CREATE POLICY fragment_isolation_policy ON agent_memory.fragments
    USING (
        agent_id = current_setting('app.current_agent_id', true)
        OR agent_id = 'default'
        OR current_setting('app.current_agent_id', true) IN ('system', 'admin')
    );
```

Access is granted only to fragments matching the agent ID, `default` agent fragments (shared data), and `system`/`admin` sessions (for maintenance). Tool handlers set the context via `SET LOCAL app.current_agent_id = $1` immediately before query execution.

### API Key-Based Memory Isolation

The `key_id` column provides an additional isolation layer at the API key level. Fragments stored via the master key (`MEMENTO_ACCESS_KEY`) have `key_id = NULL` and are queryable only by the master key. Fragments stored via a DB-issued API key have `key_id = <that key's ID>` and are queryable only by that key.

This isolation model implements per-key memory partitioning in multi-agent environments. API keys are managed through the Admin SPA (`/v1/internal/model/nothing`). On creation, the raw key (`mmcp_<slug>_<32 hex>`) is returned in the response exactly once; only the SHA-256 hash is stored in the database.

The Admin UI (`/v1/internal/model/nothing`) requires master key authentication. Authenticate via the Authorization Bearer header. A successful POST /auth issues an HttpOnly session cookie that is automatically attached to subsequent requests.

### Admin Console Structure

The Admin UI is built as an app shell architecture (`assets/admin/index.html` + `assets/admin/admin.css` + `assets/admin/admin.js`). It is divided into 7 navigation sections:

| Section | Description | Status |
|---------|-------------|--------|
| Overview | KPI cards, system health, search layer analysis, recent activity | Implemented |
| API Keys | Key list/creation/management, status changes, usage tracking | Implemented |
| Groups | Key group management, member assignment | Implemented |
| Memory Ops | Fragment search/filter, anomaly detection, search observability | Implemented |
| Sessions | Session list, detail view, activity tracking, manual reflect, terminate, expired cleanup, bulk unreflected reflect | Implemented |
| Logs | Log file listing, content viewing (reverse tail), level/search filters, statistics | Implemented |
| Knowledge Graph | Fragment relationship visualization (D3.js force-directed), topic filter, node detail | Implemented |

See [Admin Console Guide](docs/admin-console-guide.md) for screen layouts and operation details for each tab.

The `/stats` response includes `searchMetrics`, `observability`, `queues`, and `healthFlags` fields in addition to basic statistics.

### API Key Groups

API keys in the same group share an identical fragment isolation scope. Use this when multiple agents (Claude Code, Codex, Gemini, etc.) need to share a single project's memory.

- N:M mapping: A key can belong to multiple groups (`api_key_group_members` table)
- Isolation granularity: `COALESCE(group_id, api_keys.id)` is used as the effective_key_id during authentication
- Keys without a group: Existing behavior preserved (isolated by their own id)

Admin REST endpoints:

| Method | Path | Description |
|--------|------|-------------|
| GET | `.../groups` | Group list (includes key_count) |
| POST | `.../groups` | Create group (`{ name, description? }`) |
| DELETE | `.../groups/:id` | Delete group (membership CASCADE) |
| GET | `.../groups/:id/members` | List keys in a group |
| POST | `.../groups/:id/members` | Add a key to a group (`{ key_id }`) |
| DELETE | `.../groups/:gid/members/:kid` | Remove a key from a group |
| GET | `.../memory/overview` | Memory overview (type/topic distribution, quality unverified, superseded, recent activity) |
| GET | `.../memory/search-events?days=N` | Search event analysis (total searches, failed queries, feedback stats) |
| GET | `.../memory/fragments?topic=&type=&key_id=&page=&limit=` | Fragment search/filter (paginated) |
| GET | `.../memory/anomalies` | Anomaly detection results |
| GET | `.../sessions` | Session list (activity enrichment, unreflected session count) |
| GET | `.../sessions/:id` | Session detail (search events, tool feedback) |
| POST | `.../sessions/:id/reflect` | Manual reflect execution |
| DELETE | `.../sessions/:id` | Terminate session |
| POST | `.../sessions/cleanup` | Expired session cleanup |
| POST | `.../sessions/reflect-all` | Bulk reflect for unreflected sessions |
| GET | `.../logs/files` | Log file list (with sizes) |
| GET | `.../logs/read?file=&tail=&level=&search=` | Log content viewing (reverse tail, level/search filters) |
| GET | `.../logs/stats` | Log statistics (per-level counts, recent errors, disk usage) |
| GET | `.../assets/*` | Admin static files (admin.css, admin.js). No authentication required |

---

## Prompts

Pre-defined guidelines that help AI use the memory system efficiently.

| Name | Description | Primary Role |
|------|-------------|-------------|
| `analyze-session` | Session activity analysis | Guides automatic extraction of decisions, errors, and procedures worth saving from the current conversation |
| `retrieve-relevant-memory` | Relevant memory retrieval guide | Assists in finding optimal context by combining keyword and semantic search for a given topic |
| `onboarding` | System usage guide | Helps AI self-learn when and how to use Memento MCP tools |

---

## Resources

MCP resources for real-time queries on the current state of the memory system.

| URI | Description | Data Source |
|-----|-------------|-------------|
| `memory://stats` | System statistics | Per-type and per-tier counts and utility score averages from the `fragments` table |
| `memory://topics` | Topic list | All unique `topic` labels from the `fragments` table |
| `memory://config` | System configuration | Weights and TTL thresholds defined in `MEMORY_CONFIG` |
| `memory://active-session` | Session activity log | Current session tool usage history recorded in `SessionActivityTracker` (Redis) |

---

## 3-Layer Search

The recall tool searches from the least expensive layer first. If an earlier layer yields sufficient results, later layers are skipped.

![Retrieval Flow](assets/images/retrieval_flow.svg)

**L1: Redis Set intersection.** When a fragment is stored, FragmentIndex uses each keyword as a Redis Set key, storing the fragment ID. The Set `keywords:database` contains the IDs of all fragments with "database" as a keyword. Multi-keyword search is a SINTER operation across multiple Sets. Intersection time complexity is O(N*K), where N is the smallest Set's size and K is the keyword count. Since Redis processes this in-memory, it completes within milliseconds. L1 results are merged with L2 results in subsequent stages.

**L2: PostgreSQL GIN index.** Always executed after L1. A GIN (Generalized Inverted Index) is on the keywords TEXT[] column. Search uses the `keywords && ARRAY[...]` operator -- an operator that checks for array intersection. The GIN index indexes each array element individually, so this operation is processed as an index scan, not a sequential scan.

**L3: pgvector HNSW cosine similarity.** Triggered only when the recall parameters include a `text` field. Insufficient result count alone does not activate L3. The query text is converted to an embedding vector, and `embedding <=> $1` computes cosine distance. All embeddings are L2-normalized unit vectors, so cosine similarity and inner product are equivalent. HNSW indexes quickly find approximate nearest neighbors. The `threshold` parameter sets a similarity floor -- L3 results below this value are excluded. L1/L2-routed results lack a similarity value and are therefore exempt from threshold filtering.

All layer results pass through a `valid_to IS NULL` filter in the final stage -- fragments superseded via superseded_by are excluded from search by default. Passing `includeSuperseded: true` includes expired fragments.

Redis and embedding APIs are optional. Without them, the corresponding layers simply do not operate. PostgreSQL alone provides fully functional L2 search and core features.

**RRF hybrid merge.** When the `text` parameter is present, L2 and L3 run in parallel via `Promise.all`. Results are merged using Reciprocal Rank Fusion (RRF): `score(f) = sum w/(k + rank + 1)`, default k=60. L1 results are injected with highest priority by multiplying l1WeightFactor (default 2.0). Fragments that exist only in L1 and lack a content field (content not loaded) are excluded from final results. When only keywords/topic/type are used without the `text` parameter, the response contains only L1+L2 results without L3.

After the three layers' results are merged via RRF, time-semantic composite ranking is applied. Composite score formula: `score = effectiveImportance * 0.4 + temporalProximity * 0.3 + similarity * 0.3`. effectiveImportance is `importance + computeEmaRankBoost(ema_activation) * 0.5` -- fragments with higher ACT-R EMA activation (frequently recalled) receive additional ranking boost. `computeEmaRankBoost(ema) = 0.2 * (1 - e^{-ema})` with a maximum boost of 0.10. The cap was reduced from 0.3 to 0.2 because: an importance=0.65 fragment's effectiveImportance maxes at 0.65+0.10*0.5=0.70, falling short of the permanent promotion threshold (importance>=0.8) and preventing garbage fragments from cycling upward. temporalProximity is calculated via exponential decay from anchorTime (default: current time) -- `Math.pow(2, -distDays / 30)`. When anchorTime is set to a past moment, fragments closer to that point score higher. The `asOf` parameter is automatically converted to anchorTime and processed through the normal recall path. Final return volume is controlled by the `tokenBudget` parameter. The js-tiktoken cl100k_base encoder precisely calculates tokens per fragment, trimming when the budget is exceeded. Default token budget is 1000. Results can be paginated with `pageSize` and `cursor` parameters.

When `includeLinks: true` (default) is set on recall, linked fragments are fetched via a 1-hop traversal. The `linkRelationType` parameter filters for specific relation types -- when unspecified, caused_by, resolved_by, and related are included. The linked fragment fetch limit is `MEMORY_CONFIG.linkedFragmentLimit` (default 10).

---

## TTL Tiers

Fragments move across four tiers -- hot, warm, cold, permanent -- based on access frequency. MemoryConsolidator periodically handles demotion/promotion. Re-accessed fragments are restored to hot.

![Fragment Lifecycle](assets/images/fragment_lifecycle.svg)

| Tier | Description |
|------|-------------|
| hot | Recently created or frequently accessed fragments |
| warm | Default tier. Most long-term memories reside here |
| cold | Fragments not accessed for a long time. Candidates for deletion in the next maintenance cycle |
| permanent | Exempt from decay, TTL demotion, and expiration deletion |

Fragments stored with `scope: "session"` serve as session working memory. They are discarded when the session ends. `scope: "permanent"` is the default.

Fragments marked `isAnchor: true` are permanently excluded from MemoryConsolidator's decay and deletion regardless of their tier. Even with importance as low as 0.1, they will not be deleted. Use this for knowledge that must never be lost.

Stale thresholds (days): procedure=30, fact=60, decision=90, default=60. Adjust in `config/memory.js` under `MEMORY_CONFIG.staleThresholds`.

---

## MCP Tools

Defined in `lib/tools/memory.js` and registered via `lib/tool-registry.js`. DB direct-access tools such as db_query, db_tables, and db_schema are used only as internal utilities and are not exposed to MCP clients.

---

### remember

Stores knowledge as a fragment. Atomic units of 1-3 sentences are ideal. If the content already exists (by content_hash), duplicate storage is rejected. FragmentFactory masks PII before storage.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| content | string | Y | Content to remember. 300 characters recommended |
| topic | string | Y | Topic label (e.g., database, deployment, error-handling) |
| type | string | Y | fact / decision / error / preference / procedure / relation |
| keywords | string[] | | Search keywords. Auto-extracted from content if omitted |
| importance | number | | Importance 0.0~1.0. Type-specific defaults applied when omitted. Per-type caps applied at storage: error/procedure 0.6, fact/decision/relation 0.7, preference 0.9. is_anchor=true fragments have no cap. Content under 20 chars capped at 0.2 |
| source | string | | Source identifier (session ID, tool name, file path, etc.) |
| linkedTo | string[] | | Existing fragment IDs to link immediately on storage |
| scope | string | | permanent (default) / session |
| isAnchor | boolean | | When true, exempt from decay and expiration deletion |
| supersedes | string[] | | Existing fragment IDs to supersede. Creates superseded_by links, sets valid_to, and halves importance on the specified fragments |
| agentId | string | | Agent ID. Used for RLS isolation context |

Return value: `{ success: true, id: "...", created: true/false }`. When created is false, an existing fragment was returned (duplicate).

Immediately after storage, ConflictResolver's `autoLinkOnRemember` synchronously creates `related` links with fragments sharing the same topic. Then EmbeddingWorker generates embeddings asynchronously, and upon completion GraphLinker creates additional links to similar fragments in the same topic (similarity > 0.7) based on semantic similarity. Link types are determined by rules: same type + high similarity (> 0.85) yields `superseded_by`, error-type resolution relationships yield `resolved_by`, and everything else yields `related`. Up to 3 auto-links are created. Embedding generation and GraphLinker linking are decoupled from the remember response, so they do not affect response time.

---

### recall

Searches stored fragments. Keywords, topic, type, and natural language queries can be used individually or in combination.

| Parameter | Type | Description |
|-----------|------|-------------|
| keywords | string[] | Keywords for L1 Redis Set intersection search |
| topic | string | Restrict results to a specific topic |
| type | string | Restrict results to a specific type |
| text | string | Natural language query. Forces L3 vector search activation and L2+L3 parallel execution with RRF merge |
| tokenBudget | number | Maximum return tokens. Default 1000. cl100k_base based |
| includeLinks | boolean | Include 1-hop linked fragments. Default true |
| linkRelationType | string | caused_by / resolved_by / related / part_of / contradicts |
| threshold | number | L3 cosine similarity floor (0.0~1.0). Vector search results below this value are excluded |
| asOf | string | ISO 8601 datetime (e.g., "2026-01-15T00:00:00Z"). Converted to anchorTime so fragments closer to that point are prioritized |
| includeSuperseded | boolean | When true, include fragments with valid_to set (expired). Default false -- superseded fragments are excluded by default |
| excludeSeen | boolean | When true (default), exclude fragments already injected in the same session's preceding context() call. Prevents duplicate injection |
| cursor | string | Pagination cursor. Pass the previous result's nextCursor value for the next page |
| pageSize | number | Page size. Default 20, max 50 |
| agentId | string | Agent ID |

---

### forget

Deletes fragments. Permanent-tier fragments cannot be deleted without the force option.

| Parameter | Type | Description |
|-----------|------|-------------|
| id | string | Delete a single fragment by ID |
| topic | string | Delete all fragments for a specific topic |
| force | boolean | Allow forced deletion of permanent fragments. Default false |
| agentId | string | Agent ID |

Either id or topic must be provided. If both are present, id takes precedence. Topic-based deletion uses the L2 (PostgreSQL) path to bulk-delete fragments for that topic.

---

### link

Creates an explicit relationship between two fragments. Recorded in the fragment_links table and the linked_to array is also updated.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| fromId | string | Y | Source fragment ID |
| toId | string | Y | Target fragment ID |
| relationType | string | | related / caused_by / resolved_by / part_of / contradicts. Default related |
| agentId | string | | Agent ID |

Setting a `resolved_by` link between an error fragment and a resolution procedure fragment enables graph_explore to trace the causal chain.

---

### amend

Modifies the content or metadata of an existing fragment. The pre-edit state is preserved in fragment_versions. The ID and fragment_links are retained.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| id | string | Y | Target fragment ID |
| content | string | | New content. Truncated if over 300 characters |
| topic | string | | New topic |
| keywords | string[] | | New keyword list |
| type | string | | New type |
| importance | number | | New importance 0.0~1.0 |
| isAnchor | boolean | | Change anchor status |
| supersedes | boolean | | When true, explicitly marks this fragment as superseding the previous one. Creates superseded_by link and reduces the previous fragment's importance |
| agentId | string | | Agent ID |

---

### reflect

Converts an entire session into structured fragments for persistence at session end. Saves key decisions, error resolutions, new procedures, and open questions as separate fragments. A summary alone works, but providing decisions/errors_resolved/new_procedures/open_questions stores each as individual fragments of their respective types (decision/error/procedure/fact).

When sessionId is provided, only existing fragments from that session (Redis frag:sess, Working Memory) are consolidated and unprovided fields are auto-populated. Can be called with just sessionId and no summary.

Beyond manual invocation, AutoReflect runs automatically on session end/expiration/server shutdown. If Gemini CLI is available, it generates a structured summary from SessionActivityTracker's activity log; otherwise, it produces a minimal fact fragment based on metadata (duration, tool usage stats, fragment count). Sessions where AI manually called reflect skip auto-reflect.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| summary | string | | Overall session summary. Auto-generated from session fragments if only sessionId is provided |
| sessionId | string | | Session ID. When provided, consolidates only fragments from that session |
| decisions | string[] | | Technical/architectural decisions finalized in this session |
| errors_resolved | string[] | | Resolved errors. "Error description + resolution" format recommended |
| new_procedures | string[] | | New procedures/workflows established in this session |
| open_questions | string[] | | Unresolved questions or follow-up tasks |
| agentId | string | | Agent ID |
| task_effectiveness | object | | Session tool usage effectiveness summary. `{ overall_success: boolean, tool_highlights: string[], tool_pain_points: string[] }` |

---

### context

Restores memory system context at session start. Loads Core Memory (high-importance anchor fragments) and Working Memory (current session fragments) separately. Core Memory has triple controls: fragment count cap (default 15), per-type slot limits (preference:5, error:5, procedure:5, decision:3, fact:3) -- even within the token budget, no single type can dominate. Working Memory also has a fragment count cap (default 10). When unreflected sessions exist, injectionText includes a `[SYSTEM HINT]` with the session count.

| Parameter | Type | Description |
|-----------|------|-------------|
| tokenBudget | number | Maximum return tokens. Default 2000 |
| types | string[] | Types to load. Default: ["preference", "error", "procedure"] |
| sessionId | string | Session ID for working memory lookup |
| agentId | string | Agent ID |

---

### tool_feedback

Evaluates the usefulness of tool results. Call when recall or other tool results deviate significantly from expectations. Feedback is recorded in the tool_feedback table and used for long-term search quality improvement.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| tool_name | string | Y | Name of the evaluated tool |
| relevant | boolean | Y | Was the result relevant to the request intent |
| sufficient | boolean | Y | Was the result sufficient for task completion |
| fragment_ids | string[] | | Passing recall result fragment IDs adjusts their activation scores based on feedback (relevant=true: +0.1, false: -0.15) |
| suggestion | string | | Improvement suggestion. 100 characters recommended |
| context | string | | Usage context summary. 50 characters recommended |
| session_id | string | | Session ID |
| trigger_type | string | | sampled (hook-sampled request) / voluntary (AI voluntary call, default) |

---

### memory_stats

Queries the current state of the memory system. Total fragment count, TTL tier distribution, per-type statistics, embedding generation ratio, etc. No parameters.

The response includes a `searchLatencyMs` key. Returns P50/P90/P99 latencies (ms) from the last 100 searches per L1 (Redis) / L2 (PostgreSQL) / L3 (pgvector) / total layer.

```json
"searchLatencyMs": {
  "L1":    { "p50": 0,   "p90": 1,   "p99": 7,   "count": 26 },
  "L2":    { "p50": 4,   "p90": 175, "p99": 595, "count": 26 },
  "L3":    { "p50": 159, "p90": 595, "p99": 595, "count": 10 },
  "total": { "p50": 8,   "p90": 177, "p99": 597, "count": 26 }
}
```

The response also includes an `evaluation` key. IR quality metrics using `tool_feedback`/`task_feedback` as implicit ground truth.

| Field | Description |
|-------|-------------|
| `rolling_precision_at_5` | Recall Precision@5 rolling average over the last 100 sessions. Approximated by `relevant=true` ratio |
| `sufficient_rate` | `sufficient=true` ratio (0~1) |
| `sample_sessions` | Number of sessions used for evaluation |
| `task_success_rate` | `task_feedback.overall_success` ratio (30-day window) |
| `task_sessions` | Number of task sessions used for evaluation |

---

### memory_consolidate

Manually triggers the 18-step maintenance pipeline. It runs automatically every 6 hours via the internal scheduler, but manual invocation is also possible. No parameters.

---

### graph_explore

Traces causal relationship chains starting from an error fragment. A dedicated RCA (Root Cause Analysis) tool. Traverses caused_by and resolved_by relations 1-hop to return a connected graph linking error causes and resolution procedures.

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| startId | string | Y | Starting fragment ID. Error-type fragments recommended |
| agentId | string | | Agent ID |

---

### fragment_history

Queries the full edit history and supersession chain of a fragment. Returns previous versions modified via amend (fragment_versions) and the superseded_by link chain. Use to track "when and by what was this fragment superseded?"

| Parameter | Type | Required | Description |
|-----------|------|:--------:|-------------|
| id | string | Y | Target fragment ID |
| agentId | string | | Agent ID |

Return value: `{ current, versions, superseded_by_chain }`. current is the current fragment state, versions is an array of pre-amend versions (newest first), superseded_by_chain is an array of subsequent fragments that superseded this one.

---

## Recommended Usage Flow

- Session start -- Call `context()` to load core memories. Preferences, error patterns, and procedures are restored. If unreflected sessions exist, a hint is displayed.
- During work -- Save important decisions, errors, and procedures with `remember()`. Similar fragments are automatically linked at storage time. Use `recall()` to search past experience when needed. After resolving an error, clean up the error fragment with `forget()` and record the resolution procedure with `remember()`.
- Session end -- Use `reflect()` to persist session content as structured fragments. Even without manual invocation, AutoReflect runs automatically on session end/expiration.

---

## MemoryEvaluator

When the server starts, the MemoryEvaluator worker runs in the background. It is a singleton started via `getMemoryEvaluator().start()`. On SIGTERM/SIGINT, it stops as part of the graceful shutdown flow.

The worker polls the Redis queue `memory_evaluation` every 5 seconds. It waits when the queue is empty. When a job is dequeued, it calls Gemini CLI (`geminiCLIJson`) to evaluate the fragment content's soundness. Evaluation results are used to update the utility_score and verified_at in the fragments table.

New fragments are automatically enqueued for evaluation when stored via remember. Evaluation is decoupled from storage, so it does not affect remember call response time.

In environments where Gemini CLI is not installed, the worker starts but skips evaluation tasks.

---

## MemoryConsolidator

Fragment storage flow: When `remember()` is called, ConflictResolver's `autoLinkOnRemember` immediately creates `related` links with fragments sharing the same topic. When the `embedding_ready` event fires, GraphLinker adds semantic similarity-based links. MemoryConsolidator is a separate periodic pipeline that maintains this link network.

An 18-step maintenance pipeline that runs when the memory_consolidate tool is invoked or the internal scheduler triggers (every 6 hours, adjustable via CONSOLIDATE_INTERVAL_MS).

- **TTL tier transitions**: hot -> warm -> cold demotion based on access frequency and elapsed time. warm -> permanent promotion only targets fragments with importance>=0.8 and `quality_verified IS DISTINCT FROM FALSE` -- a Circuit Breaker pattern that blocks permanent tier entry for fragments explicitly judged negative (FALSE) (TRUE=normal, NULL+is_anchor=anchor fallback, NULL+importance>=0.9=offline fallback). Permanent-tier fragments with is_anchor=false + importance<0.5 + 180 days without access are demoted to cold (parole)
- **Importance decay**: Batch-processed via a single PostgreSQL `POWER()` SQL. Formula: `importance * 2^(-dt / halfLife)`. dt is computed from `COALESCE(last_decay_at, accessed_at, created_at)`. After application, `last_decay_at = NOW()` is set (idempotency). Per-type half-lives -- procedure:30d, fact:60d, decision:90d, error:45d, preference:120d, relation:90d, others:60d. `is_anchor=true` excluded, minimum 0.05 guaranteed
- **Expired fragment deletion (multi-dimensional GC)**: Judged by 5 composite conditions. (a) utility_score < 0.15 + 60 days inactive, (b) isolated fact/decision fragments (0 access, 0 links, 30+ days, importance < 0.2), (c) legacy compatibility condition (importance < 0.1, 90 days), (d) resolved error fragments (`[resolved]` prefix + 30+ days + importance < 0.3), (e) NULL type fragments (gracePeriod elapsed + importance < 0.2). Fragments within the 7-day gracePeriod are protected. Max 50 deletions per cycle. `is_anchor=true` and `permanent` tier excluded
- **Duplicate merging**: Fragments with identical content_hash are merged into the most important one. Links and access stats are consolidated
- **Missing embedding backfill**: Triggers async embedding generation for fragments with NULL embedding
- **Retroactive auto-linking (5.5)**: GraphLinker.retroLink() processes up to 20 orphan fragments that have embeddings but no links, automatically creating relationships
- **utility_score recalculation**: Updated via `importance * (1 + ln(max(access_count, 1))) / age_months^0.3`. Dividing by the 0.3 power of age (months) gradually lowers older fragments' scores (1 month / 1.00, 12 months / 2.29, 24 months / 2.88). Then registers fragments with ema_activation>0.3 AND importance<0.4 for MemoryEvaluator re-evaluation
- **Auto anchor promotion**: Promotes fragments with access_count >= 10 + importance >= 0.8 to `is_anchor=true`
- **Incremental contradiction detection (3-stage hybrid)**: For new fragments since the last check, extracts pairs with pgvector cosine similarity > 0.85 against existing fragments in the same topic (Stage 1). NLI classifier (mDeBERTa ONNX) determines entailment/contradiction/neutral (Stage 2) -- high-confidence contradictions (conf >= 0.8) are resolved immediately without Gemini, clear entailments pass through immediately. Only NLI-uncertain cases (numerical/domain contradictions) escalate to Gemini CLI (Stage 3). On confirmation, `contradicts` link + temporal logic resolution (older fragment importance reduced + `superseded_by` link). Resolution results are automatically recorded as `decision` type fragments (audit trail) -- trackable via `recall(keywords=["contradiction","resolved"])`. When CLI is unavailable, pairs with similarity > 0.92 are queued in a Redis pending queue
- **Pending contradiction post-processing**: When Gemini CLI becomes available, up to 10 items are dequeued for re-evaluation
- **Feedback report generation**: Aggregates tool_feedback/task_feedback data to produce per-tool usefulness reports
- **Feedback-adaptive importance correction (10.5)**: Combines the last 24 hours of tool_feedback data with session recall history to incrementally adjust importance. `sufficient=true`: +5%, `sufficient=false`: -2.5%, `relevant=false`: -5%. Criteria: fragments matching session_id, max 20/session, lr=0.05, clipped to [0.05, 1.0]. is_anchor=true fragments excluded
- **Redis index cleanup + stale fragment collection**: Removes orphaned keyword indexes and returns a list of fragments past their verification cycle
- **session_reflect noise cleanup**: Among topic='session_reflect' fragments, preserves only the latest 5 per type and deletes the rest with 30+ days age + importance < 0.3 (max 30 per cycle)
- **Supersession batch detection**: For fragment pairs with the same topic + type and embedding similarity in the 0.7~0.85 range, Gemini CLI determines if a supersession relationship exists. On confirmation, superseded_by link + valid_to set + importance halved. Operates complementarily to GraphLinker's >= 0.85 range
- **Decay application (EMA dynamic half-life)**: Applies exponential decay to all fragments via PostgreSQL `POWER()` batch SQL. Fragments with high `ema_activation` get their half-life extended up to 2x (`computeDynamicHalfLife`). Formula: `importance * 2^(-dt / (halfLife * clamp(1 + ema * 0.5, 1, 2)))`
- **EMA batch decay**: Periodically reduces ema_activation of long-unaccessed fragments. 60+ days unaccessed -> ema_activation=0 (reset), 30-60 days unaccessed -> ema_activation*0.5 (halved). is_anchor=true fragments excluded. Prevents long-idle fragments from retaining past boost values despite no search exposure

---

## Contradiction Detection Pipeline

A 3-stage hybrid architecture that suppresses O(N^2) LLM comparison costs while maintaining precision.

```
On new fragment storage
       |
pgvector cosine similarity > 0.85 candidate filter
       |
mDeBERTa NLI (in-process ONNX / external HTTP service)
  +-- contradiction >= 0.8  -> Immediate resolution (superseded_by link + valid_to update)
  +-- entailment   >= 0.6   -> Confirmed unrelated (no link created)
  +-- Other (ambiguous)     -> Gemini CLI escalation
       |
Temporal axis (valid_from/valid_to, superseded_by) preserves existing data
```

- **Cost efficiency**: 99% of candidates handled by NLI; LLM calls occur only for numerical/domain contradictions
- **Zero data loss**: Temporal columns manage versioning instead of deleting fragments
- **Implementation files**: `lib/memory/NLIClassifier.js`, `lib/memory/MemoryConsolidator.js`
- **Environment variable**: When `NLI_SERVICE_URL` is unset, ONNX in-process is used automatically (~280MB, downloaded on first run)

---

## MEMORY_CONFIG

Configuration file defined in `config/memory.js`. Ranking weights and stale thresholds can be adjusted without modifying server code.

```js
export const MEMORY_CONFIG = {
  ranking: {
    importanceWeight    : 0.4,   // Importance weight in time-semantic composite ranking
    recencyWeight       : 0.3,   // Temporal proximity weight (exponential decay from anchorTime)
    semanticWeight      : 0.3,   // Semantic similarity weight
    activationThreshold : 0,     // Always apply composite ranking
    recencyHalfLifeDays : 30,    // Temporal proximity half-life (days)
  },
  staleThresholds: {
    procedure: 30,   // Stale threshold for procedure fragments (days)
    fact      : 60,  // Stale threshold for fact fragments (days)
    decision  : 90,  // Stale threshold for decision fragments (days)
    default   : 60   // Stale threshold for other types (days)
  },
  halfLifeDays: {
    procedure : 30,  // Decay half-life -- time for importance to halve (days)
    fact      : 60,
    decision  : 90,
    error     : 45,
    preference: 120,
    relation  : 90,
    default   : 60
  },
  rrfSearch: {
    k             : 60,   // RRF denominator constant. Larger values reduce top-rank dependency
    l1WeightFactor: 2.0   // Weight multiplier for L1 Redis results (highest priority injection)
  },
  linkedFragmentLimit: 10,  // Max 1-hop linked fragments on recall with includeLinks
  embeddingWorker: {
    batchSize      : 10,      // Fragments per batch
    intervalMs     : 5000,    // Polling interval (ms)
    retryLimit     : 3,       // Retry count on failure
    retryDelayMs   : 2000,    // Retry interval (ms)
    queueKey       : "memento:embedding_queue"
  },
  contextInjection: {
    maxCoreFragments   : 15,     // Core Memory max fragment count
    maxWmFragments     : 10,     // Working Memory max fragment count
    typeSlots          : {       // Per-type max slots
      preference : 5,
      error      : 5,
      procedure  : 5,
      decision   : 3,
      fact       : 3
    },
    defaultTokenBudget : 2000
  },
  pagination: {
    defaultPageSize : 20,
    maxPageSize     : 50
  },
  gc: {
    utilityThreshold       : 0.15,   // Below this + inactive = deletion candidate
    gracePeriodDays        : 7,      // Minimum survival period (days)
    inactiveDays           : 60,     // Inactivity period (days)
    maxDeletePerCycle      : 50,     // Max deletions per cycle
    factDecisionPolicy     : {
      importanceThreshold  : 0.2,    // GC importance threshold for fact/decision
      orphanAgeDays        : 30      // Orphan fact/decision deletion threshold (days)
    },
    errorResolvedPolicy    : {
      maxAgeDays           : 30,     // [resolved] error fragment deletion threshold (days)
      maxImportance        : 0.3     // Below this = deletion candidate
    }
  },
  reflectionPolicy: {
    maxAgeDays       : 30,       // session_reflect fragment deletion threshold (days)
    maxImportance    : 0.3,      // Below this = deletion candidate
    keepPerType      : 5,        // Keep latest N per type
    maxDeletePerCycle: 30        // Max deletions per cycle
  },
  semanticSearch: {
    minSimilarity: 0.2,          // L3 pgvector search minimum similarity (default 0.2)
    limit        : 10            // L3 max return count
  },
  temperatureBoost: {
    warmWindowDays     : 7,      // Apply warmBoost to fragments accessed within this window
    warmBoost          : 0.2,    // Score boost for recently accessed fragments
    highAccessBoost    : 0.15,   // Score boost for fragments exceeding access threshold
    highAccessThreshold: 5,      // Access count threshold for highAccessBoost
    learningBoost      : 0.3     // Score boost for learning_extraction fragments
  }
};
```

The sum of importanceWeight + recencyWeight + semanticWeight must equal 1.0. halfLifeDays determines decay speed and operates independently of staleThresholds. rrfSearch.k is the RRF denominator stabilization constant, with 60 as the general-purpose default. gc.factDecisionPolicy cleans up orphan fact/decision fragments under separate criteria to reduce search noise.

---

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| PORT | 57332 | HTTP listen port |
| MEMENTO_ACCESS_KEY | (none) | Bearer authentication key. Authentication disabled when unset |
| SESSION_TTL_MINUTES | 60 | Session TTL (minutes) |
| LOG_DIR | /var/log/mcp | Winston log file directory |
| ALLOWED_ORIGINS | (none) | Allowed Origins list. Comma-separated. All origins allowed when unset |
| RATE_LIMIT_WINDOW_MS | 60000 | Rate limiting window size (ms) |
| RATE_LIMIT_MAX_REQUESTS | 120 | Max requests per IP per window |
| CONSOLIDATE_INTERVAL_MS | 21600000 | Auto-maintenance (consolidate) interval (ms). Default 6 hours |
| EVALUATOR_MAX_QUEUE | 100 | MemoryEvaluator queue size cap (older jobs dropped on overflow) |
| OAUTH_ALLOWED_REDIRECT_URIS | (none) | OAuth redirect_uri allowed prefixes (comma-separated, only localhost allowed when unset) |

### PostgreSQL

POSTGRES_* prefixes take precedence over DB_* prefixes. Both formats can be mixed.

| Variable | Description |
|----------|-------------|
| POSTGRES_HOST / DB_HOST | Host address |
| POSTGRES_PORT / DB_PORT | Port number. Default 5432 |
| POSTGRES_DB / DB_NAME | Database name |
| POSTGRES_USER / DB_USER | Connection user |
| POSTGRES_PASSWORD / DB_PASSWORD | Connection password |
| DB_MAX_CONNECTIONS | Connection pool max connections. Default 20 |
| DB_IDLE_TIMEOUT_MS | Idle connection return timeout ms. Default 30000 |
| DB_CONN_TIMEOUT_MS | Connection acquisition timeout ms. Default 10000 |
| DB_QUERY_TIMEOUT | Query timeout ms. Default 30000 |

### Redis

| Variable | Default | Description |
|----------|---------|-------------|
| REDIS_ENABLED | false | Enable Redis. When false, L1 search and caching are disabled |
| REDIS_SENTINEL_ENABLED | false | Use Sentinel mode |
| REDIS_HOST | localhost | Redis server host |
| REDIS_PORT | 6379 | Redis server port |
| REDIS_PASSWORD | (none) | Redis authentication password |
| REDIS_DB | 0 | Redis database number |
| REDIS_MASTER_NAME | mymaster | Sentinel master name |
| REDIS_SENTINELS | localhost:26379, localhost:26380, localhost:26381 | Sentinel node list. Comma-separated host:port format |

### Caching

| Variable | Default | Description |
|----------|---------|-------------|
| CACHE_ENABLED | Same as REDIS_ENABLED | Enable query result caching |
| CACHE_DB_TTL | 300 | DB query result cache TTL (seconds) |
| CACHE_SESSION_TTL | SESSION_TTL_MS / 1000 | Session cache TTL (seconds) |

### AI

| Variable | Default | Description |
|----------|---------|-------------|
| OPENAI_API_KEY | (none) | OpenAI API key. Used when `EMBEDDING_PROVIDER=openai` |
| EMBEDDING_PROVIDER | openai | Embedding provider. `openai` \| `gemini` \| `ollama` \| `localai` \| `custom` |
| EMBEDDING_API_KEY | (none) | Generic embedding API key. Falls back to `OPENAI_API_KEY` when unset |
| EMBEDDING_BASE_URL | (none) | OpenAI-compatible endpoint URL when `EMBEDDING_PROVIDER=custom` |
| EMBEDDING_MODEL | (provider default) | Embedding model to use. Provider-specific default applied when omitted |
| EMBEDDING_DIMENSIONS | (provider default) | Embedding vector dimensions. Must match the DB schema's vector dimension |
| EMBEDDING_SUPPORTS_DIMS_PARAM | (provider default) | Override dimensions parameter support (`true`\|`false`) |
| GEMINI_API_KEY | (none) | Google Gemini API key. Used when `EMBEDDING_PROVIDER=gemini` |

---

## Switching Embedding Providers

Switch providers with a single `EMBEDDING_PROVIDER` environment variable. Model, dimensions, and base URL are automatically determined from provider defaults, with individual environment variable overrides available as needed.

Embeddings are used for L3 semantic search and automatic link creation.

> Dimension change warning: Changing `EMBEDDING_DIMENSIONS` requires a PostgreSQL schema change. Run `node scripts/migration-007-flexible-embedding-dims.js` followed by `node scripts/backfill-embeddings.js` in order.

---

### OpenAI (default)

```env
EMBEDDING_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| text-embedding-3-small | 1536 | Default. Cost-efficient |
| text-embedding-3-large | 3072 | High precision. 2x cost |
| text-embedding-ada-002 | 1536 | Legacy compatible |

---

### Google Gemini

`text-embedding-004` was discontinued January 14, 2026. The currently recommended model is `gemini-embedding-001` (3072 dimensions).

```env
EMBEDDING_PROVIDER=gemini
GEMINI_API_KEY=AIza...
```

3072 dimensions differs from the default schema (1536), so migration-007 must be run on first switch:

```bash
EMBEDDING_DIMENSIONS=3072 DATABASE_URL=$DATABASE_URL \
  node scripts/migration-007-flexible-embedding-dims.js
DATABASE_URL=$DATABASE_URL node scripts/backfill-embeddings.js
```

> halfvec type requires pgvector 0.7.0 or later. Check version: `SELECT extversion FROM pg_extension WHERE extname = 'vector';`

| Model | Dimensions | Notes |
|-------|-----------|-------|
| gemini-embedding-001 | 3072 | Current recommended model. High precision |
| text-embedding-004 | 768 | Discontinued 2026-01-14 |

---

### Ollama (local)

Ollama must be running at `http://localhost:11434`.

```env
EMBEDDING_PROVIDER=ollama
# EMBEDDING_MODEL=nomic-embed-text  # default
```

```bash
# Download models
ollama pull nomic-embed-text
ollama pull mxbai-embed-large
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| nomic-embed-text | 768 | 8192 token context, high MTEB performance |
| mxbai-embed-large | 1024 | 512 context, competitive MTEB scores |
| all-minilm | 384 | Ultra-lightweight, suitable for local testing |

---

### LocalAI (local)

```env
EMBEDDING_PROVIDER=localai
```

---

### Custom OpenAI-Compatible Server

Use for any OpenAI-compatible server such as LM Studio or llama.cpp.

```env
EMBEDDING_PROVIDER=custom
EMBEDDING_BASE_URL=http://my-server:8080/v1
EMBEDDING_API_KEY=my-key
EMBEDDING_MODEL=my-model
EMBEDDING_DIMENSIONS=1024
```

---

### Commercial APIs (Custom Adapter Required)

Cohere, Voyage AI, Mistral, Jina AI, and Nomic are either incompatible with the OpenAI SDK or have separate API structures. Replace the `generateEmbedding` function in `lib/tools/embedding.js` with the examples below.

#### Cohere

```bash
npm install cohere-ai
```

```js
// lib/tools/embedding.js -- replace generateEmbedding
import { CohereClient } from "cohere-ai";

const cohere = new CohereClient({ token: process.env.COHERE_API_KEY });

export async function generateEmbedding(text) {
  const res = await cohere.v2.embed({
    model:          "embed-v4.0",
    inputType:      "search_document",
    embeddingTypes: ["float"],
    texts:          [text]
  });
  return normalizeL2(res.embeddings.float[0]);
}
```

```env
COHERE_API_KEY=...
EMBEDDING_DIMENSIONS=1536
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| embed-v4.0 | 1536 | Latest, multilingual |
| embed-multilingual-v3.0 | 1024 | Legacy multilingual |

---

#### Voyage AI

```js
// lib/tools/embedding.js -- replace generateEmbedding
export async function generateEmbedding(text) {
  const res = await fetch("https://api.voyageai.com/v1/embeddings", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.VOYAGE_API_KEY}`,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify({ model: "voyage-3.5", input: [text] })
  });
  const data = await res.json();
  return normalizeL2(data.data[0].embedding);
}
```

```env
VOYAGE_API_KEY=...
EMBEDDING_DIMENSIONS=1024
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| voyage-3.5 | 1024 | Highest accuracy |
| voyage-3.5-lite | 512 | Low cost, fast |
| voyage-code-3 | 1024 | Code-specialized |

---

#### Mistral AI

OpenAI SDK compatible, so just swap the `baseURL`.

```js
// lib/tools/embedding.js -- replace generateEmbedding
import OpenAI from "openai";

const client = new OpenAI({
  apiKey:  process.env.MISTRAL_API_KEY,
  baseURL: "https://api.mistral.ai/v1"
});

export async function generateEmbedding(text) {
  const res = await client.embeddings.create({
    model: "mistral-embed",
    input: [text]
  });
  return normalizeL2(res.data[0].embedding);
}
```

```env
MISTRAL_API_KEY=...
EMBEDDING_DIMENSIONS=1024
```

---

#### Jina AI

Free tier: 100 RPM / 1M tokens/month.

```js
// lib/tools/embedding.js -- replace generateEmbedding
export async function generateEmbedding(text) {
  const res = await fetch("https://api.jina.ai/v1/embeddings", {
    method:  "POST",
    headers: {
      "Authorization": `Bearer ${process.env.JINA_API_KEY}`,
      "Content-Type":  "application/json"
    },
    body: JSON.stringify({
      model: "jina-embeddings-v3",
      task:  "retrieval.passage",
      input: [text]
    })
  });
  const data = await res.json();
  return normalizeL2(data.data[0].embedding);
}
```

```env
JINA_API_KEY=...
EMBEDDING_DIMENSIONS=1024
```

| Model | Dimensions | Notes |
|-------|-----------|-------|
| jina-embeddings-v3 | 1024 | MRL support (32~1024 flexible dimensions) |
| jina-embeddings-v2-base-en | 768 | English-specialized |

---

#### Nomic

Free tier: 1M tokens/month. OpenAI SDK compatible, so applicable via `baseURL` change.

```js
// lib/tools/embedding.js -- replace generateEmbedding
import OpenAI from "openai";

const client = new OpenAI({
  apiKey:  process.env.NOMIC_API_KEY,
  baseURL: "https://api-atlas.nomic.ai/v1"
});

export async function generateEmbedding(text) {
  const res = await client.embeddings.create({
    model: "nomic-embed-text-v1.5",
    input: [text]
  });
  return normalizeL2(res.data[0].embedding);
}
```

```env
NOMIC_API_KEY=...
EMBEDDING_DIMENSIONS=768
```

---

### Provider Comparison

| Service | Dimensions | Configuration | Free Tier |
|---------|-----------|---------------|-----------|
| OpenAI text-embedding-3-small | 1536 | `EMBEDDING_PROVIDER=openai` | None |
| OpenAI text-embedding-3-large | 3072 | `EMBEDDING_PROVIDER=openai` | None |
| Google Gemini gemini-embedding-001 | 3072 | `EMBEDDING_PROVIDER=gemini` | Yes (limited) |
| Ollama (nomic-embed-text) | 768 | `EMBEDDING_PROVIDER=ollama` | Fully free (local) |
| Ollama (mxbai-embed-large) | 1024 | `EMBEDDING_PROVIDER=ollama` | Fully free (local) |
| LocalAI | Variable | `EMBEDDING_PROVIDER=localai` | Fully free (local) |
| Custom compatible server | Variable | `EMBEDDING_PROVIDER=custom` | -- |
| Cohere embed-v4.0 | 1536 | Code replacement | None |
| Voyage AI voyage-3.5 | 1024 | Code replacement | None |
| Mistral mistral-embed | 1024 | Code replacement | None |
| Jina jina-embeddings-v3 | 1024 | Code replacement | Yes (1M/month) |
| Nomic nomic-embed-text-v1.5 | 768 | Code replacement | Yes (1M/month) |

---

## HTTP Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | /mcp | Streamable HTTP. JSON-RPC request receiver. MCP-Session-Id header required (except initial initialize) |
| GET | /mcp | Streamable HTTP. Opens SSE stream. For server-side push |
| DELETE | /mcp | Streamable HTTP. Explicit session termination |
| GET | /sse | Legacy SSE. Session creation. Authenticate via `accessKey` query parameter |
| POST | /message?sessionId= | Legacy SSE. JSON-RPC request receiver. Responses delivered via SSE stream |
| GET | /health | Health check. Verifies DB query (SELECT 1), session state, and Redis connection, returning JSON. When `REDIS_ENABLED=false`, Redis shows as `disabled` with 200 returned. DB failure returns 503 |
| GET | /metrics | Prometheus metrics. HTTP request counters, session gauges, etc. collected by prom-client |
| GET | /.well-known/oauth-authorization-server | OAuth 2.0 authorization server metadata |
| GET | /.well-known/oauth-protected-resource | OAuth 2.0 protected resource metadata |
| GET | /authorize | OAuth 2.0 authorization endpoint. PKCE code_challenge required |
| POST | /token | OAuth 2.0 token endpoint. authorization_code exchange |
| GET | /v1/internal/model/nothing | Admin SPA. Serves app shell HTML (no auth required). Data APIs require master key authentication |
| GET | /v1/internal/model/nothing/assets/* | Admin static files (admin.css, admin.js). No authentication required |
| POST | /v1/internal/model/nothing/auth | Master key verification endpoint |
| GET | /v1/internal/model/nothing/stats | Dashboard statistics (fragment count, API call volume, system metrics, searchMetrics, observability, queues, healthFlags) |
| GET | /v1/internal/model/nothing/activity | Recent fragment activity log (10 entries) |
| GET | /v1/internal/model/nothing/keys | API key list |
| POST | /v1/internal/model/nothing/keys | Create API key. Raw key returned in response exactly once |
| PUT | /v1/internal/model/nothing/keys/:id | Change API key status (active <-> inactive) |
| DELETE | /v1/internal/model/nothing/keys/:id | Delete API key |
| GET | /v1/internal/model/nothing/groups | Key group list |
| POST | /v1/internal/model/nothing/groups | Create key group |
| DELETE | /v1/internal/model/nothing/groups/:id | Delete key group |
| GET | /v1/internal/model/nothing/groups/:id/members | Group member list |
| POST | /v1/internal/model/nothing/groups/:id/members | Add key to group |
| DELETE | /v1/internal/model/nothing/groups/:gid/members/:kid | Remove key from group |
| GET | /v1/internal/model/nothing/memory/overview | Memory overview (type/topic distribution, quality unverified, superseded, recent activity) |
| GET | /v1/internal/model/nothing/memory/search-events?days=N | Search event analysis (total searches, failed queries, feedback stats) |
| GET | /v1/internal/model/nothing/memory/fragments | Fragment search/filter (topic, type, key_id, page, limit) |
| GET | /v1/internal/model/nothing/memory/anomalies | Anomaly detection results |
| GET | /v1/internal/model/nothing/sessions | Session list (activity enrichment, unreflected session count) |
| GET | /v1/internal/model/nothing/sessions/:id | Session detail (search events, tool feedback) |
| POST | /v1/internal/model/nothing/sessions/:id/reflect | Manual reflect execution |
| DELETE | /v1/internal/model/nothing/sessions/:id | Terminate session |
| POST | /v1/internal/model/nothing/sessions/cleanup | Expired session cleanup |
| POST | /v1/internal/model/nothing/sessions/reflect-all | Bulk reflect for unreflected sessions |
| GET | /v1/internal/model/nothing/logs/files | Log file list (with sizes) |
| GET | /v1/internal/model/nothing/logs/read | Log content viewing (file, tail, level, search parameters) |
| GET | /v1/internal/model/nothing/logs/stats | Log statistics (per-level counts, recent errors, disk usage) |
| GET | /v1/internal/model/nothing/memory/graph?topic=&limit= | Knowledge graph data (nodes + edges) |
| GET | /v1/internal/model/nothing/export?key_id=&topic= | Fragment JSON Lines stream export |
| POST | /v1/internal/model/nothing/import | Fragment JSON array import |

### /health Endpoint Policy

| Dependency | Classification | Response when down |
|------------|---------------|-------------------|
| PostgreSQL | Required | 503 (degraded) |
| Redis | Optional | 200 (healthy, with warnings) |

Even when Redis is disabled (`REDIS_ENABLED=false`) or connection fails, the server returns healthy (200). L1 cache and Working Memory are deactivated, but core memory storage/retrieval operates fully on PostgreSQL alone.

Two authentication methods are available. Streamable HTTP authenticates via `Authorization: Bearer <MEMENTO_ACCESS_KEY>` header on the `initialize` request, then maintains the session. Legacy SSE authenticates via `/sse?accessKey=<MEMENTO_ACCESS_KEY>` query parameter.

---

## Tech Stack

- Node.js 20+
- PostgreSQL 14+ (pgvector extension)
- Redis 6+ (optional)
- OpenAI Embedding API (optional)
- Gemini CLI (for quality evaluation, contradiction escalation, auto reflect summary generation; optional)
- @huggingface/transformers + ONNX Runtime (NLI contradiction classification, CPU only, auto-installed)
- MCP Protocol 2025-11-25

PostgreSQL alone powers all core features. Adding Redis enables L1 cascade search and SessionActivityTracker. Adding an OpenAI API enables L3 semantic search and automatic linking. The NLI model is included automatically on npm install, with the ~280MB ONNX model downloaded on first run (cached afterward). NLI alone detects clear logical contradictions immediately; adding Gemini CLI extends coverage to numerical/domain contradictions. Each component can be independently enabled or disabled.

---

## Tests

### Full test suite (no DB required)
```bash
npm test          # Jest (tests/*.test.js) + node:test (tests/unit/*.test.js) sequential. tests/unit/ is node:test exclusive and excluded from Jest.
```

Individual runs:
```bash
npm run test:jest        # Jest -- tests/*.test.js
npm run test:unit:node   # node:test -- tests/unit/*.test.js
npm run test:integration # node:test -- tests/integration/*.test.js + tests/e2e/*.test.js
```

### E2E tests (PostgreSQL required)

Local Docker environment (recommended):
```bash
npm run test:e2e:local   # Starts test DB via docker-compose then runs
```

Using an existing DB connection:
```bash
DATABASE_URL=postgresql://user:pass@host:port/db npm run test:e2e
```

### Full CI (DB required)
```bash
npm run test:ci          # npm test + test:e2e
```

---

## Installation

For installation, migration, Claude Code connection, and hook setup, see **[INSTALL.md](docs/INSTALL.md)**.

```bash
npm run migrate    # DB migration (schema_migrations table-based incremental)
```

---

## Why I Built This

Working with AI in production, I kept wasting time re-explaining the same context every single day. I tried embedding notes in system prompts, but the limitations were obvious. As fragments piled up, management fell apart -- search stopped working, and old information clashed with new.

The biggest problem was the endless repetition. Having to re-state things I had already explained, re-confirm settings that were already in place. I would painstakingly correct the AI, get it working perfectly -- only to start a new session and face the exact same issues all over again. It felt like being the training supervisor for a brilliant new hire who graduated top of their class but has their memory wiped clean every morning.

To solve this pain, I designed a system that decomposes memories into atomic units, searches them hierarchically, and lets them decay naturally over time. Just as humans are creatures of forgetting, this system embraces "appropriate forgetting" as a feature.

---

Memory is not the prerequisite of intelligence. Memory is the condition for it. Even if you know how to play chess, failing to remember yesterday's lost game means repeating the same moves. Even if you speak every language, failing to remember yesterday's conversation means meeting a stranger every time. Even with billions of parameters holding all the world's knowledge, failing to remember yesterday with you makes the AI nothing more than an unfamiliar polymath.

Memory is what enables relationships. Relationships are what enable trust.

Memories do not disappear. They simply drop to the cold tier. And cold fragments left neglected long enough are purged in the next consolidate cycle. This is by design, not a bug. Useless memories must make room. Even the palace of Augustine needs its storeroom tidied.

Even a goldfish -- famously considered brainless -- can remember things for months.

Now your AI can too.

---

<p align="center">
  Made by <a href="mailto:jinho.von.choi@nerdvana.kr">Jinho Choi</a> &nbsp;|&nbsp;
  <a href="https://buymeacoffee.com/jinho.von.choi">Buy me a coffee</a>
</p>
