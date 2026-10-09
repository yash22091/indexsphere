# Troubleshooting

Find the message you see, then follow the fix. If nothing matches, check `docker logs indexsphere-prod` and the **Audit trail**.

- [Installation and sign-in](#installation-and-sign-in)
- [Connecting to clusters](#connecting-to-clusters)
- [Permissions](#permissions)
- [ClickHouse](#clickhouse)
- [Vulnerabilities and security pages](#vulnerabilities-and-security-pages)
- [Reports, email and alerts](#reports-email-and-alerts)
- [Performance and memory](#performance-and-memory)
- [Docker build](#docker-build)

---

## Installation and sign-in

| Symptom | Cause | Fix |
|---|---|---|
| Container exits: `JWT_SECRET environment variable is required in production` | No secret set | `JWT_SECRET=$(openssl rand -hex 32)` in `.env`, then restart. |
| Sign-in "succeeds" but you land back on the sign-in page | The session cookie is `Secure` and you opened IndexSphere over plain `http://` (not localhost) | Use HTTPS (`docker-compose.nginx.yml`), or for internal HTTP-only setups set `COOKIE_SECURE=false`. |
| `Account temporarily locked due to too many failed attempts` | Lockout policy | Wait for the lockout period, or an admin unlocks it in **Administration → Authentication**. |
| Every page redirects to *Set a new password* | First sign-in with the default password | Set a new password. The API refuses other calls until you do. |
| Everyone was signed out | Server restart, upgrade, or `JWT_SECRET` changed | Expected. Sign in again. |
| Forgot the only admin password | — | Stop the container. Then either back up and delete the database volume (it resets to `admin/admin`), or set a new bcrypt hash in `users` with `sqlite3`. |

## Connecting to clusters

| Message | Cause | Fix |
|---|---|---|
| `Destination not allowed (link-local / cloud metadata address)` | The URL points at a metadata or link-local address | Use the cluster's real address. These ranges are always blocked. |
| `Destination not allowed (loopback address)` | `localhost` / `127.0.0.1` in production | Inside Docker, `localhost` is the container itself. Use the host's IP or a service name. For a same-host target outside Docker, set `ALLOW_LOOPBACK_TARGETS=true`. |
| `Host "x" is not in CLUSTER_HOST_ALLOWLIST` | Allowlist active | Add the host (`host`, `ip` or `*.suffix`) to `CLUSTER_HOST_ALLOWLIST`. |
| `Request failed: 401 Unauthorized` | Wrong cluster credentials | Check username and password with `curl -k -u user:pass https://host:9200`. |
| `self-signed certificate` / `unable to verify the first certificate` | **Verify SSL** is on and the certificate isn't trusted | Turn off *Verify SSL certificate* on the connection, or use a CA-issued certificate. |
| `Request timed out after 60s` | Network path or overloaded cluster | Check firewalls and routing. Raise `CLUSTER_REQUEST_TIMEOUT_MS` if the cluster is slow. |
| `No cluster connected. Please connect to a cluster first.` (409) | No session for your user (new login, restart, or the connection was edited by an admin) | Connect again from **Connections**. |
| `Response too large (> 50 MB)` | Huge result | Use `size`, `_source` filters or pagination; raise `CLUSTER_MAX_RESPONSE_BYTES` only if needed. |
| `Request body exceeds 20 MB` (413) | Oversized `_bulk` | Send smaller batches, or raise `PROXY_MAX_BODY_BYTES`. |

## Permissions

| Message | Meaning |
|---|---|
| `Your role (readonly) is not allowed to perform DELETE /index` | Readonly users can only read and search. |
| `Your role (user) is not allowed to perform PUT /_cluster/settings` | Cluster administration (security, settings, snapshots, nodes, ILM/ISM) is admin-only. |
| `Read-only users can only connect through saved connections assigned by an admin` | Ask an admin to add `readonly` to the connection's allowed roles. |
| A saved connection is missing from your list | Your role is not in its *Allowed roles*. |
| `Configuration history is available to admins and operators` | Drift requires the `user` or `admin` role. |

## ClickHouse

| Message | Cause | Fix |
|---|---|---|
| `Authentication failed: password is incorrect, or there is no user with such name` | Wrong credentials | Check with `curl -u user:pass 'http://host:8123/?query=SELECT+1'`. |
| `Cannot execute query in readonly mode` | Your IndexSphere role is `readonly` (ClickHouse runs your queries with `readonly=2`) | Expected. Ask an operator or admin to run writes. |
| `External table functions/engines … are restricted to admins` | `url()`, `file()`, `s3()`, `remote()`, … | Admin-only by design (SSRF and file-read risk). |
| `Query safety limits … cannot be overridden` | `SETTINGS max_execution_time = 0` or similar in the query | Admins can override; others work within `CLICKHOUSE_MAX_*`. |
| `Limit for rows or bytes to read exceeded` | Query scans more than `CLICKHOUSE_MAX_BYTES_TO_READ` | Filter on the sort key (`EXPLAIN indexes = 1` shows what's pruned), or raise the limit. |
| `(total) memory limit exceeded` | The ClickHouse server ran out of memory (usually other workloads) | Retry later; reduce `GROUP BY` cardinality; check the server's memory in **ClickHouse → Overview**. |
| Query activity shows "query_log is disabled or not granted" | The account can't read `system.query_log` | `GRANT SELECT ON system.* TO <user>`. |
| Advisor shows warnings about `system.query_log` | Same | Same; the insert and query-pattern rules are skipped until then. |
| Copy job `failed` with `Cannot parse input` | A source field doesn't fit the planned type | Change that column's type in the DDL (e.g. to `String`), create the table yourself, and run the copy with *Create table if missing* on. |
| Copy job `interrupted` | The server restarted during the copy | Start it again. Truncate the target table first, or copy into a new table. |
| `Read-only users cannot copy data` | Role | Requires `user` or `admin`. |

## Vulnerabilities and security pages

| Symptom | Fix |
|---|---|
| `NVD: … returned HTTP 403/429` | NVD rate limit. Results are cached; wait and retry, or set `NVD_API_KEY`. |
| `Online lookups disabled (VULN_INTEL_DISABLED=true)` | Expected in air-gapped mode. |
| Posture checks listed as *skipped* | The connected cluster account lacks read access (e.g. the security plugin API or `system.users`). Grant read-only access to that configuration, or accept the gap. |
| Posture reports a demo TLS certificate | The node uses OpenSearch's sample certificates, whose private keys are public. Replace them with your own CA. |

## Reports, email and alerts

| Symptom | Fix |
|---|---|
| Scheduled report status `error: email delivery failed` | Configure SMTP in **Settings → Email** and use **Send test email**. |
| `PDF generator is busy, please retry in a moment` (429) | More than `PDF_MAX_CONCURRENCY` PDFs at once. Retry, or raise it (each needs about 200 MB). |
| PDF fails with a Chromium error | Check `PUPPETEER_EXECUTABLE_PATH` (Docker: `/usr/bin/chromium-browser`). For source installs, run `npx puppeteer browsers install chrome`. |
| Alerts never fire | Rules are evaluated while *Live monitoring* (search metrics) or *ClickHouse overview* (`ch_*` metrics) is open. Also check the cooldown (`window_minutes`) and the rule's metric type. |
| Webhook rejected: `URL rejected: Destination not allowed` | Webhook URLs follow the same outbound rules as cluster URLs. |

## Performance and memory

| Symptom | Fix |
|---|---|
| Container killed (OOM) | Keep the heap (`NODE_OPTIONS`) at least 400 MB below the container limit. Lower `PDF_MAX_CONCURRENCY`. |
| Pages slow while many users sign in | Expected to be minimal. Sign-in hashing runs off the main thread. If you upgraded from an older build, rebuild so the native `bcrypt` module is used. |
| Overview / monitoring slow | Usually the cluster itself. Compare with `curl` timings to `_cluster/health`. |

## Docker build

| Error | Fix |
|---|---|
| `prebuild-install … No prebuilt binaries found` then `gyp … ETIMEDOUT` | The build compiles native modules. The Dockerfile sets `npm_config_nodedir=/usr/local` so headers come from the image. If you changed the base image, keep that line and the `python3 make g++` packages. |
| `Segmentation fault` after upgrading Node or `better-sqlite3` | `better-sqlite3` ≥ 13 requires Node 22+. This project pins 12.x, which supports Node 20 and 22. |
