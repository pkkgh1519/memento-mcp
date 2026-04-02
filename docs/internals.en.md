# Internals

## MemoryEvaluator

When the server starts, the MemoryEvaluator worker runs in the background. It is a singleton started via `getMemoryEvaluator().start()`. On SIGTERM/SIGINT, it stops as part of the graceful shutdown flow.

The worker polls the Redis queue `memory_evaluation` every 5 seconds. It waits when the queue is empty. When a job is dequeued, it calls Gemini CLI (`geminiCLIJson`) to evaluate the fragment content's soundness. Evaluation results are used to update the utility_score and verified_at in the fragments table.

New fragments are enqueued for evaluation when stored via remember. However, fact, procedure, and error types are excluded. Only decision, preference, and relation types are evaluated. Evaluation is decoupled from storage, so it does not affect remember call response time.

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

## Session and Authentication Internals

### updateTtlTier key_id Isolation

`FragmentWriter.updateTtlTier` accepts a `keyId` parameter and appends a `key_id` condition to the UPDATE query. This blocks cross-key access where a different API key could modify the TTL tier of fragments it does not own. When keyId is null, only master-key-owned fragments (`key_id IS NULL`) are targeted.

### Workspace Filter Propagation

`FragmentSearch._buildSearchQuery()` normalizes the `workspace` value into `sq.workspace`. `_executeSearch()` passes it to L2 (keyword/topic) search options and as the 8th argument to L3 `searchBySemantic`.

All six `FragmentReader` methods — `searchByKeywords`, `searchByTopic`, `searchBySemantic`, `searchByTimeRange`, `searchAsOf`, and `searchBySource` — support the `(workspace = $N OR workspace IS NULL)` condition. `_searchTemporal` also passes `workspace: sq.workspace` to `searchByTimeRange`.

`MemoryManager` workspace resolution priority: `params.workspace ?? params._defaultWorkspace ?? null`. `_defaultWorkspace` is read from `api_keys.default_workspace` at auth time, stored in the session, and injected as `args._defaultWorkspace` on each tool call.

### Session Auto-Recovery

When a "Session not found" or "Session expired" error occurs in the session store, the server immediately runs a re-authentication flow. During re-authentication, the original session's `keyId` and `groupKeyIds` are restored and injected into the new session. The reconnection is transparent to the client; the re-authentication event is recorded in the audit log.

Legacy SSE sessions also apply a sliding window: `expiresAt` is refreshed to `now + SESSION_TTL_MS` on every validated request.

### Redis TTL Sync

`validateStreamableSession` uses the actual remaining TTL read from Redis instead of a fixed `CACHE_SESSION_TTL` when refreshing a session. As a session approaches expiration, its remaining lifetime is preserved accurately after each refresh.

### SSE Disconnect

When an SSE stream closes (`res.on('close')`), the server removes only the SSE response object; the session itself is kept alive. The session persists until its Redis TTL expires, allowing a reconnecting client to resume the same session.

### OAuth refresh_token is_api_key Propagation

When refreshing a token via `POST /token` with `grant_type=refresh_token`, the `is_api_key` flag from the original token is propagated to the newly issued access_token and refresh_token. API key-based clients retain the same isolation context after a refresh.

### SESSION_TTL Default Change

The default value of the `SESSION_TTL` environment variable changed from 240 to 43200 minutes (30 days). Sessions use a sliding window — the TTL is extended on every tool use, so sessions expire only after 30 days of inactivity. Actively used sessions effectively never expire.

---

## Reranker (Cross-Encoder Reranking)

After RRF merging, the top 30 candidates are reranked by a cross-encoder for higher precision. `preloadReranker()` is called asynchronously at server startup to prepare the model before the first recall request.

**Dual mode:**
- `RERANKER_URL` set: external HTTP service (`POST /rerank { query, documents[] } → { scores[] }`)
- Not set: `@huggingface/transformers` + ONNX `ms-marco-MiniLM-L-6-v2` in-process (~80MB, CPU)

**Automatic external-to-inprocess fallback:** After 3 consecutive failures, switches to in-process mode permanently until server restart. In either mode, if scores cannot be retrieved, the original RRF result is returned unchanged (graceful degradation).

**Final score:** `sigmoid(logit) * recency_boost`. recency_boost uses 365-day linear decay in the [0.9, 1.1] range.

---

## TemporalLinker (Time-Based Auto-Linking)

Runs asynchronously in the `MemoryManager._autoLinkOnRemember()` chain on every `remember()` call. Creates `temporal` links between the new fragment and existing fragments within ±24h that share the same `topic` (up to 5 links).

**Weight formula:** `max(0.3, 1.0 - hours/24)` — 0h=1.0, 12h=0.5, 24h=0.3.

**API key isolation:** `options.keyId` is forwarded as `key_id = ANY($n)` in the SQL query so that fragments owned by other API keys are never linked.

`fragment_links.weight` was changed from integer to real in migration-023 to support float weights.

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
