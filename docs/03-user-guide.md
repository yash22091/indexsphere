# User guide

- [The console at a glance](#the-console-at-a-glance)
- [Connecting to a cluster](#connecting-to-a-cluster)
- [Elasticsearch / OpenSearch pages](#elasticsearch--opensearch-pages)
- [Data operations](#data-operations)
- [ClickHouse](#clickhouse)
- [Security](#security)
- [Alerts and reports](#alerts-and-reports)
- [Administration](#administration)
- [Common workflows](#common-workflows)

---

## The console at a glance

- **Sidebar.** Pages grouped by area. The box at the top shows your **search cluster** and **ClickHouse** connections; hover a row to disconnect it. Groups can be collapsed and remember their state.
- **Breadcrumb.** The current area and page.
- **⌘K / Ctrl+K.** A command palette for jumping to any page, switching theme or signing out.
- **User menu** (bottom of the sidebar). Your role, light/dark/system theme, and sign out.

Your connections are **personal**. Each user has their own search-cluster session and their own ClickHouse session, held on the server. Cluster passwords never reach the browser. A server restart signs everyone out and drops all sessions.

## Connecting to a cluster

### Saved connections (recommended)

1. Go to **Administration → Connections → Add connection** (admins).
2. Choose the **engine**: Elasticsearch, OpenSearch or ClickHouse.
3. Enter the URL, for example `https://es1.corp:9200` or, for ClickHouse, `http://ch.corp:8123` or `https://ch.corp:8443`. Then the username and password.
4. **Verify SSL certificate.** Keep this on if the server has a certificate from a trusted CA. Turn it off for self-signed certificates.
5. **Allowed roles.** Which roles may use this connection: `admin`, `user`, `readonly`. Readonly users can only connect through connections granted to them.
6. **Test**, then **Connect**. Search-cluster connections open the Overview; ClickHouse connections open the ClickHouse overview.

The password is encrypted in the database and is never sent back to the browser. If an admin edits or deletes a connection, everyone using it is disconnected.

### Quick connect (ad-hoc)

**Administration → Quick connect** connects to a URL without saving it. This needs the `admin` or `user` role. The browser remembers only the URL and engine, never the password.

## Elasticsearch / OpenSearch pages

| Page | What it is for |
|---|---|
| **Overview** | Health, shard counts, quick resilience checks, and a banner if your version has known vulnerabilities. |
| **Cluster health** | Per-node JVM heap, CPU, disk, memory and indexing/search totals. |
| **Cluster analysis** | Scored configuration and performance review with recommendations. |
| **Live monitoring** | 5-second live metrics (CPU, heap, GC pressure, unassigned shards, indexing rate) with warn/critical thresholds. Alert rules are evaluated while it runs. |
| **Nodes** | Roles, versions, resource usage; click a node for details. |
| **Indices** | Health, size and shard layout; select an index for settings, mappings and matching templates. |
| **Shards** | Allocation per index, the reason a shard is unassigned, and "Retry failed allocations". |
| **Index advisor** | Grades each index A–F (health, replicas, shard size, deleted documents, mapping size). Each issue includes the command that fixes it. |
| **Query workbench** | Run DSL queries, see the profile tree with per-step timings, explain a document's score, plus history and saved queries. |
| **AI query** | Describe a search in plain language and get DSL. Emails, IPs, tokens and keys are stripped before anything is sent to the provider. |
| **Search analytics** | Real query and indexing rates and latencies, measured between samples, overall and per index. |
| **Config & policies** | Aliases, templates, lifecycle (ILM/ISM) policies, snapshot repositories, cluster settings. |

## Data operations

| Page | What it is for |
|---|---|
| **Reindex** | Guided reindex with live progress and cancel. |
| **Bulk operations** | Open/close/refresh/flush/force-merge/delete for many indices. Deletes require typing `delete`. |
| **Delete by query** | Preview the matching count and sample documents, then delete. While **Dry run** is on, the delete button is disabled. |
| **Data migration** | Reindex between indices using templates (date range, field transform, cleanup). |
| **Cluster compare** | Diff two clusters: indices only in A or B, shared indices, templates and settings. |

Whether these actions are allowed depends on your role (see [Security → Roles](06-security.md#roles)).

## ClickHouse

See the dedicated [ClickHouse guide](04-clickhouse.md): Overview, Explorer, Query activity, SQL workbench, Table advisor and migrating from Elasticsearch.

## Security

| Page | What it is for |
|---|---|
| **Security posture** | Read-only audit of each connected server: authentication, encryption (including detection of public demo TLS certificates), privileges, logging, backups and known CVEs. Gives a score and grade, and every finding comes with a remediation. See [Security](06-security.md#security-posture-audit). |
| **Vulnerabilities** | CVEs affecting the exact versions you run, flagged with CISA KEV and EPSS, with the smallest safe upgrade. See [Vulnerabilities](05-vulnerabilities.md). |
| **Configuration drift** | A timeline of configuration snapshots and exactly what changed between them. See [Security → Drift](06-security.md#configuration-drift). |
| **Audit trail** | Every API action, filterable and exportable to CSV. Admins see everyone; others see their own actions. |

## Alerts and reports

**Alerts.** A rule compares a metric with a threshold (`>`, `>=`, `<`, `<=`). It notifies by email, Slack or webhook, and waits a cooldown before firing again.
- Search-cluster metrics (`cpu_percent`, `heap_percent`, `gc_pressure`, `unassigned_shards`, `indexing_rate`, `node_count`) are evaluated while someone has Live monitoring open.
- ClickHouse metrics (`ch_*`) are evaluated while someone has the ClickHouse overview open.
- A rule only fires for the source that reports its metric.

**Scheduled reports.** Cluster health or index statistics as CSV or JSON, emailed on a cron schedule. Each report is tied to a saved Elasticsearch/OpenSearch connection. **Run now** sends one immediately; delivery failures are shown with the SMTP error.

**Reports.** On-demand JSON or PDF report of the connected cluster (PDF is admin-only).

## Administration

| Page | What it is for |
|---|---|
| **Connections** | Saved connections (see above). |
| **Quick connect** | Ad-hoc connection. |
| **Users** | Create users, assign roles (`admin`, `user`, `readonly`), reset passwords. You cannot delete yourself or remove your own admin role. |
| **Authentication** | Session length, failed-login lockout, password policy, recent sign-in attempts, unlocking accounts. |
| **Settings** | Cluster settings, email (SMTP) with a test button. |

---

## Common workflows

### Find out why a cluster is yellow or red

1. **Overview** shows the status and the number of unassigned shards.
2. **Shards** shows each unassigned shard with the allocation explanation (disk watermark, allocation filter, missing node…).
3. Fix the cause, then use **Retry failed allocations**.

### Clean up an over-sharded cluster

1. Open **Index advisor**. Sort by grade and expand the worst indices.
2. Shard-size findings include the exact `_shrink` / reindex commands. Copy them into the **Query workbench** or your tooling.

### Prove a configuration change

1. Before a change: **Security → Configuration drift → Take snapshot**.
2. Make the change.
3. **Take snapshot** again. The diff shows each setting with its before and after value.

### Move an index from Elasticsearch to ClickHouse

See [ClickHouse → Migrating from Elasticsearch](04-clickhouse.md#migrating-from-elasticsearch).

### Harden a new cluster

1. Connect it and open **Security → Security posture**.
2. Fix critical and high findings first; each has a copyable remediation.
3. Re-run the audit until the grade is A or B, then keep drift snapshots running to catch regressions.
