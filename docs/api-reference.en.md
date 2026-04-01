# API Reference

For MCP tool details, see [SKILL.md](../SKILL.md).

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
| PUT | /v1/internal/model/nothing/keys/:id/daily-limit | Change API key daily call limit. Master key required |
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

Accessing a protected resource without authentication returns `401 Unauthorized` with a `WWW-Authenticate: Bearer resource_metadata="</.well-known/oauth-protected-resource URL>"` header.

---

## OAuth 2.0

Supports RFC 7591 Dynamic Client Registration and PKCE-based Authorization Code Flow.

### /.well-known/oauth-authorization-server

The server metadata response includes a `registration_endpoint`.

```json
{
  "issuer": "https://{domain}",
  "authorization_endpoint": "https://{domain}/authorize",
  "token_endpoint": "https://{domain}/token",
  "registration_endpoint": "https://{domain}/register",
  "response_types_supported": ["code"],
  "grant_types_supported": ["authorization_code"],
  "code_challenge_methods_supported": ["S256"]
}
```

### POST /register

RFC 7591 Dynamic Client Registration. No authentication required.

Request body:

```json
{
  "client_name": "Claude",
  "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"]
}
```

Response 201:

```json
{
  "client_id": "mmcp_...",
  "client_name": "Claude",
  "redirect_uris": ["https://claude.ai/api/mcp/auth_callback"],
  "grant_types": ["authorization_code"],
  "token_endpoint_auth_method": "none"
}
```

> API keys (mmcp_xxx) can be used directly as `client_id`. This applies when reusing an existing API key as an OAuth client in Claude.ai Web Integration.

### GET /authorize

OAuth 2.0 authorization endpoint. PKCE `code_challenge` and `code_challenge_method=S256` are required.

Query parameters: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method`, `state` (optional).

Renders a user consent screen. After consent, returns a 302 redirect to `redirect_uri` with the `code` parameter.

### POST /authorize

Submitted as form data when the user allows or denies on the consent screen.

| Field | Value |
|-------|-------|
| `decision` | `allow` or `deny` |
| `response_type` | Original OAuth parameter |
| `client_id` | Original OAuth parameter |
| `redirect_uri` | Original OAuth parameter |
| `code_challenge` | Original OAuth parameter |
| `code_challenge_method` | Original OAuth parameter |
| `state` | Original OAuth parameter (if present) |

- `decision=allow`: 302 redirect to `redirect_uri?code=<code>&state=<state>`
- `decision=deny`: 302 redirect to `redirect_uri?error=access_denied`

### PUT /v1/internal/model/nothing/keys/:id/daily-limit

Change the daily call limit for an API key. Master key required.

Request body:

```json
{ "daily_limit": 50000 }
```

Response:

```json
{ "success": true, "daily_limit": 50000 }
```

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

## Recommended Usage Flow

- Session start -- Call `context()` to load core memories. Preferences, error patterns, and procedures are restored. If unreflected sessions exist, a hint is displayed.
- During work -- Save important decisions, errors, and procedures with `remember()`. Similar fragments are automatically linked at storage time. Use `recall()` to search past experience when needed. After resolving an error, clean up the error fragment with `forget()` and record the resolution procedure with `remember()`.
- Session end -- Use `reflect()` to persist session content as structured fragments. Even without manual invocation, AutoReflect runs automatically on session end/expiration.
