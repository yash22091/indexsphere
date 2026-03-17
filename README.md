# IndexSphere

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-15.4.3-black.svg)
![TypeScript](https://img.shields.io/badge/TypeScript-ready-blue.svg)

A modern, production-ready Elasticsearch/OpenSearch management interface built with Next.js 15. Includes real-time monitoring, an AI-powered query builder, automated index intelligence scoring, a query profiler workbench, alerting, scheduled reports, multi-cluster comparison, audit trail, and an HTTPS-first Docker deployment with NGINX.

---

## ✨ Feature Overview

### Core Cluster Management
| Page | Description |
|------|-------------|
| **Overview** | Cluster health at a glance — status, node count, shard counts, doc count, store size, auto-refresh |
| **Cluster Health** | Per-node JVM heap, CPU, disk, OS memory, indexing/search totals with tabs |
| **Nodes** | Node explorer — roles, version, CPU/heap/GC/FS stats, click for detailed drawer |
| **Indices** | Index list with health badges, shard info, doc/delete counts, store size — read-only view |
| **Shards** | Shard allocation table — state, doc count, node. Allocation explanation (why shards are unassigned) |
| **Config & Policies** | Tabbed read-only viewer: Aliases, Index Templates, Component Templates, ILM/ISM Policies, Repositories, Snapshots, Cluster Settings |

### Intelligence & Analysis
| Page | Description |
|------|-------------|
| **Index Intelligence Advisor** | Scores every index 0–100 (A–F grade). Checks: health, zero replicas, shard sizing (10–50 GB target), deletion ratio, mapping field explosion. Each issue includes a copy-pasteable remediation command. On-demand mapping field-count analysis. |
| **Cluster Analysis** | Multi-dimensional health score (0–100). Performance metrics vs thresholds. Configuration pass/warn/fail checks. Tabs: health, performance, configuration, system insights (plugins, repositories, pending tasks, thread pools, segment info). |
| **Cluster Compare** | Side-by-side diff of two live clusters — indices only in A/B, shared indices with field-level diffs, template diffs, settings diffs. Supports saved connections or manual credentials. |
| **Search Analytics** | Aggregated query stats: total queries, avg latency, slow queries, failed queries, indexing/search rates. Per-index breakdown. Auto-refresh + time range. |

### Query & Data Operations
| Page | Description |
|------|-------------|
| **Query Workbench** | Full-featured DSL editor with: Execute (paginated results), Profile (visual query execution tree with per-node timing bars), Doc Explain (relevance score breakdown), AI Analysis (one-click LLM analysis of queries and profiles), Query History (last 30), Saved Queries library |
| **AI Query Builder** | Natural-language → Elasticsearch DSL. Providers: OpenAI, Anthropic Claude, Ollama (local), Azure OpenAI, custom. PII sanitizer strips emails/IPs/tokens/keys before sending. Mapping context injected for field-aware queries. |
| **Reindex Wizard** | 5-step guided reindex with live task progress polling, cancel support, conflict strategy selection |
| **Bulk Operations** | Multi-select indices, apply: delete / close / open / forcemerge / refresh / flush |
| **Data Migration** | Reindex between indices with pre-built templates (date range, field transform, data cleanup) |
| **Delete by Query** | Dry-run preview (hit count + sample docs) before destructive execution. DSL query with conflict strategy, slices, scroll size. |

### Monitoring & Alerting
| Page | Description |
|------|-------------|
| **Live Monitoring** | SSE-driven real-time dashboard (5-second ticks). CPU%, heap%, GC pressure, unassigned shards, doc count, indexing rate. Sparkline charts, configurable warn/crit threshold lines, 60-point rolling history. Auto-reconnects on container restart via saved connections. |
| **Alerts** | Rule-based alerting engine. Metrics: cpu, heap, gc, unassigned_shards, indexing_rate, node_count. Operators: >, <, >=, <=. Severity: info/warning/critical. Channels: email, Slack webhook, generic webhook. Per-rule cooldown window. Trigger history. |
| **Scheduled Reports** | Email delivery of cluster health or index stats on cron schedules. CSV or JSON format. Nodemailer attachment. Run Now button. |
| **Reports** | On-demand cluster health + node list + index list report as JSON or PDF (Puppeteer server-side). |

### Security & Administration
| Page | Description |
|------|-------------|
| **Audit Trail** | Paginated log of all API actions. Filters: user, action type, date range. CSV export. Admins see all; users see own. |
| **User Management** | CRUD for application users. Roles: admin / user / readonly. |
| **Auth Config** | Session timeout, max login attempts. Traffic Security Lock (DevTools/F12 blocking + HMAC tamper-detection). Debug Mode with time-limited bypass JWT. |
| **Settings** | Cluster settings display, index template defaults, SMTP email config with test button. |
| **Connections** | Saved connections with AES-256-GCM encrypted passwords in SQLite. Test + Connect buttons. Color tags, role-based access. |

---

## 🚀 Quick Start

### Prerequisites
- Docker ≥ 20.x and Docker Compose ≥ 2.x
- 512 MB RAM minimum (1 GB+ recommended)
- Ports 80 and 443 available (HTTPS mode) **or** port 3000 (plain mode)

### Option A — HTTPS with NGINX (recommended for production)

```bash
# 1. Set a strong JWT secret (required)
export JWT_SECRET=$(openssl rand -hex 32)

# 2. Start — generates self-signed certs automatically on first run
docker compose -f docker-compose.nginx.yml up -d

# 3. Open https://localhost
#    Accept the self-signed certificate warning the first time.
#    Default credentials: admin / admin
#    You will be forced to change the password before accessing any page.
```

> **Bring your own cert**: Place `fullchain.pem` and `privkey.pem` in the `certs/` directory before starting — the certgen service skips generation if they already exist.

### Option B — Plain HTTP (development / internal)

```bash
export JWT_SECRET=$(openssl rand -hex 32)
docker compose -f docker-compose.production.yml up -d
# Open http://localhost:3000
# Default credentials: admin / admin  (forced password change on first login)
```

### Option C — Single Docker container

```bash
docker build -f Dockerfile.production -t indexsphere:latest .
docker run -d --name indexsphere \
  -p 3000:3000 \
  -e JWT_SECRET=$(openssl rand -hex 32) \
  -e NODE_ENV=production \
  -v indexsphere-data:/app/data \
  indexsphere:latest
# Default credentials: admin / admin  (forced password change on first login)
```

---

## 🔐 First-Run Authentication

On first boot, if no admin user exists in the SQLite database, the application:

1. Creates an `admin` user with the default password **`admin`**
2. Sets a `must_change_password` flag on the account
3. Middleware intercepts **every** request and redirects to `/auth/change-password` until the password has been changed — no page is accessible until this step is complete
4. After the password is changed you are issued a fresh JWT and redirected to the dashboard

> The default password `admin/admin` applies only when the data volume is empty. Once the password has been changed it is never reset unless the volume is deleted.

---

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Browser                                                        │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Next.js 15 App (React 19, TypeScript, Tailwind/shadcn)   │  │
│  │  ConnectionContext ↔ AuthContext ↔ ThemeContext            │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────│────────────────────────────────────┘
                             │ HTTPS (via nginx) / HTTP
┌────────────────────────────▼────────────────────────────────────┐
│  Next.js Server (Node.js)                                       │
│  ┌──────────────┐  ┌───────────────┐  ┌──────────────────────┐ │
│  │ API Routes   │  │ ES Proxy      │  │ SSE /monitoring/stream│ │
│  │ /api/auth    │  │ /api/es-proxy │  │ (5-sec tick, alerts)  │ │
│  │ /api/users   │  │ /api/secure-  │  └──────────────────────┘ │
│  │ /api/alerts  │  │ proxy         │  ┌──────────────────────┐ │
│  │ /api/reports │  └───────────────┘  │ Scheduler (node-cron)│ │
│  └──────────────┘                     │ Scheduled reports     │ │
│  ┌──────────────────────────────────┐ └──────────────────────┘ │
│  │ SQLite (better-sqlite3)          │                           │
│  │ users, saved_connections,        │                           │
│  │ audit_log, alert_rules,          │                           │
│  │ scheduled_reports, app_settings  │                           │
│  └──────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────┘
                             │
┌────────────────────────────▼────────────────────────────────────┐
│  Elasticsearch / OpenSearch cluster                             │
│  (on-prem, Docker, Elastic Cloud, AWS OpenSearch)              │
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack
| Layer | Technology |
|-------|-----------|
| Framework | Next.js 15.4.3, React 19, TypeScript |
| UI | Tailwind CSS, shadcn/ui, Lucide icons |
| Database | SQLite via better-sqlite3 (passwords: AES-256-GCM; user passwords: bcrypt) |
| Auth | JWT (HttpOnly cookie), role-based (admin / user / readonly) |
| Scheduling | node-cron |
| Email | Nodemailer |
| PDF | Puppeteer (server-side) |
| Proxy | NGINX 1.25 (TLS 1.2/1.3, HTTP→HTTPS redirect, SSE buffering disabled) |
| Container | Docker multi-stage build, non-root `nextjs` user |

---

## 🔧 Configuration

### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `JWT_SECRET` | **Yes** | — | 32+ char secret for JWT signing and AES key derivation. Generate: `openssl rand -hex 32` |
| `NODE_ENV` | No | `production` | `production` or `development` |
| `PORT` | No | `3000` | Internal app port (do not change when using the compose files) |
| `HOSTNAME` | No | `0.0.0.0` | Bind address |
| `ADMIN_DEFAULT_PASSWORD` | No | `admin` | Override the default admin password on first boot. Mandatory change is still enforced. |
| `SMTP_HOST` | No | — | SMTP server hostname (for email alerts and scheduled reports) |
| `SMTP_PORT` | No | `587` | SMTP port |
| `SMTP_SECURE` | No | `false` | `true` for SSL/TLS |
| `SMTP_USER` | No | — | SMTP username |
| `SMTP_PASS` | No | — | SMTP password |
| `SMTP_FROM` | No | — | From address for outbound emails |

### Persistent Data Volume

All application data (SQLite DB, saved connections, user accounts, alert rules, scheduled reports, settings) is stored in `/app/data` inside the container. Mount a named volume or host path to persist it across container restarts:

```yaml
volumes:
  - indexsphere-data:/app/data   # named volume (recommended)
  # or:
  - ./data:/app/data              # host path
```

### Bring Your Own TLS Certificate

Replace the auto-generated self-signed cert with a real one (Let's Encrypt, etc.):

```bash
# Place your cert files in the certs/ directory before starting
cp /etc/letsencrypt/live/yourdomain/fullchain.pem certs/fullchain.pem
cp /etc/letsencrypt/live/yourdomain/privkey.pem   certs/privkey.pem

export JWT_SECRET=your-32-char-secret
docker compose -f docker-compose.nginx.yml up -d
```

---

## 📂 Project Structure

```
indexsphere/
├── src/
│   ├── app/
│   │   ├── (pages)/                   # All Next.js app-router pages
│   │   │   ├── overview/              # Cluster overview dashboard
│   │   │   ├── cluster-health/        # Per-node health details
│   │   │   ├── cluster-analysis/      # Automated health scoring
│   │   │   ├── cluster-compare/       # Cross-cluster diff
│   │   │   ├── cluster-config/        # Aliases / templates / ILM / snapshots
│   │   │   ├── index-advisor/         # ★ Index Intelligence Advisor (graded scoring)
│   │   │   ├── query-workbench/       # ★ Query editor + profiler + AI analysis
│   │   │   ├── indices/               # Index list (read-only)
│   │   │   ├── nodes/                 # Node explorer
│   │   │   ├── shards/                # Shard allocation view
│   │   │   ├── monitoring/            # Live SSE metrics dashboard
│   │   │   ├── search-analytics/      # Query stats aggregation
│   │   │   ├── ai-query/              # NL→DSL AI query builder
│   │   │   ├── reindex-wizard/        # Guided reindex
│   │   │   ├── bulk-operations/       # Multi-index bulk actions
│   │   │   ├── data-migration/        # Index-to-index migration
│   │   │   ├── delete-by-query/       # Dry-run + execute delete by query
│   │   │   ├── alerts/                # Alert rule CRUD + trigger log
│   │   │   ├── scheduled-reports/     # Cron-scheduled email reports
│   │   │   ├── reports/               # On-demand JSON/PDF reports
│   │   │   ├── audit-trail/           # API action audit log
│   │   │   ├── connections/           # Saved connection management
│   │   │   ├── user-management/       # User CRUD (admin only)
│   │   │   ├── auth-config/           # Security lock + debug mode
│   │   │   └── settings/              # App & SMTP settings
│   │   └── api/                       # API route handlers
│   │       ├── auth/                  # Login / logout / verify
│   │       ├── connect/               # Register ES client singleton
│   │       ├── es-proxy/              # Authenticated ES proxy
│   │       ├── secure-proxy/          # API-key-gated proxy
│   │       ├── monitoring/            # SSE stream + thresholds
│   │       ├── alerts/                # Alert CRUD + evaluator
│   │       ├── saved-connections/     # Saved connection CRUD + connect
│   │       ├── ai-query/              # NL→DSL LLM bridge
│   │       ├── ai-explain/            # ★ Profile/mapping/explain LLM analysis
│   │       ├── reports/               # JSON + PDF generation
│   │       ├── scheduled-reports/     # Cron report management
│   │       ├── audit/                 # Audit log query
│   │       └── users/                 # User management
│   ├── components/                    # Reusable UI components (shadcn/ui)
│   ├── contexts/                      # React contexts (auth, connection, theme)
│   ├── lib/
│   │   ├── elasticsearch.ts           # ES client with 40+ methods, ES/OS dual support
│   │   ├── database-sqlite.ts         # SQLite ORM (bcrypt + AES-256-GCM)
│   │   ├── auth.ts                    # JWT verify, HMAC tamper-detection   │   ├── boot-session.ts            # Per-boot nonce — invalidates old sessions on container restart│   │   ├── alert-engine.ts            # Real-time alert evaluation + notifications
│   │   ├── scheduler.ts               # node-cron scheduled report runner
│   │   ├── mailer.ts                  # Nodemailer wrapper
│   │   ├── pii-sanitizer.ts           # 16-pattern PII redactor (client-side)
│   │   ├── security-guardian.ts       # DevTools lock + HMAC fetch wrapper
│   │   └── ssl-bypass.ts              # Scoped SSL bypass for self-signed certs
│   └── types/index.ts                 # Shared TypeScript types
├── certs/                             # TLS certs (auto-generated or BYOC)
├── data/                              # SQLite DB (mounted as volume in production)
├── nginx.conf                         # NGINX: HTTP→HTTPS redirect, SSE, HSTS, TLS 1.2/1.3
├── docker-compose.nginx.yml           # ★ Production: NGINX + HTTPS + healthcheck
├── docker-compose.production.yml      # Plain HTTP deployment
├── Dockerfile.production              # Multi-stage build, non-root user
├── build.sh / start.sh / stop.sh      # Helper scripts
└── test-system.sh / verify.sh         # Integration test scripts
```

---

## 🔍 All API Endpoints

### Authentication
| Method | Endpoint | Description |
|--------|----------|--------------|
| POST | `/api/auth/login` | Login (brute-force protected) |
| POST | `/api/auth/logout` | Clear auth cookie |
| GET | `/api/auth/verify` | Validate current JWT (rejects tokens issued before last container start) |
| POST | `/api/auth/change-password` | Change password + clear forced-change flag, issues fresh JWT |

### Cluster
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/connect` | Register ES client singleton |
| GET | `/api/health` | App health check (always 200 — reflects ES connectivity in response body) |
| GET | `/api/cluster/health` | Cluster health via official ES client |
| GET | `/api/nodes` | Node list |
| GET | `/api/indices` | Cat indices |

### ES Proxy
| Method | Endpoint | Description |
|--------|----------|-------------|
| * | `/api/es-proxy/[...path]` | Authenticated proxy to ES — all client-side ES calls route here, writes audit log |
| POST | `/api/secure-proxy` | API-key-gated proxy, rate-limited (10 req/min/IP), endpoint whitelist |

### Monitoring
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/monitoring/stream` | SSE stream — one metric event per 5s, evaluates alert rules on each tick |
| GET/PUT | `/api/monitoring/thresholds` | Read/write warn/crit threshold config |

### Saved Connections
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/saved-connections` | List (passwords stripped) / create (AES-encrypted) |
| GET/PUT/DELETE | `/api/saved-connections/[id]` | Get / update / delete |
| POST | `/api/saved-connections/[id]/test` | Test connectivity |
| POST | `/api/saved-connections/[id]/connect` | Activate as current cluster |

### Alerts & Reports
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/alerts` | List rules / create rule |
| GET/PUT/DELETE | `/api/alerts/[id]` | Get / update (including enable toggle) / delete |
| GET/POST | `/api/scheduled-reports` | List / create scheduled reports |
| GET/PUT/DELETE/POST | `/api/scheduled-reports/[id]` | Get / update / delete / run now |
| POST | `/api/reports/cluster-report` | Generate cluster health JSON |
| POST | `/api/reports/generate-pdf` | Generate PDF (Puppeteer) — admin only |
| GET | `/api/audit` | Paginated audit log, CSV export |

### AI
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/ai-query` | NL→DSL conversion using LLM |
| POST | `/api/ai-explain` | Explain profiles / mappings / allocation in plain English |

### Users & Settings
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET/POST | `/api/users` | List / create users |
| GET/PUT/DELETE | `/api/users/[id]` | Get / update / delete user |
| GET/PUT/POST | `/api/settings/email` | Read / save / test SMTP config |
| GET/POST | `/api/settings/security` | Security lock state / actions |
| GET/POST | `/api/auth-config` | Read / update security config |

### Reindex & Bulk
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST/GET/DELETE | `/api/reindex` | Start reindex / poll task / cancel task |
| GET/POST/DELETE | `/api/indices/[name]` | CRUD for individual indices |
| GET/POST/DELETE | `/api/templates/[name]` | CRUD for index templates |

---

## 🛡️ Security Architecture

| Feature | Detail |
|---------|--------|
| **Authentication** | JWT in HttpOnly cookie, 1-hour expiry, per-session HMAC signing key embedded in token |
| **Boot-nonce invalidation** | Random nonce generated at startup stored on `globalThis`; embedded as `bid` claim in every JWT; requests with a stale `bid` (from before a container restart) are rejected with 401 |
| **Forced first-login password change** | New admin account starts with `must_change_password=true`; middleware redirects every request to `/auth/change-password` until flag is cleared |
| **Brute-force protection** | Configurable max attempts + lockout duration, tracked in SQLite |
| **Credential storage** | Saved connection passwords: AES-256-GCM, key derived from `JWT_SECRET` |
| **Transport security** | NGINX TLS 1.2/1.3, HSTS 6 months, HTTP→HTTPS redirect |
| **Audit logging** | Every API call logged: user, IP, method, endpoint, status code, duration, cluster URL |
| **PII redaction** | 16 regex patterns strip secrets before AI API calls (client-side, never reaches server) |
| **HMAC tamper-detection** | Optional: all browser fetch calls signed with `X-Req-Sig` + 60-second replay window |
| **Traffic Security Lock** | Optional DevTools/F12 blocking + context-menu disable |
| **SSL bypass** | Per-request `https.Agent` (not global) for on-prem self-signed certs |
| **Role-based access** | Routes filtered: admin-only pages hidden from non-admins at nav + API level |

---

## 🤖 AI Features

IndexSphere integrates with LLM providers for two features. **API keys are never stored server-side** — they live in browser `localStorage` only.

### Supported Providers
| Provider | Notes |
|----------|-------|
| OpenAI | GPT-4o, GPT-4o-mini, etc. |
| Anthropic Claude | claude-3-5-sonnet, haiku, opus |
| Ollama (local) | llama3.2, mistral, codellama, deepseek-r1, phi3 — fully air-gapped |
| Azure OpenAI | Custom endpoint + API key |
| Custom | Any OpenAI-compatible endpoint |

### AI Query Builder (`/ai-query`)
- Describe what you want in natural language
- Index mapping (up to 30 fields) sent as context for accurate field references
- **PII sanitizer** runs client-side before sending — strips emails, IPs, API keys, JWT tokens, credit card numbers, SSH keys, and more

### Query Workbench AI Analysis (`/query-workbench`)
- **AI Analyze Query**: sends your DSL to the LLM, returns performance assessment and optimization suggestions
- **AI Explain Profile**: sends the raw `?profile=true` output, returns plain-English bottleneck identification
- **AI Explain Score**: sends `/_explain` output, explains relevance ranking factors

---

## 📊 Index Intelligence Advisor (`/index-advisor`)

No other open-source ES management tool provides automated index scoring.

### Scoring Rules (100-point scale)
| Rule | Deduction | Condition |
|------|-----------|-----------|
| RED health | -40 | Index has unassigned primary shards |
| YELLOW health | -8 | Index has unassigned replica shards |
| Zero replicas | -20 | Non-system index with `rep=0` |
| High deletion ratio | -10 | >25% of segment space is tombstoned docs |
| Over-sharded | -15 | Avg shard < 500 MB with >1 primary |
| Under-sharded | -15 | Avg shard > 50 GB |
| System index bloat | -5 | System index (`.`) > 5 GB |

Every failing rule includes a **copy-pasteable API call** to fix the issue. On-demand mapping field-count analysis detects mapping explosion risk (>500 fields).

---

## 🔄 Saved Connection Persistence

Connections saved via `/connections` survive container restarts:
1. Credentials stored AES-256-GCM encrypted in SQLite
2. Click **Connect** on a saved connection → activates server-side ES client, stores connection ID in `localStorage`
3. On container restart, the `/monitoring` page detects `no_client` SSE error and calls `POST /api/saved-connections/:id/connect` automatically (no credentials needed client-side — they're decrypted from SQLite server-side)

---

## 🚀 Deployment

### Production HTTPS Checklist
- [ ] Set `JWT_SECRET` to 32+ random characters
- [ ] Use a named Docker volume for `/app/data` persistence
- [ ] Place real TLS certs in `certs/` (or let certgen create self-signed)
- [ ] Set SMTP environment variables for email alerts/reports
- [ ] Change the admin password on first login (enforced automatically)

### Helper Scripts
| Script | Description |
|--------|-------------|
| `./build.sh` | Build the Docker image |
| `./start.sh` | Start with docker-compose.production.yml |
| `./stop.sh` | Stop all containers |
| `./verify.sh` | Verify deployment health |
| `./test-system.sh` | Full integration test suite |

### Using a `.env` file
```bash
# .env (never commit this file)
JWT_SECRET=your-64-char-hex-secret-here
ADMIN_DEFAULT_PASSWORD=MySecurePass!2024   # optional: overrides the default 'admin' password
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=alerts@example.com
SMTP_PASS=smtp-password
SMTP_FROM=alerts@example.com
```

```bash
docker compose -f docker-compose.nginx.yml --env-file .env up -d
```

---

## 🐛 Troubleshooting

### Forgot the admin password / fresh start
```bash
# Remove the data volume so that the admin account is re-created on next boot:
docker compose -f docker-compose.nginx.yml down -v
docker compose -f docker-compose.nginx.yml up -d
# Log in with admin / admin  (you will be forced to set a new password)
```

### Monitoring shows "no client" after restart
The server-side ES client is in-memory and lost on restart. Two ways to reconnect:
1. **Automatic**: if you previously used a saved connection (clicked Connect in `/connections`), the monitoring page reconnects automatically
2. **Manual**: go to `/connect` and connect again; or go to `/connections` and click Connect on a saved connection

### HTTPS certificate not trusted
For self-signed certs, browsers will warn. Click "Advanced → Proceed". For production, replace with a trusted cert (Let's Encrypt, etc.).

### Nginx not starting
```bash
docker logs nginx-https
# Usually: indexsphere-prod is not yet healthy — wait and try again
docker compose -f docker-compose.nginx.yml restart nginx
```

### Build failures / clean rebuild
```bash
docker compose -f docker-compose.nginx.yml down -v
docker system prune -f
docker compose -f docker-compose.nginx.yml up --build -d
```

### Port conflicts
```bash
# Check what's using ports 80/443
ss -tlnp | grep -E ':80|:443'
```

---

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/my-feature`
3. Run type checks: `npx tsc --noEmit`
4. Test with Docker: `docker build -f Dockerfile.production -t indexsphere:dev .`
5. Submit a pull request

---

## 📝 License

MIT License — see [LICENSE](LICENSE) for full text.

---

## 🙏 Acknowledgments

- [Next.js](https://nextjs.org/) — React framework
- [shadcn/ui](https://ui.shadcn.com/) — UI component library
- [Lucide](https://lucide.dev/) — Icons
- [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) — SQLite driver
- [Puppeteer](https://pptr.dev/) — PDF generation
- [node-cron](https://github.com/node-cron/node-cron) — Scheduled reports

---

**IndexSphere** — Modern Elasticsearch/OpenSearch Management, beyond what any dashboard provides out of the box.
