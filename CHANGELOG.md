# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-03-17

### Added — New Pages

#### Index Intelligence Advisor (`/index-advisor`)
- Automated 0–100 scoring engine (A–F grade) for every index on the cluster
- 7 scoring rules: RED health (-40), YELLOW health (-8), zero replicas (-20), high deletion ratio (-10), over-sharding (-15), under-sharding (-15), system index bloat (-5)
- Copy-pasteable remediation API command for every failing rule
- On-demand mapping field-count analysis with mapping explosion risk detection (>500 fields)
- Summary cards with click-to-filter by health tier (healthy / needs work / critical)
- Expandable per-index drawer with Issues & Fixes + Metrics tabs

#### Query Workbench (`/query-workbench`)
- Full DSL editor with index selector (filterable dropdown of all cluster indices)
- **Execute**: paginated results with `_id`, `_index`, relevance score per hit
- **Profile** (`?profile=true`): visual query execution tree per shard, per node timing bars color-coded red/orange/yellow/green, breakdown details expanded per node
- **Doc Explain** (`/_explain/:id`): relevance score breakdown for a specific document
- **AI Analysis**: one-click LLM analysis of queries, profiles, and explain output via `/api/ai-explain`
- Query history (last 30 queries, auto-saved to localStorage with hit count + execution time)
- Named saved queries library (persisted to localStorage)
- Copy-to-clipboard on results, profiles, and AI explanations

#### AI Explain API (`/api/ai-explain`)
- New server-side endpoint that bridges raw ES data (profiles, mappings, explain output, slow queries) to any configured LLM
- Supports: OpenAI-compatible, Anthropic native, Ollama, Azure OpenAI, custom endpoint
- Uses expert system prompt optimized for ES/OS performance analysis
- Used by Query Workbench for all AI analysis features

### Added — Infrastructure & NGINX

#### NGINX configuration overhaul (`nginx.conf`)
- HTTP → HTTPS redirect (port 80 → 443, `301`)
- TLS 1.2/1.3 only with modern ECDHE cipher suite
- HSTS header: `max-age=15768000; includeSubDomains` (6 months)
- Security headers: `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`
- Dedicated SSE location block (`/api/monitoring/stream`): `proxy_buffering off`, `proxy_cache off`, chunked transfer — SSE events reach the browser in real-time through nginx
- WebSocket upgrade headers on main `location /`
- Extended proxy timeouts (3600s) to support long-lived SSE connections
- Response compression (gzip) for text/CSS/JSON/JS

#### docker-compose.nginx.yml
- Added `healthcheck` on `indexsphere` service; nginx `depends_on: condition: service_healthy`
- nginx now binds both port 80 (redirect) and 443
- `JWT_SECRET` uses `${JWT_SECRET:?...}` — fails fast if secret not set
- certgen: cert valid for 3650 days (10 years), adds `subjectAltName=DNS:localhost,IP:127.0.0.1`
- Removed stale `certs:` named volume (certs are host-mounted from `./certs`)
- nginx `restart: unless-stopped` (was `on-failure`)

### Added — Saved Connection Persistence

#### Auto-reconnect after container restart
- New `POST /api/saved-connections/[id]/connect` endpoint: decrypts stored AES-256-GCM password from SQLite, instantiates ES client, updates `last_connected` timestamp
- `ConnectionContext` additions: `currentSavedConnectionId` state (persisted to `localStorage`), `activateSavedConnection(id, url)` method
- `/connections` page: new **Connect** button (with `PlugZap` icon) per saved connection — shows "Active" badge when that connection is current
- `/monitoring` page: `reconnectServer()` checks `currentSavedConnectionId` first → calls saved-connection connect API (no credentials needed browser-side); falls back to `connectionConfig.auth` for manual connections; shows amber "Go to Connect" banner if neither is available

### Added — Navigation

- `secondary` nav section: **Index Advisor** (`/index-advisor`, Lightbulb icon) and **Query Workbench** (`/query-workbench`, PanelLeftOpen icon)

---

## [1.1.0] - 2026-03-16

### Added

#### Single Config & Policies page (`/cluster-config`)
- Replaces 11 separate write-CRUD pages with a single read-only 7-tab viewer
- Tabs: Aliases, Index Templates, Component Templates, ILM/Policies, Repositories, Snapshots, Cluster Settings
- Global search filter, count badges per tab, `Promise.allSettled` — one failing API does not break the rest
- "Refresh All" button

#### NGINX HTTPS deployment
- `docker-compose.nginx.yml` with certgen sidecar (self-signed, auto-generated on first run)
- `nginx.conf` reverse proxy with SSL termination

### Removed

Pages removed that duplicate OpenSearch Dashboard CRUD functionality (IndexSphere retains read-only cluster visibility):
- `/aliases` — CRUD now via Config & Policies read-only tab
- `/templates` — same
- `/component-templates` — same
- `/ilm` and `/ilm-wizard` — same
- `/repositories` and `/snapshots` — same
- `/rest` — raw REST console
- `/query` — basic query editor (replaced by Query Workbench)
- `/cat` — raw CAT API
- `/cluster-settings` — CRUD settings (read-only view now in Config & Policies)

### Changed

- **Indices page**: removed write actions (Create Index button, Delete button, action buttons on rows) — page is now read-only visibility only
- **Navigation**: "Administration" section renamed to "Operations"; 11 removed items cleaned from nav

---

## [1.0.0] - 2025-01-25

### Added
- Complete self-contained production setup
- Docker-based deployment with multi-stage builds
- JWT-based authentication system with role-based access (Admin, User, Readonly)
- **Real-time monitoring** via Server-Sent Events (SSE) — 5-second tick, CPU/heap/GC/shards/indexing metrics
- **Alert engine** — configurable rules (cpu, heap, gc, unassigned_shards, indexing_rate, node_count), per-rule cooldown, email/Slack/webhook notifications
- **Scheduled reports** — cron-based cluster health / index stats emails via Nodemailer, CSV or JSON
- **AI Query Builder** — NL→DSL via OpenAI, Anthropic, Ollama, Azure OpenAI, custom endpoints; PII sanitizer (16 patterns)
- **Cluster Comparator** — cross-cluster index/template/settings diff
- **Cluster Analysis** — automated health scoring with performance metrics, configuration checks, system insights
- Reindex Wizard with live task progress and cancel
- Bulk Operations (delete/close/open/forcemerge/refresh/flush on multiple indices)
- Data Migration with pre-built templates
- Delete by Query with dry-run preview
- PDF report generation via Puppeteer
- Audit trail with CSV export and role-scoped visibility
- Traffic Security Lock (DevTools/F12 block, HMAC tamper-detection, debug mode with time-limited JWT)
- AES-256-GCM encrypted credential storage in SQLite
- Scoped SSL bypass for self-signed certificates (per-request agent, not global)
- Search Analytics aggregation page
- User Management (admin CRUD)
- Auth Config (session settings, security lock, debug password)
- Application Settings (cluster display, SMTP config)

### Technical
- Next.js 15.4.3 with standalone output
- TypeScript throughout
- SQLite (better-sqlite3): bcrypt password hashing with legacy SHA-256 fallback + auto-upgrade
- Dual ES/OpenSearch compatibility (template paths, ILM vs ISM, server-type detection)
- Non-root Docker container (`nextjs` user)
- Health checks and monitoring

---

## [0.9.0] - Previous Version

### Changed
- Migrated from original uitest structure
- Removed unnecessary Kubernetes configurations
- Eliminated packaging dependencies
- Streamlined for Docker-only deployment


### Added
- Complete self-contained production setup
- Docker-based deployment with multi-stage builds
- JWT-based authentication system
- Role-based access control (Admin, User, Read-only)
- Production-ready configuration
- Automated build and deployment scripts
- Comprehensive documentation
- Security hardening and best practices

### Fixed
- Authentication token handling issues
- Development server in production containers
- External directory dependencies
- Build context optimization

### Security
- Non-root container execution
- Secure password hashing
- JWT secret management
- CORS protection
- Rate limiting

### Technical
- Next.js 15.4.3 with standalone output
- TypeScript support
- Modern UI components
- Responsive design
- Health checks and monitoring

## [0.9.0] - Previous Version

### Changed
- Migrated from original uitest structure
- Removed unnecessary Kubernetes configurations
- Eliminated packaging dependencies
- Streamlined for Docker-only deployment
