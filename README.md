# IndexSphere

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Docker](https://img.shields.io/badge/docker-ready-blue.svg)
![Next.js](https://img.shields.io/badge/Next.js-15.5-black.svg)
![Node](https://img.shields.io/badge/node-22%20LTS-green.svg)

**A self-hosted operations console for Elasticsearch, OpenSearch and ClickHouse.**
Manage the clusters, grade their design, audit their security and move data between them — from one place, with no telemetry leaving your network.

---

## Why IndexSphere

| | |
|---|---|
| **One console, three engines** | Elasticsearch, OpenSearch and ClickHouse side by side, with per-user sessions to each. |
| **Advisors that tell you the fix** | The **Index advisor** and the **ClickHouse table advisor** grade every index/table A–F. Each ClickHouse finding cites the [ClickHouse best-practice rule](https://github.com/ClickHouse/agent-skills/tree/main/skills/clickhouse-best-practices) it comes from; every finding includes the command or SQL that fixes it. |
| **Security posture audit** | Read-only hardening checks for both engines: anonymous access, **public demo TLS certificates**, demo users, open CORS, missing snapshots and backups, ClickHouse users without passwords or with `url()`/`file()` privileges, logging gaps. Combined with CVEs into a score and grade. |
| **Vulnerability intelligence** | Detects the exact versions you run (every node) and matches them against NVD and OSV, flags actively exploited CVEs (CISA KEV) and EPSS likelihood, and recommends the smallest safe upgrade. |
| **Configuration drift** | Nightly snapshots of templates, lifecycle policies, mappings, users and grants on every cluster, with an exact before/after diff of what changed. |
| **Elasticsearch → ClickHouse migration** | Plans the ClickHouse table from the live mapping (native types, LowCardinality from measured cardinality, ORDER BY, partitions). Copies the data in the background, verifies row parity and reports the storage saving. |
| **Secure by design** | Server-side sessions (cluster passwords never reach the browser), enforced roles on every API call, SSRF protection, ClickHouse `readonly` enforcement, audit trail, no outbound telemetry. |

## Features

**Elasticsearch / OpenSearch**
- **Inspect:** overview, cluster health, scored cluster analysis, live monitoring (SSE), nodes, indices, shards with allocation explanations.
- **Tune and query:** index advisor, query workbench (profile tree, score explain), AI query builder (PII redaction), search analytics, aliases/templates/ILM/ISM/snapshots.
- **Change data:** reindex wizard, bulk operations, delete-by-query with dry run, data migration, cluster compare.

**ClickHouse**
- **Inspect:** overview with live metrics, database/table explorer.
- **Query:** query activity (slow, failed, heaviest patterns, kill), SQL workbench with safety limits, EXPLAIN and server-side cancel.
- **Improve:** table advisor, migration from Elasticsearch.

**Security**
- Security posture, vulnerabilities, configuration drift, audit trail.

**Alerts & reports**
- Alert rules on search-cluster and ClickHouse metrics (email, Slack, webhook), scheduled CSV/JSON reports, on-demand PDF reports.

**Administration**
- Saved connections with role-based access, users and roles (`admin`, `user`, `readonly`), sign-in policy, SMTP.

## Quick start

```bash
git clone <your-repo-url> indexsphere && cd indexsphere
echo "JWT_SECRET=$(openssl rand -hex 32)" > .env
docker compose -f docker-compose.nginx.yml --env-file .env up -d
# open https://<host> — sign in as admin / admin, then set a new password
```

Then go to **Administration → Connections → Add connection** and add your Elasticsearch, OpenSearch or ClickHouse server.

## Documentation

| | |
|---|---|
| [Installation](docs/01-installation.md) | Docker (HTTPS / HTTP), single container, from source, upgrades |
| [Configuration](docs/02-configuration.md) | Every environment variable |
| [User guide](docs/03-user-guide.md) | Every page and common workflows |
| [ClickHouse](docs/04-clickhouse.md) | Setup, safety model, table advisor, migration |
| [Vulnerabilities](docs/05-vulnerabilities.md) | How CVE matching works, air-gapped mode |
| [Security](docs/06-security.md) | Security model, roles, posture audit, drift, hardening checklist |
| [Operations](docs/07-operations.md) | Backup/restore, retention, monitoring, performance tuning |
| [Troubleshooting](docs/08-troubleshooting.md) | Error messages and fixes |
| [Development](docs/09-development.md) | Architecture, conventions, tests |
| [API reference](docs/10-api-reference.md) | REST endpoints |

## Technology

Next.js 15 · React 19 · TypeScript · Tailwind CSS v4 · shadcn/ui · SQLite (better-sqlite3, WAL) · native bcrypt · node-cron · Nodemailer · Puppeteer · Docker (Node 22 LTS, non-root) · NGINX (TLS 1.2/1.3).

## Development

```bash
npm ci && npm run dev      # http://localhost:3000
npm test                   # unit tests
npm run build              # production build
```

See [Development](docs/09-development.md).

## License

MIT — see [LICENSE](LICENSE). Created by Yash Patel.
