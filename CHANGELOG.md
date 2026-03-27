# Changelog

## [1.8.0] - 2026-03-28

### Added
- RBAC: tool-level permission enforcement (read/write/admin) via lib/rbac.js
- Fragment import/export API: GET /export (JSON Lines stream), POST /import
- Knowledge graph visualization: GET /memory/graph API + D3.js force-directed Admin tab
- Search quality dashboard: path distribution, latency percentiles (p50/p90/p99), top keywords, zero-result rate
- DB migration runner: scripts/migrate.js with transaction safety and schema_migrations tracking
- MemoryManager.create() static factory for dependency injection in tests
- MemoryEvaluator backpressure: queue size cap (EVALUATOR_MAX_QUEUE env, default 100)
- Sentiment-aware decay: tool_feedback fragment_ids parameter adjusts ema_activation
- Closed learning loop: searchPath tracking in SessionActivityTracker, learning extraction in AutoReflect, context() priority injection for learning fragments
- Temperature-weighted context sorting: warm window + access count + learning source boost
- FragmentReader.searchBySource() for source-based fragment queries

### Changed
- Admin routes split into 5 focused modules (admin-auth, admin-keys, admin-memory, admin-sessions, admin-logs)
- Admin authentication: QS ?key= replaced with opaque session token cookie (HttpOnly, SameSite=Strict)
- Gemini API key moved from URL query parameter to x-goog-api-key header
- ESLint config: browser globals added for assets/**/*.js
- Jest/node:test boundary: tests/unit/ excluded from Jest (node:test only), tests/*.test.js for Jest
- context() extras sorting uses temperature score (importance + warm boost + access count + learning boost)
- config/memory.js: added temperatureBoost, learning typeSlot

### Fixed
- npm audit vulnerabilities (flatted, picomatch, brace-expansion)
- ESLint 606 errors from missing browser globals
- Jest 34/42 suite failures from node:test module resolution
- Admin cookie auth: validateAdminAccess used instead of validateMasterKey in API dispatcher
- Export query: nonexistent updated_at column replaced with accessed_at

### Security
- Admin QS key exposure eliminated (cookie-based session tokens)
- Gemini API key no longer appears in URL query strings or logs
- RBAC prevents read-only API keys from executing write operations

## [1.7.0] - 2026-03-26

### Added
- Admin operations console with 6 management tabs (overview, API keys, groups, memory operations, sessions, system logs)
- Stitch-aligned UI design system (Tailwind CSS, Material Symbols, Space Grotesk + Plus Jakarta Sans)
- 12 new admin API endpoints: memory operations (4), session management (6), log viewer (3)
- Static asset serving with path traversal protection
- Session activity monitoring with Redis-based tracking
- Bulk session reflect for orphaned unreflected sessions
- Log file reverse-read for large file tail support
- Windowed pagination (10-page window centered on current)

### Changed
- Admin UI rewritten from 1928-line inline HTML to modular app shell (index.html + admin.css + admin.js)
- GET /stats expanded with searchMetrics, observability, queues, healthFlags
- Static assets served without auth (browser resource requests)

### Fixed
- URL ?key= parameter authentication for direct admin access
- Inline display:none preventing CSS class override
- Duplicate getSearchMetrics import from merge
- Memory fragments parsing (data.items vs data.fragments)
- Groups column rendering object instead of name
- Anomalies query using nonexistent updated_at column (-> accessed_at)
- Active sessions excluded from unreflected count
- Log file 50MB size limit replaced with reverse-read tail

## [1.6.1] - 2026-03-25

### Added
- Search observability infrastructure (searchPath persistence, tool_feedback FK)
- search_events table (migration-013) for query/result observability
- SearchEventRecorder for FragmentSearch.search() result logging
- SearchEventAnalyzer for search pattern analysis

### Fixed
- ESLint glob tests/*.test.js -> tests/**/*.test.js for nested test dirs

## [1.6.0] - 2026-03-19

### Added
- GC search_events older than 30 days in consolidation cycle
- Context seen-ids deduplication
- Quality improvements
