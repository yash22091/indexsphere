# Configuration

IndexSphere is configured with environment variables. In-app settings (SMTP, sign-in policy, AI defaults) are stored in the database and edited from the UI.

- [Required](#required)
- [Server and sessions](#server-and-sessions)
- [Network access and outbound safety](#network-access-and-outbound-safety)
- [Cluster traffic limits](#cluster-traffic-limits)
- [ClickHouse](#clickhouse)
- [Vulnerability intelligence](#vulnerability-intelligence)
- [Background jobs and retention](#background-jobs-and-retention)
- [Email (SMTP)](#email-smtp)
- [AI query builder](#ai-query-builder)
- [Example `.env`](#example-env)

---

## Required

| Variable | Description |
|---|---|
| `JWT_SECRET` | 32+ characters. Signs session tokens and derives the key that encrypts saved connection passwords (AES-256-GCM). Generate with `openssl rand -hex 32`. **Changing it logs everyone out and makes saved connection passwords unreadable** — they must be re-entered. |

## Server and sessions

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `production` (Docker) | Use `production` for real deployments. |
| `PORT` / `HOSTNAME` | `3000` / `0.0.0.0` | Listen address inside the container. |
| `NODE_OPTIONS` | `--max-old-space-size=384` (Docker) | V8 heap cap. Keeps memory predictable; raise to `768`–`1024` for very large clusters or many concurrent users. The container needs roughly heap + 150 MB + 200 MB per concurrent PDF. |
| `ADMIN_DEFAULT_PASSWORD` | `admin` | Initial password of the `admin` account, used only when the database is empty. A change is forced at first sign-in either way. |
| `COOKIE_SECURE` | `true` in production | Marks the session cookie `Secure`. Browsers drop secure cookies on plain-HTTP origins (except `localhost`), so set `false` **only** for internal deployments served over HTTP. Prefer HTTPS. |
| `INDEXSPHERE_DB_PATH` | `./data/indexsphere.db` | SQLite database location. In Docker keep it under the `/app/data` volume. |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info` or `debug`. |

Session length, failed-login lockout and password rules are set in **Administration → Authentication**.

## Network access and outbound safety

Every server-side request to a user-supplied address (cluster URLs, ClickHouse, AI providers, webhooks) passes an SSRF guard. Cloud metadata endpoints (`169.254.169.254`, `fd00:ec2::254`, `100.100.100.200`), link-local, multicast and unspecified addresses are always refused. Private networks (10/8, 172.16/12, 192.168/16) are allowed because on-prem clusters live there.

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_HOST_ALLOWLIST` | — | Comma-separated hosts that cluster and ClickHouse connections may target, e.g. `es1.corp,10.0.0.5,*.search.internal`. Unset = any host that passes the guard. Recommended for multi-tenant installs. |
| `ALLOW_LOOPBACK_TARGETS` | `false` in production | Allow `localhost` / `127.0.0.1` targets, e.g. a local Ollama or a cluster on the same host (outside Docker). |

## Cluster traffic limits

| Variable | Default | Description |
|---|---|---|
| `CLUSTER_REQUEST_TIMEOUT_MS` | `60000` | Timeout for one request to a cluster or ClickHouse server. |
| `CLUSTER_MAX_RESPONSE_BYTES` | `52428800` (50 MB) | Larger responses are aborted (protects memory). Ask for less: `size`, `_source` filters, `LIMIT`. |
| `PROXY_MAX_BODY_BYTES` | `20971520` (20 MB) | Maximum request body accepted by the Elasticsearch proxy. Split larger `_bulk` requests. |
| `PDF_MAX_CONCURRENCY` | `2` | Concurrent PDF reports (each runs headless Chromium, ~200 MB). Extra requests queue for up to 30 s, then get HTTP 429. |
| `PUPPETEER_EXECUTABLE_PATH` | `/usr/bin/chromium-browser` (Docker) | Chromium used for PDF reports. |

## ClickHouse

| Variable | Default | Description |
|---|---|---|
| `CLICKHOUSE_MAX_EXECUTION_TIME` | `60` | Seconds before a SQL-workbench query is stopped. |
| `CLICKHOUSE_MAX_BYTES_TO_READ` | `21474836480` (20 GiB) | Scan cap per SQL-workbench query (`read_overflow_mode=throw`). |
| `MIGRATION_MAX_CONCURRENCY` | `2` | Elasticsearch → ClickHouse copy jobs that run at the same time; others wait. |

## Vulnerability intelligence

| Variable | Default | Description |
|---|---|---|
| `NVD_API_KEY` | — | Optional [NVD API key](https://nvd.nist.gov/developers/request-an-api-key). Without it, lookups still work but NVD allows 5 requests / 30 s. |
| `VULN_INTEL_DISABLED` | `false` | `true` disables all online lookups (air-gapped installs). Cached results are still shown. |

## Background jobs and retention

| Variable | Default | Description |
|---|---|---|
| `AUDIT_RETENTION_DAYS` | `90` | Audit-log rows older than this are deleted nightly (03:41). |
| `ALERT_TRIGGER_RETENTION_DAYS` | `90` | Alert-trigger history retention. |
| `DRIFT_SNAPSHOT_CRON` | `30 2 * * *` | When saved connections are snapshotted for configuration drift. |
| `DRIFT_SNAPSHOTS_DISABLED` | `false` | `true` turns off the nightly drift snapshots (manual snapshots still work). |

Fixed schedules: scheduled reports are checked every minute; vulnerability feeds refresh at 03:17.

## Email (SMTP)

Configure in **Administration → Settings → Email**, or with environment variables (used as defaults):

| Variable | Description |
|---|---|
| `SMTP_HOST`, `SMTP_PORT` (587), `SMTP_SECURE` (`true` for port 465) | Server |
| `SMTP_USER`, `SMTP_PASS` | Credentials |
| `SMTP_FROM` | Sender address |

Email is used by alert rules and scheduled reports. A report whose email cannot be delivered is recorded as failed with the SMTP error.

## AI query builder

API keys for AI providers stay in the user's browser and are sent per request; they are never stored on the server. Admins can set non-secret defaults in the AI query page, or with:

| Variable | Description |
|---|---|
| `AI_BASE_URL` | Default OpenAI-compatible base URL (e.g. `https://api.openai.com/v1`, `http://ollama:11434/v1`) |
| `AI_MODEL` | Default model name |

## Example `.env`

```ini
JWT_SECRET=4f1c...64 hex characters...
NODE_OPTIONS=--max-old-space-size=512
CLUSTER_HOST_ALLOWLIST=*.search.corp.example,clickhouse.corp.example
SMTP_HOST=smtp.corp.example
SMTP_PORT=587
SMTP_USER=indexsphere
SMTP_PASS=change-me
SMTP_FROM=indexsphere@corp.example
NVD_API_KEY=
AUDIT_RETENTION_DAYS=180
```
