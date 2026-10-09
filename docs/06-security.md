# Security

- [Security model](#security-model)
- [Roles](#roles)
- [Security posture audit](#security-posture-audit)
- [Configuration drift](#configuration-drift)
- [Hardening checklist](#hardening-checklist)
- [Reporting a vulnerability](#reporting-a-vulnerability)

---

## Security model

| Area | How IndexSphere protects it |
|---|---|
| **Sign-in** | bcrypt password hashes; failed-login lockout; the default `admin` password must be changed before any API works. |
| **Sessions** | Signed JWT in an HttpOnly, SameSite=Strict cookie (`Secure` in production). Tokens are invalidated on server restart. Deleted or disabled users lose access at once, and role changes apply immediately (checked against the database on every request). |
| **Cluster credentials** | Saved connection passwords are encrypted with AES-256-GCM and never returned to the browser. Each user's live connection (Elasticsearch/OpenSearch and ClickHouse) is held on the server, per user. No user can act through another user's connection. |
| **Authorization** | Enforced server-side on every request (next section), including on the raw Elasticsearch proxy and the SQL workbench. |
| **Outbound requests (SSRF)** | Cluster, ClickHouse, AI-provider and webhook URLs cannot reach cloud metadata, link-local, multicast or (in production) loopback addresses. The resolved IP is checked again at connect time, which defeats DNS rebinding. Redirects are never followed. `CLUSTER_HOST_ALLOWLIST` can restrict targets further. |
| **ClickHouse SQL** | Readonly users run with ClickHouse's server-enforced `readonly=2`. External table functions/engines, `KILL`, `SYSTEM`, `GRANT` and limit overrides are restricted to admins. |
| **Injection** | Parameterised SQL everywhere (SQLite and ClickHouse `{name:Type}` parameters). Identifiers are allowlisted. HTML in PDF reports is escaped and rendered with JavaScript and network disabled. CSV exports neutralise formula injection. |
| **Resource abuse** | Request body and response size caps, query time and scan limits, concurrency limits for PDF and migration jobs, bounded caches. |
| **Audit** | Every API action is recorded (who, what, target, status, duration). Request bodies are truncated to 8 KB. Retention defaults to 90 days. |
| **Secrets in transit** | AI provider keys stay in the browser and are sent per request. Webhook URLs are visible to admins only. |

## Roles

| Capability | readonly | user | admin |
|---|---|---|---|
| View clusters, indices, nodes, shards, monitoring, advisors | ✓ | ✓ | ✓ |
| Search / read-only APIs (`_search`, `_count`, `_mget`, …) | ✓ | ✓ | ✓ |
| Index/data writes (create/delete index, reindex, bulk, delete-by-query) | — | ✓ | ✓ |
| Cluster administration (security plugin, cluster settings, snapshots, nodes, ILM/ISM, scripts) | — | — | ✓ |
| Ad-hoc connections to any URL | — | ✓ | ✓ |
| Saved connections | granted ones | granted ones | all |
| ClickHouse: SELECT / EXPLAIN | ✓ | ✓ | ✓ |
| ClickHouse: INSERT / DDL / copy data | — | ✓ | ✓ |
| ClickHouse: external functions, KILL, SYSTEM, GRANT | — | — | ✓ |
| Configuration drift (users/grants sections) | — | ✓ (no) | ✓ (yes) |
| Alerts, scheduled reports, PDF reports, SMTP, users, authentication settings | — | — | ✓ |
| Audit trail | own actions | own actions | everyone |

The account IndexSphere uses on the cluster still applies on top of this. Give each saved connection a cluster account with the least privilege its users need.

## Security posture audit

**Cross-engine → Security posture** audits a connected server read-only. It never tries passwords: guessing would trip lockouts and SIEM alerts. It only inspects configuration the connected account can read; checks it cannot run are listed as *skipped*.

**Elasticsearch / OpenSearch checks**

| Check | Severity if failing |
|---|---|
| Anonymous access answers API requests | critical |
| Security features disabled (`xpack.security.enabled: false`) | critical |
| **Publicly known demo TLS certificate** (OpenSearch demo CA). Detected from the TLS handshake, no privileges needed. | critical |
| HTTP without TLS / expired certificate | high |
| OpenSearch demo users present (`logstash`, `kibanaro`, `readall`, …) | high |
| CORS open to any origin | high |
| No snapshot repository | high |
| Snapshots stale (> 48 h) | medium |
| Wildcard deletes allowed (`action.destructive_requires_name: false`) | medium |
| Security audit logging disabled | medium |
| Disk above the high watermark | medium |
| Indices without replicas / single data node | medium / low |
| Known CVEs for the running version | by worst finding (critical if actively exploited) |

**ClickHouse checks**

| Check | Severity if failing |
|---|---|
| Users without a password | critical |
| HTTP without TLS | high |
| `default` user reachable from any host | high |
| `SOURCES`/`URL`/`FILE`/`REMOTE`/`S3`… privileges granted (SSRF, file read, exfiltration) | high |
| Plaintext password storage | medium |
| Query log disabled | medium |
| No (recent) backups in `system.backups` | medium |
| Low free disk space | medium |
| Several principals with `GRANT OPTION` | low |
| No query time limit in the profile | low |
| Login (session) log disabled | low |
| Known CVEs for the running version | by worst finding |

**Score.** 100 minus 25 per critical, 12 per high, 6 per medium and 2 per low finding. **Grades:** A ≥ 90, B ≥ 75, C ≥ 60, D ≥ 40, F below 40.

## Configuration drift

**Cross-engine → Configuration drift** keeps a history of each server's configuration.

- **What a snapshot covers.**
  - **Search clusters:** cluster settings, index/component/legacy templates, ingest pipelines, ILM/ISM policies, aliases, snapshot repositories, each index's behaviour settings and a fingerprint of its mapping, security roles, role mappings and users (no password hashes).
  - **ClickHouse:** table definitions, users (auth type, host restrictions), roles, grants, settings profiles, quotas, row policies, changed server settings and dictionaries.
- **Noise-free.** Volatile fields (timestamps, UUIDs, versions, counters) are stripped and secrets are redacted. A new snapshot is stored only when something actually changed; otherwise the previous one is marked "confirmed" at that time.
- **When snapshots are taken.** Manually with **Take snapshot**, and automatically every night for all saved connections (`DRIFT_SNAPSHOT_CRON`, default 02:30). The last 90 changed snapshots are kept per connection.
- **The diff** lists added, removed and changed objects, with before and after values for each setting.
- **Access.** Admins and operators only. Sections listing users, roles and grants are visible to admins only.

## Hardening checklist

- [ ] Serve IndexSphere over HTTPS (`docker-compose.nginx.yml` or your own TLS proxy).
- [ ] Set a strong, stored `JWT_SECRET`; restrict who can read the `.env`.
- [ ] Change the initial admin password and create named accounts; keep `admin` for administrators.
- [ ] Use saved connections with least-privilege cluster accounts and **Verify SSL** on.
- [ ] Set `CLUSTER_HOST_ALLOWLIST` to the clusters IndexSphere should reach.
- [ ] Restrict network access to IndexSphere (VPN, firewall, SSO proxy).
- [ ] Back up `/app/data` (see [Operations](07-operations.md#backup-and-restore)).
- [ ] Run **Security posture** on every cluster and fix critical/high findings.
- [ ] Keep drift snapshots enabled and review changes weekly.

## Reporting a vulnerability

Email the maintainers privately (see `CONTRIBUTING.md`) with steps to reproduce. Please do not open a public issue for security problems.
