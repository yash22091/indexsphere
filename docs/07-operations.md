# Operations

- [What is stored where](#what-is-stored-where)
- [Backup and restore](#backup-and-restore)
- [Data retention](#data-retention)
- [Monitoring IndexSphere itself](#monitoring-indexsphere-itself)
- [Performance and capacity](#performance-and-capacity)
- [Logs](#logs)
- [Rotating secrets](#rotating-secrets)

---

## What is stored where

Everything persistent lives in one SQLite database (`/app/data/indexsphere.db`, WAL mode), on the data volume:

| Table | Contents |
|---|---|
| `users` | Accounts, bcrypt hashes, roles |
| `saved_connections` | Cluster/ClickHouse connections (passwords AES-256-GCM encrypted with a key derived from `JWT_SECRET`) |
| `audit_log` | Every API action (bodies truncated to 8 KB) |
| `alert_rules`, `alert_triggers` | Alert definitions and firing history |
| `scheduled_reports` | Report schedules |
| `config_snapshots` | Configuration drift history |
| `migration_jobs` | Elasticsearch → ClickHouse copy jobs |
| `intel_cache` | Cached NVD / OSV / KEV / EPSS data |
| `app_settings` | SMTP, AI defaults, security settings |

Live cluster sessions are held only in memory. Restarting the server signs everyone out, which is intended.

## Backup and restore

SQLite in WAL mode must be backed up with its own backup API, not by copying the file while the server is running:

```bash
# Online, consistent backup (safe while IndexSphere is running)
docker exec indexsphere-prod node -e "require('better-sqlite3')('/app/data/indexsphere.db').backup('/app/data/backup.db').then(() => console.log('backup ok'))"
mkdir -p backups && docker cp indexsphere-prod:/app/data/backup.db ./backups/indexsphere-$(date +%F).db

# Restore: stop, replace, start
docker compose -f docker-compose.nginx.yml stop indexsphere
docker run --rm -v indexsphere-data:/data -v "$PWD/backups:/b" alpine \
  sh -c 'rm -f /data/indexsphere.db-wal /data/indexsphere.db-shm && cp /b/indexsphere-2026-10-09.db /data/indexsphere.db && chown 1001:1001 /data/indexsphere.db'
docker compose -f docker-compose.nginx.yml start indexsphere
```

Keep `JWT_SECRET` together with the backup. Without it, saved connection passwords cannot be decrypted (everything else still works).

## Data retention

A nightly job (03:41) deletes:

- audit-log rows older than `AUDIT_RETENTION_DAYS` (90),
- alert triggers older than `ALERT_TRIGGER_RETENTION_DAYS` (90),
- cached intel entries older than 7 days.

Drift history keeps the last 90 changed snapshots per connection. Disk usage is typically a few MB per 100,000 audited requests.

## Monitoring IndexSphere itself

- **Liveness:** `GET /api/health` → `200 {"status":"healthy"}`. Public and minimal. The Docker healthcheck uses it.
- **Scheduler:** the log contains `[scheduler] started` exactly once per process.
- **Memory:** with the default `NODE_OPTIONS=--max-old-space-size=384`, the process plateaus around 300–600 MB RSS under sustained load. Alert if the container nears its limit; PDF generation adds about 200 MB per concurrent report.

## Performance and capacity

Measured on a 4-vCPU host against a remote OpenSearch 3.6 and ClickHouse 25.12 (16 concurrent clients, 45 s phases):

| Path | p50 | p95 |
|---|---|---|
| Session check (`/api/auth/verify`) | 6 ms | 13 ms |
| Elasticsearch proxy `_cluster/health` | 13 ms | 34 ms |
| Elasticsearch search via proxy | 20 ms | 33 ms |
| ClickHouse SELECT | 50 ms | 106 ms |
| Vulnerabilities (cached) | 29 ms | 106 ms |
| Mixed load, 16 concurrent | ~65 ms | ~450 ms (≈125 req/s, 0 errors) |

**What keeps it fast**
- Keep-alive connection pools to clusters, with no TLS handshake per request.
- Responses passed through without re-serialisation.
- Native bcrypt off the event loop: sign-in bursts don't slow other requests.
- Bounded caches and size caps.
- Single-flight external lookups.
- Polling that never overlaps.

**Tuning**

| Symptom | Setting |
|---|---|
| Container memory pressure | lower `PDF_MAX_CONCURRENCY`; keep `NODE_OPTIONS` heap ≤ container limit − 400 MB |
| Many users / large clusters | raise heap (`--max-old-space-size=768`) and the container limit |
| Large result sets rejected | ask for less (`size`, `_source`, `LIMIT`), or raise `CLUSTER_MAX_RESPONSE_BYTES` carefully |
| Large `_bulk` rejected (413) | split the request, or raise `PROXY_MAX_BODY_BYTES` |
| Long ClickHouse analytics stopped | raise `CLICKHOUSE_MAX_EXECUTION_TIME` / `CLICKHOUSE_MAX_BYTES_TO_READ` |
| Faster ES → ClickHouse copies | larger *rows per insert* (up to 100,000); run during quiet hours |

## Logs

The container logs to stdout:

```bash
docker logs -f indexsphere-prod
docker logs indexsphere-prod 2>&1 | grep -E '\[scheduler\]|\[drift\]|\[mailer\]|error'
```

- `LOG_LEVEL=debug` adds request-level detail.
- The **Audit trail** page is the authoritative record of user actions.

## Rotating secrets

- **`JWT_SECRET`:**
  1. Set the new value and restart. Everyone is signed out.
  2. Re-enter the password of every saved connection (they were encrypted with the old key).
- **Cluster passwords:** edit the saved connection. Active sessions on it are disconnected automatically.
- **Admin password:** Users page (admin) or the change-password flow.
