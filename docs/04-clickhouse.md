# ClickHouse

IndexSphere manages ClickHouse over its HTTP interface (port 8123, or 8443 with TLS). Your ClickHouse session is independent of your Elasticsearch/OpenSearch session, so you can have both connected at once.

- [Prepare a ClickHouse user](#prepare-a-clickhouse-user)
- [Connect](#connect)
- [Pages](#pages)
- [SQL workbench safety](#sql-workbench-safety)
- [Table advisor](#table-advisor)
- [Migrating from Elasticsearch](#migrating-from-elasticsearch)
- [What each IndexSphere role can do](#what-each-indexsphere-role-can-do)

---

## Prepare a ClickHouse user

Give IndexSphere its own ClickHouse user. Grant only what the people using it need, and let a settings profile enforce limits on the server.

```sql
-- Settings profile: limits enforced by ClickHouse itself
CREATE SETTINGS PROFILE IF NOT EXISTS indexsphere_limits SETTINGS
    max_execution_time = 60,
    max_memory_usage = 10000000000,
    max_result_rows = 100000;

-- Read-only monitoring user (Overview, Explorer, Queries, Advisor, SELECTs)
CREATE USER IF NOT EXISTS indexsphere IDENTIFIED WITH sha256_password BY '<strong password>'
    HOST IP '10.0.0.0/8'                -- the IndexSphere host / network
    SETTINGS PROFILE indexsphere_limits;
GRANT SELECT ON *.* TO indexsphere;
GRANT SHOW TABLES, SHOW COLUMNS, SHOW DATABASES, SHOW DICTIONARIES ON *.* TO indexsphere;
GRANT SELECT ON system.* TO indexsphere;
GRANT SHOW USERS, SHOW ROLES, SHOW QUOTAS, SHOW ROW POLICIES, SHOW SETTINGS PROFILES ON *.* TO indexsphere; -- posture audit & drift

-- Only if you will copy data from Elasticsearch into a dedicated database:
-- GRANT CREATE TABLE, INSERT ON analytics.* TO indexsphere;
```

Avoid connecting as `default`, and never grant `SOURCES` (`url()`, `file()`, `s3()`, `remote()`, …) to the account IndexSphere uses.

## Connect

- **Saved:** Administration → Connections → Add connection → engine **ClickHouse** → Test → Connect.
- **Ad-hoc** (admin/user): open **ClickHouse → Overview** and use *Connect directly*.

## Pages

| Page | What it shows |
|---|---|
| **Overview** | Version, uptime, databases, tables, rows, size on disk, compression ratio, running queries, merges, pending mutations, queries and failures in the last hour (p95 latency), memory, disks, replication and recent server errors. Live charts every 5 s. |
| **Explorer** | Databases → tables (rows, size, compression, parts, partitions, sort key) → columns with key flags and codecs, the `CREATE TABLE` statement, partitions, skip indices and 10 sample rows. |
| **Query activity** | Running queries (admins can kill them), the slowest and failed queries, and the heaviest query patterns from `system.query_log`. Every query has *Open in SQL*. |
| **SQL workbench** | One statement at a time, `EXPLAIN indexes = 1` and `EXPLAIN ESTIMATE`, cancel, CSV/JSON export, history and a table list showing each table's sort key. |
| **Table advisor** | Grades every table A–F against the ClickHouse best-practice rules (below). |
| **Merges & mutations** | Running merges with progress, mutations (pending, failing with the reason; admins can **Kill**), the partitions with the most active parts against `parts_to_delay_insert` / `parts_to_throw_insert`, part moves, and merge history for the last 24 h. |
| **Storage** | Disks with usage, storage policies and volumes; **partitions** of any MergeTree table (rows, size, compression, time range) with **OPTIMIZE … FINAL** (operators, admins) and **Drop partition** (admins, after typing the partition ID); TTL per table; recently dropped tables (with the `UNDROP` statement); detached parts with their reason; dictionaries with status, memory and last error. |
| **Ingestion** | Rows and inserts per table from `system.part_log`, tables receiving **too-small inserts** (< 1,000 rows per INSERT, ≥ 1 per minute), an insert-rate chart, async-insert buffers and flushes, failed INSERTs by error code, materialized views (source → target), refreshable views, view errors and Kafka consumers. |
| **Replication & cluster** | Replicated tables (delay, queue, active/total replicas, read-only), stuck or retrying replication-queue entries, cluster topology from `remote_servers`, ClickHouse Keeper sessions, `ON CLUSTER` DDL status and Distributed send queues. Sections that need Keeper say so when it is not configured. |
| **Server & logs** | `system.warnings`, the server log (`system.text_log`, filter by level, time window and text), errors by type, crashes with stack traces, the connected profile's query settings, server and MergeTree settings changed from defaults, every metric/event/async metric (searchable), and backup history. |
| **Users & access** | Users (authentication type, allowed hosts, default roles), grants (filterable), roles and role assignments, quota usage, settings profiles, row policies and logins/failed logins in the last 24 h. Read-only; operators and admins only. Change access with SQL in the workbench. |
| **ES to ClickHouse** (in *Cross-engine*) | Plan a table from an index mapping and copy the data (below). |

## SQL workbench safety

The workbench follows the `agent-query-safety` rule of the [ClickHouse best-practices](https://github.com/ClickHouse/agent-skills/tree/main/skills/clickhouse-best-practices). It applies these limits to every query:

- **Result rows:** capped (100–10,000, your choice) with `result_overflow_mode = 'break'`, so you get a partial result instead of an error.
- **Time:** `max_execution_time = CLICKHOUSE_MAX_EXECUTION_TIME` (60 s).
- **Scan cap:** `max_bytes_to_read = CLICKHOUSE_MAX_BYTES_TO_READ` (20 GiB).
- **Readonly users:** IndexSphere `readonly` users run with ClickHouse's own `readonly = 2`, so the server refuses writes.
- **Admin-only:**
  - external table functions and engines (`url`, `file`, `s3`, `remote`, `mysql`, …), which could make the server fetch internal URLs or read local files
  - `KILL`, `SYSTEM`, `GRANT` and user/role management
  - per-query overrides of the limits above
- **One statement per request.**

**Cancel** stops the query on the server, not just in the browser. You can cancel only your own queries; admins can cancel any.

## Table advisor

The advisor reads only system tables (fast and safe on production), then grades each table. **Deep analyze** additionally samples up to 1M rows with a scan cap to measure distinct values and integer ranges.

| Rule | Detects |
|---|---|
| `schema-pk-plan-before-creation` | No `ORDER BY` key (every query scans the full table) |
| `schema-pk-cardinality-order` | A timestamp first in the key, or key columns not ordered low → high cardinality (deep) |
| `schema-pk-filter-on-orderby` / `query-index-skipping-indices` | Recent queries reading more than half the table, which means their filters don't use the sort key |
| `schema-partition-low-cardinality` / `schema-partition-start-without` | Too many partitions, or partitions far too small for the data size |
| `insert-batch-size` / `insert-async-small-batches` | Too many active parts per partition; many tiny INSERTs |
| `insert-mutation-avoid-update` / `insert-mutation-avoid-delete` | Pending or frequent `ALTER UPDATE/DELETE`; `ReplacingMergeTree` without a version column |
| `insert-optimize-avoid-final` | Regular `OPTIMIZE … FINAL` |
| `schema-types-avoid-nullable` | `Nullable` columns, especially in the sort key |
| `schema-types-native-types` | Timestamps, IPs or UUIDs stored as `String` |
| `schema-types-lowcardinality` (deep) | `String` columns with fewer than 10K distinct values |
| `schema-types-minimize-bitwidth` (deep) | Integers wider than their values need |
| `schema-json-when-to-use` | Raw JSON blobs that should become typed columns |

Every finding names its rule (linked to the rule text) and includes the SQL to fix it.

## Migrating from Elasticsearch

Both connections are needed: the source search cluster and the target ClickHouse.

1. **Plan.** Open **Cross-engine → ES to ClickHouse**, pick an index or pattern (e.g. `logs-*`), a target database and table, and keep **Analyze field cardinality** on. IndexSphere reads the mapping and proposes the table:
   - **Native types.** `date` → `DateTime64(3)`, `ip` → `IPv6`, numbers → sized integers, `scaled_float` → `Decimal`, `geo_point` → `Point`, dynamic objects → `JSON`.
   - **`LowCardinality(String)`** for keyword fields (and text fields with a `.keyword` sub-field) that have fewer than 10K distinct values, measured with a read-only aggregation.
   - **No `Nullable`**; missing values get defaults.
   - **`ORDER BY`** with low-cardinality fields first and the event time last; **`PARTITION BY toYYYYMM(time)`**.
2. **Review.** ORDER BY can't be changed later. Edit the DDL in the SQL workbench if your queries filter on other fields.
3. **Copy data.**
   - **Settings:** pick rows per insert (10,000–100,000; 20,000 by default), optionally a document limit to try a sample first, and *Create table if missing*. Then **Start copy**.
   - **How it runs:** the job runs in the background. It reads with the scroll API and inserts batches as `JSONEachRow`, holding one batch in memory at a time. You can leave the page and come back.
   - **Cancel** stops after the current batch.
   - **When it finishes:** IndexSphere verifies **row parity** (documents read = rows inserted = rows added to the table) and compares **storage**, Elasticsearch primary size against ClickHouse compressed size.
4. **Point queries and dashboards at ClickHouse.** For ongoing ingestion use a pipeline (Vector, Logstash or Fluent Bit ClickHouse outputs), with batching per `insert-batch-size`.

Example from testing: an OpenSearch audit-log index of 78,971 documents (22.4 MiB primary) copied in 21 s, with exact parity. It took **914 KiB in ClickHouse, 25× smaller**.

## What each IndexSphere role can do

| | readonly | user | admin |
|---|---|---|---|
| Overview, Explorer, Queries, Advisor | ✓ | ✓ | ✓ |
| SELECT / SHOW / DESCRIBE / EXPLAIN | ✓ | ✓ | ✓ |
| INSERT, CREATE/ALTER/DROP TABLE | — | ✓ | ✓ |
| Copy data from Elasticsearch | — | ✓ | ✓ |
| `url()` / `file()` / `s3()` / `remote()` … | — | — | ✓ |
| KILL QUERY, SYSTEM, GRANT, user management | — | — | ✓ |
| Ad-hoc connection to any URL | — | ✓ | ✓ |

ClickHouse's own grants still apply on top of these rules. IndexSphere never lets someone do more than the ClickHouse account it connects with is allowed to.
