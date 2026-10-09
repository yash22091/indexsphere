/**
 * ClickHouse configuration review — is this server set up the way ClickHouse
 * recommends for production?
 *
 * Read-only. Every check compares a live value (server settings, the connected
 * user's settings profile, MergeTree settings, system tables) with the
 * recommendation from the ClickHouse documentation ("Usage recommendations",
 * "Server settings", "Too many parts") and the clickhouse-best-practices skill
 * (insert-batch-size, insert-async-small-batches, schema-partition-*).
 * A check the connected user cannot evaluate is reported as skipped, never
 * as passed.
 *
 * Scoring reuses the posture weights so the grade means the same thing on
 * every page.
 */
import type { ClickHouseClient } from './clickhouse';
import type { UserRole } from './auth';
import { Review, finalizeReview, formatSize, type ConfigReview } from './config-review';

export type { ConfigCheck, ConfigReview } from './config-review';

export type ConfigCategory =
  | 'Version' | 'Memory' | 'Concurrency' | 'Data safety' | 'Merges & parts'
  | 'Inserts' | 'Schema' | 'Storage' | 'Replication' | 'Observability' | 'Query guardrails' | 'Server warnings';

export const CONFIG_CATEGORIES: ConfigCategory[] = [
  'Version', 'Memory', 'Concurrency', 'Data safety', 'Merges & parts', 'Inserts', 'Schema',
  'Storage', 'Replication', 'Observability', 'Query guardrails', 'Server warnings',
];

type Row = Record<string, unknown>;
const GiB = 1024 ** 3;
const n = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;
const s = (v: unknown) => (v === null || v === undefined ? '' : String(v));

const DOCS = {
  usage: 'https://clickhouse.com/docs/operations/tips',
  serverSettings: 'https://clickhouse.com/docs/operations/server-configuration-parameters/settings',
  settings: 'https://clickhouse.com/docs/operations/settings/settings',
  mergeTree: 'https://clickhouse.com/docs/operations/settings/merge-tree-settings',
  systemLogs: 'https://clickhouse.com/docs/operations/system-tables/overview#system-tables-introduction',
  backups: 'https://clickhouse.com/docs/operations/backup',
  releases: 'https://clickhouse.com/docs/whats-new/changelog',
  replication: 'https://clickhouse.com/docs/engines/table-engines/mergetree-family/replication',
};

/** "25.12.1.649" → { year: 2025, month: 12, lts } — ClickHouse versions are YY.MM. */
export function parseClickHouseVersion(version: string): { year: number; month: number; lts: boolean } | null {
  const m = version.match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  const year = 2000 + Number(m[1]);
  const month = Number(m[2]);
  if (month < 1 || month > 12) return null;
  // Long-term-support releases are the .3 and .8 releases of each year
  return { year, month, lts: month === 3 || month === 8 };
}

/**
 * ClickHouse supports the three most recent stable releases (~3 months each)
 * and the two most recent LTS releases (~1 year each).
 */
export function versionSupport(version: string, now = new Date()): { months: number; lts: boolean; supported: boolean } | null {
  const v = parseClickHouseVersion(version);
  if (!v) return null;
  const months = (now.getUTCFullYear() - v.year) * 12 + (now.getUTCMonth() + 1 - v.month);
  return { months, lts: v.lts, supported: v.lts ? months <= 12 : months <= 3 };
}

export async function reviewClickHouseConfig(
  client: ClickHouseClient,
  role: UserRole,
  meta: { url: string; version: string },
  /** Table advisor grades (schema best practices), when available. */
  schema?: { table: string; score: number; grade: string }[] | null,
): Promise<ConfigReview> {
  const r = new Review<ConfigCategory>();
  const q = (sql: string) => client.query<Row>(sql, { role }).then(x => x.data).catch(() => null);

  const [
    server, settings, mergeTree, asyncM, parts, partitions, disks, logTables, warnings,
    replicas, mutations, detached, smallInserts, backups, queryLogRecent, timezone,
  ] = await Promise.all([
    q(`SELECT name, value, default, changed FROM system.server_settings WHERE name IN (
         'max_server_memory_usage', 'max_server_memory_usage_to_ram_ratio', 'max_concurrent_queries',
         'background_pool_size', 'max_table_size_to_drop', 'max_partition_size_to_drop', 'mark_cache_size',
         'uncompressed_cache_size', 'concurrent_threads_soft_limit_num', 'concurrent_threads_soft_limit_ratio_to_cores')`),
    client.profileSettings([
      'max_memory_usage', 'max_execution_time', 'log_queries', 'max_partitions_per_insert_block', 'max_threads',
      'max_bytes_before_external_group_by', 'max_bytes_ratio_before_external_group_by',
    ], role).catch(() => null),
    q(`SELECT name, value, changed FROM system.merge_tree_settings WHERE name IN (
         'parts_to_delay_insert', 'parts_to_throw_insert', 'max_parts_in_total')`),
    q(`SELECT metric, value FROM system.asynchronous_metrics WHERE metric IN ('OSMemoryTotal', 'CGroupMemoryTotal', 'MaxPartCountForPartition')`),
    q(`SELECT sum(data_compressed_bytes) AS compressed, sum(data_uncompressed_bytes) AS uncompressed
       FROM system.parts WHERE active AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`),
    q(`SELECT database, table, uniqExact(partition_id) AS partitions, count() AS parts, max(cnt) AS max_parts_in_partition
       FROM (SELECT database, table, partition_id, count() AS cnt FROM system.parts WHERE active GROUP BY database, table, partition_id)
       GROUP BY database, table ORDER BY partitions DESC LIMIT 50`),
    q(`SELECT name, free_space, total_space, type FROM system.disks`),
    q(`SELECT name, total_bytes, create_table_query FROM system.tables
       WHERE database = 'system' AND engine LIKE '%MergeTree%' AND name LIKE '%log%'`),
    q(`SELECT message FROM system.warnings`),
    q(`SELECT count() AS tables, countIf(is_readonly) AS readonly, countIf(is_session_expired) AS expired,
              max(absolute_delay) AS max_delay, min(active_replicas) AS min_active, max(total_replicas) AS max_total
       FROM system.replicas`),
    q(`SELECT database, table, mutation_id, create_time, parts_to_do, latest_fail_reason
       FROM system.mutations WHERE NOT is_done ORDER BY create_time LIMIT 50`),
    q(`SELECT reason, count() AS c FROM system.detached_parts GROUP BY reason`),
    q(`SELECT database, table, count() AS inserts, round(avg(rows)) AS avg_rows
       FROM system.part_log
       WHERE event_type = 'NewPart' AND event_time > now() - INTERVAL 24 HOUR
         AND database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')
       GROUP BY database, table HAVING inserts >= 1000 AND avg_rows < 1000
       ORDER BY inserts DESC LIMIT 20`),
    q(`SELECT max(event_time) AS last FROM system.backup_log WHERE status = 'BACKUP_CREATED'`),
    q(`SELECT count() AS c FROM system.query_log WHERE event_time > now() - INTERVAL 1 DAY`),
    q(`SELECT timezone() AS tz`),
  ]);

  const kv = (rows: Row[] | null, key = 'name') => new Map((rows ?? []).map(x => [s(x[key]), x]));
  const srv = kv(server);
  const set = kv(settings);
  const mt = kv(mergeTree);
  const am = new Map((asyncM ?? []).map(x => [s(x.metric), n(x.value)]));
  const ram = am.get('CGroupMemoryTotal') || am.get('OSMemoryTotal') || 0;
  const cores = Number(s(set.get('max_threads')?.value).match(/\d+/)?.[0] ?? 0);

  // ── Version ──────────────────────────────────────────────────────────────
  const vs = versionSupport(meta.version);
  if (!vs) {
    r.skip({ id: 'ch-version-support', category: 'Version', title: 'Release is in support', detail: `Unrecognised version "${meta.version}"` });
  } else {
    const kind = vs.lts ? 'LTS' : 'stable';
    const base = { id: 'ch-version-support', category: 'Version' as const, title: 'Release is in support',
      current: `${meta.version} (${kind}, ${vs.months} month${vs.months === 1 ? '' : 's'} old)`,
      recommended: 'A supported LTS release (YY.3 / YY.8) for production', reference: DOCS.releases };
    if (!vs.supported) {
      r.fail({ ...base, severity: vs.lts ? 'high' : 'medium',
        detail: vs.lts
          ? 'LTS releases receive fixes for about a year. This one no longer gets security or bug fixes.'
          : 'Non-LTS releases are supported for about three months. This release no longer gets security or bug fixes.',
        remediation: 'Upgrade to the latest LTS release. Check the Vulnerabilities page for CVEs that affect this version.' });
    } else if (!vs.lts) {
      r.fail({ ...base, severity: 'low',
        detail: 'Stable releases are supported for about three months, so production servers on them need frequent upgrades.',
        remediation: 'Prefer the latest LTS release (YY.3 or YY.8) for production.' });
    } else {
      r.pass(base);
    }
  }

  // ── Memory ───────────────────────────────────────────────────────────────
  const ratio = srv.get('max_server_memory_usage_to_ram_ratio');
  const maxMem = srv.get('max_server_memory_usage');
  if (!ratio || !ram) {
    r.skip({ id: 'ch-mem-server-limit', category: 'Memory', title: 'Server memory limit', detail: 'system.server_settings or OS memory metrics are not readable' });
  } else {
    const effective = n(maxMem?.value);
    const base = { id: 'ch-mem-server-limit', category: 'Memory' as const, title: 'Server memory limit leaves headroom for the OS',
      current: `${formatSize(effective)} of ${formatSize(ram)} RAM (ratio ${s(ratio.value)})`,
      recommended: '≤ 90% of RAM (max_server_memory_usage_to_ram_ratio ≤ 0.9)', reference: DOCS.serverSettings };
    if (effective > ram) {
      r.fail({ ...base, severity: 'high', detail: 'The limit is above physical memory, so the kernel OOM killer — not ClickHouse — decides what dies under pressure.',
        remediation: 'Remove max_server_memory_usage, or set max_server_memory_usage_to_ram_ratio to 0.9 or lower.' });
    } else if (n(ratio.value) > 0.9 && n(maxMem?.value) === 0) {
      r.fail({ ...base, severity: 'medium', detail: 'Less than 10% of RAM is left for the page cache and the OS.',
        remediation: '<max_server_memory_usage_to_ram_ratio>0.9</max_server_memory_usage_to_ram_ratio>' });
    } else {
      r.pass(base);
    }
  }

  const perQuery = set.get('max_memory_usage');
  if (!perQuery) {
    r.skip({ id: 'ch-mem-query-limit', category: 'Memory', title: 'Per-query memory limit', detail: 'system.settings is not readable' });
  } else {
    const v = n(perQuery.value);
    const base = { id: 'ch-mem-query-limit', category: 'Memory' as const, title: 'Per-query memory limit in the user profile',
      current: v ? formatSize(v) : '0 (unlimited)', recommended: 'Set in the settings profile, e.g. 25–50% of RAM', reference: DOCS.settings };
    if (!v) {
      r.fail({ ...base, severity: 'low',
        detail: 'One query can take memory up to the server limit and fail every other query. (Measured for the connected user\'s profile.)',
        remediation: `ALTER SETTINGS PROFILE default SETTINGS max_memory_usage = ${ram ? Math.round(ram * 0.4) : '<bytes>'}` });
    } else r.pass(base);
  }

  const mark = n(srv.get('mark_cache_size')?.value);
  const unc = n(srv.get('uncompressed_cache_size')?.value);
  if (!ram || !srv.has('mark_cache_size')) {
    r.skip({ id: 'ch-mem-caches', category: 'Memory', title: 'Cache sizes fit in RAM', detail: 'Cache settings or OS memory are not readable' });
  } else {
    const total = mark + unc;
    const base = { id: 'ch-mem-caches', category: 'Memory' as const, title: 'Cache sizes fit in RAM',
      current: `mark ${formatSize(mark)} + uncompressed ${formatSize(unc)} = ${Math.round((total / ram) * 100)}% of RAM`,
      recommended: '≤ 50% of RAM in total', reference: DOCS.serverSettings };
    if (total > ram * 0.5) {
      r.fail({ ...base, severity: total > ram ? 'medium' : 'low',
        detail: 'Caches fill up to their limit over time and compete with queries and merges for memory.',
        remediation: `Lower uncompressed_cache_size (only useful for very short queries) and/or mark_cache_size, e.g. <mark_cache_size>${Math.round(ram * 0.1)}</mark_cache_size>` });
    } else r.pass(base);
  }

  const spillBytes = n(set.get('max_bytes_before_external_group_by')?.value);
  const spillRatio = n(set.get('max_bytes_ratio_before_external_group_by')?.value);
  if (!set.has('max_bytes_before_external_group_by')) {
    r.skip({ id: 'ch-mem-spill', category: 'Memory', title: 'Large GROUP BY spills to disk', detail: 'system.settings is not readable' });
  } else {
    const base = { id: 'ch-mem-spill', category: 'Memory' as const, title: 'Large GROUP BY spills to disk instead of failing',
      current: spillBytes ? formatSize(spillBytes) : spillRatio ? `ratio ${spillRatio}` : 'disabled',
      recommended: 'max_bytes_ratio_before_external_group_by = 0.5 (or a byte limit)', reference: DOCS.settings };
    if (!spillBytes && !spillRatio) {
      r.fail({ ...base, severity: 'low', detail: 'Big aggregations fail with MEMORY_LIMIT_EXCEEDED instead of spilling to disk.',
        remediation: 'ALTER SETTINGS PROFILE default SETTINGS max_bytes_ratio_before_external_group_by = 0.5' });
    } else r.pass(base);
  }

  // ── Concurrency ──────────────────────────────────────────────────────────
  const mcq = srv.get('max_concurrent_queries');
  if (!mcq) {
    r.skip({ id: 'ch-max-concurrent-queries', category: 'Concurrency', title: 'Concurrent query limit', detail: 'system.server_settings is not readable' });
  } else {
    const v = n(mcq.value);
    const base = { id: 'ch-max-concurrent-queries', category: 'Concurrency' as const, title: 'Concurrent query limit is set',
      current: v ? String(v) : '0 (unlimited)', recommended: 'A finite limit (default 1000)', reference: DOCS.serverSettings };
    if (!v) r.fail({ ...base, severity: 'medium', detail: 'A query storm can exhaust threads and memory with no back-pressure.', remediation: '<max_concurrent_queries>1000</max_concurrent_queries>' });
    else r.pass(base);
  }

  const softNum = n(srv.get('concurrent_threads_soft_limit_num')?.value);
  const softRatio = n(srv.get('concurrent_threads_soft_limit_ratio_to_cores')?.value);
  if (!srv.has('concurrent_threads_soft_limit_ratio_to_cores')) {
    r.skip({ id: 'ch-thread-limit', category: 'Concurrency', title: 'Query thread soft limit', detail: 'Not available on this version' });
  } else {
    const base = { id: 'ch-thread-limit', category: 'Concurrency' as const, title: 'Query threads are capped relative to CPU cores',
      current: softNum ? `${softNum} threads` : softRatio ? `${softRatio}× cores` : 'unlimited',
      recommended: 'concurrent_threads_soft_limit_ratio_to_cores = 2', reference: DOCS.serverSettings };
    if (!softNum && !softRatio) {
      r.fail({ ...base, severity: 'low', detail: 'Many concurrent queries each start max_threads threads and thrash the CPU.',
        remediation: '<concurrent_threads_soft_limit_ratio_to_cores>2</concurrent_threads_soft_limit_ratio_to_cores>' });
    } else r.pass(base);
  }

  const pool = srv.get('background_pool_size');
  if (!pool) {
    r.skip({ id: 'ch-background-pool', category: 'Concurrency', title: 'Background merge pool', detail: 'system.server_settings is not readable' });
  } else {
    const v = n(pool.value);
    const base = { id: 'ch-background-pool', category: 'Concurrency' as const, title: 'Background merge pool is large enough',
      current: `${v} threads${cores ? ` on ${cores} cores` : ''}`, recommended: '≥ 8 (default 16)', reference: DOCS.serverSettings };
    if (v < 8) r.fail({ ...base, severity: 'medium', detail: 'With a small pool, merges fall behind inserts and parts pile up.', remediation: '<background_pool_size>16</background_pool_size>' });
    else r.pass(base);
  }

  // ── Data safety ──────────────────────────────────────────────────────────
  const dropT = srv.get('max_table_size_to_drop');
  const dropP = srv.get('max_partition_size_to_drop');
  if (!dropT || !dropP) {
    r.skip({ id: 'ch-drop-guard', category: 'Data safety', title: 'Accidental DROP protection', detail: 'system.server_settings is not readable' });
  } else {
    const t = n(dropT.value), p = n(dropP.value);
    const base = { id: 'ch-drop-guard', category: 'Data safety' as const, title: 'Large tables and partitions are protected from DROP',
      current: `table ${t ? formatSize(t) : 'unlimited'}, partition ${p ? formatSize(p) : 'unlimited'}`,
      recommended: 'Keep a limit (default 50 GB)', reference: DOCS.serverSettings };
    if (!t || !p) {
      r.fail({ ...base, severity: 'medium', detail: 'A single mistaken DROP TABLE or DROP PARTITION can delete any amount of data.',
        remediation: '<max_table_size_to_drop>50000000000</max_table_size_to_drop>\n<max_partition_size_to_drop>50000000000</max_partition_size_to_drop>' });
    } else r.pass(base);
  }

  if (backups === null) {
    r.skip({ id: 'ch-backups', category: 'Data safety', title: 'Recent backup', detail: 'system.backup_log is not enabled or not readable' });
  } else {
    const last = s(backups[0]?.last);
    const ok = last && !last.startsWith('1970') && Date.now() - new Date(last.replace(' ', 'T') + 'Z').getTime() < 7 * 86_400_000;
    const base = { id: 'ch-backups', category: 'Data safety' as const, title: 'A backup completed in the last 7 days',
      current: last && !last.startsWith('1970') ? `last BACKUP ${last}` : 'none recorded', recommended: 'Regular BACKUP … TO Disk/S3', reference: DOCS.backups };
    if (!ok) {
      r.fail({ ...base, severity: 'medium',
        detail: 'system.backup_log has no successful native BACKUP in the last 7 days. Backups taken with external tools (clickhouse-backup, disk snapshots) are not visible here.',
        remediation: "BACKUP DATABASE mydb TO Disk('backups', 'mydb-<date>.zip')" });
    } else r.pass(base);
  }

  // ── Merges & parts ───────────────────────────────────────────────────────
  const delay = n(mt.get('parts_to_delay_insert')?.value) || 1000;
  const thrw = n(mt.get('parts_to_throw_insert')?.value) || 3000;
  const maxParts = am.get('MaxPartCountForPartition');
  if (maxParts === undefined) {
    r.skip({ id: 'ch-parts-pressure', category: 'Merges & parts', title: 'Parts per partition', detail: 'Asynchronous metrics are not readable' });
  } else {
    const worst = (partitions ?? []).slice().sort((a, b) => n(b.max_parts_in_partition) - n(a.max_parts_in_partition))[0];
    const base = { id: 'ch-parts-pressure', category: 'Merges & parts' as const, title: 'Parts per partition are well below the insert limits',
      current: `${maxParts} parts in the worst partition${worst ? ` (${s(worst.database)}.${s(worst.table)})` : ''}`,
      recommended: `< ${Math.round(delay / 2)} (inserts slow down at ${delay}, fail at ${thrw})`, reference: 'insert-batch-size' };
    if (maxParts >= delay) {
      r.fail({ ...base, severity: 'critical', detail: 'Inserts are being delayed now and will fail with TOO_MANY_PARTS if this continues.',
        remediation: 'Batch inserts (10K–100K rows per INSERT) or enable async_insert; check that merges keep up on the Merges & mutations page.' });
    } else if (maxParts >= delay / 2) {
      r.fail({ ...base, severity: 'medium', detail: 'Parts are accumulating faster than merges remove them.',
        remediation: 'Batch inserts (10K–100K rows per INSERT) or enable async_insert.' });
    } else r.pass(base);
  }

  if (!mergeTree?.length) {
    r.skip({ id: 'ch-parts-thresholds', category: 'Merges & parts', title: 'Insert part thresholds', detail: 'system.merge_tree_settings is not readable' });
  } else {
    const raised = ['parts_to_delay_insert', 'parts_to_throw_insert', 'max_parts_in_total']
      .map(k => mt.get(k)).filter(x => x && n(x.changed) === 1);
    const base = { id: 'ch-parts-thresholds', category: 'Merges & parts' as const, title: 'Too-many-parts thresholds are at their defaults',
      current: raised.length ? raised.map(x => `${s(x!.name)}=${s(x!.value)}`).join(', ') : `delay ${delay}, throw ${thrw}`,
      recommended: 'Defaults; fix the insert pattern instead of raising them', reference: DOCS.mergeTree };
    if (raised.length) {
      r.fail({ ...base, severity: 'low', detail: 'Raising these thresholds hides too-frequent inserts and leads to slow SELECTs and long restarts.',
        remediation: 'Revert to defaults and batch inserts or use async_insert.' });
    } else r.pass(base);
  }

  if (partitions === null) {
    r.skip({ id: 'ch-partition-count', category: 'Merges & parts', title: 'Partition count per table', detail: 'system.parts is not readable' });
  } else {
    const many = partitions.filter(p => n(p.partitions) > 1000 && s(p.database) !== 'system');
    const base = { id: 'ch-partition-count', category: 'Merges & parts' as const, title: 'Tables have a reasonable number of partitions',
      current: many.length ? many.slice(0, 5).map(p => `${s(p.database)}.${s(p.table)}: ${n(p.partitions)}`).join(', ') : 'all tables ≤ 1000 partitions',
      recommended: '≤ 1000 partitions per table (low-cardinality partition key, e.g. by month)', reference: 'schema-partition-low-cardinality' };
    if (many.length) {
      r.fail({ ...base, severity: 'medium', detail: 'A high-cardinality partition key creates many small parts that never merge across partitions.',
        remediation: 'Partition by a coarse time unit such as toYYYYMM(ts), or not at all. See Table advisor for per-table detail.' });
    } else r.pass(base);
  }

  if (mutations === null) {
    r.skip({ id: 'ch-stuck-mutations', category: 'Merges & parts', title: 'Mutations complete', detail: 'system.mutations is not readable' });
  } else {
    const hour = Date.now() - 3_600_000;
    const stuck = mutations.filter(m => s(m.latest_fail_reason) || new Date(s(m.create_time).replace(' ', 'T') + 'Z').getTime() < hour);
    const base = { id: 'ch-stuck-mutations', category: 'Merges & parts' as const, title: 'No stuck or failing mutations',
      current: stuck.length ? `${stuck.length} stuck (${stuck.slice(0, 3).map(m => `${s(m.database)}.${s(m.table)}`).join(', ')})` : `${mutations.length} running, none stuck`,
      recommended: 'Mutations finish; prefer lightweight DELETE / partition drops', reference: 'insert-mutation-avoid-update' };
    if (stuck.length) {
      r.fail({ ...base, severity: 'medium', detail: 'Unfinished mutations rewrite parts in the background and block later mutations on the same table.',
        remediation: 'Inspect them on the Merges & mutations page; fix the cause or KILL MUTATION.' });
    } else r.pass(base);
  }

  if (detached === null) {
    r.skip({ id: 'ch-detached-parts', category: 'Merges & parts', title: 'Broken detached parts', detail: 'system.detached_parts is not readable' });
  } else {
    const broken = detached.filter(d => /broken|unexpected|noquorum|covered|clone/i.test(s(d.reason))).reduce((a, d) => a + n(d.c), 0);
    const base = { id: 'ch-detached-parts', category: 'Merges & parts' as const, title: 'No broken or unexpected detached parts',
      current: `${broken} broken/unexpected, ${detached.reduce((a, d) => a + n(d.c), 0)} detached in total`,
      recommended: '0', reference: DOCS.mergeTree };
    if (broken) {
      r.fail({ ...base, severity: 'medium', detail: 'ClickHouse detached parts it found damaged at startup or during replication. They use disk space and may hold data.',
        remediation: 'Review them on the Storage page; re-attach with ALTER TABLE … ATTACH PART if valid, otherwise drop them.' });
    } else r.pass(base);
  }

  // ── Inserts ──────────────────────────────────────────────────────────────
  if (smallInserts === null) {
    r.skip({ id: 'ch-small-inserts', category: 'Inserts', title: 'Insert batch size', detail: 'system.part_log is not enabled or not readable' });
  } else {
    const base = { id: 'ch-small-inserts', category: 'Inserts' as const, title: 'Inserts are batched',
      current: smallInserts.length
        ? smallInserts.slice(0, 5).map(t => `${s(t.database)}.${s(t.table)}: ${n(t.inserts)} inserts/24h, ~${n(t.avg_rows)} rows each`).join('; ')
        : 'no table receives frequent small inserts',
      recommended: '10K–100K rows per INSERT, or async_insert=1 for many small writers', reference: 'insert-batch-size' };
    if (smallInserts.length) {
      r.fail({ ...base, severity: 'medium', detail: 'Every INSERT creates a part. Many small inserts mean constant merging and a risk of TOO_MANY_PARTS.',
        remediation: 'Batch on the client, or let ClickHouse batch: SET async_insert = 1, wait_for_async_insert = 1 (insert-async-small-batches).' });
    } else r.pass(base);
  }

  const maxPart = set.get('max_partitions_per_insert_block');
  if (maxPart) {
    const v = n(maxPart.value);
    const base = { id: 'ch-partitions-per-insert', category: 'Inserts' as const, title: 'One INSERT touches few partitions',
      current: v ? String(v) : '0 (unlimited)', recommended: '100 (default)', reference: DOCS.settings };
    if (!v || v > 100) {
      r.fail({ ...base, severity: 'low', detail: 'Inserts that span many partitions create many parts at once — usually a sign of a too-fine partition key.',
        remediation: 'Keep max_partitions_per_insert_block at 100 and fix the partition key.' });
    } else r.pass(base);
  }

  // ── Schema (Table advisor) ───────────────────────────────────────────────
  if (!schema) {
    r.skip({ id: 'ch-schema', category: 'Schema', title: 'Tables follow schema best practices', detail: 'Table advisor could not read table metadata' });
  } else if (!schema.length) {
    r.pass({ id: 'ch-schema', category: 'Schema', title: 'Tables follow schema best practices', current: 'no user tables', recommended: 'grade A or B' });
  } else {
    const avg = Math.round(schema.reduce((a, t) => a + t.score, 0) / schema.length);
    const poor = schema.filter(t => t.grade === 'D' || t.grade === 'F').sort((a, b) => a.score - b.score);
    const base = { id: 'ch-schema', category: 'Schema' as const, title: 'Tables follow schema best practices',
      current: `${schema.length} tables, average score ${avg}; ${poor.length} graded D or F${poor.length ? ` (${poor.slice(0, 3).map(t => t.table).join(', ')})` : ''}`,
      recommended: 'every table graded A or B', reference: 'schema-pk-plan-before-creation' };
    if (poor.length) {
      r.fail({ ...base, severity: poor.length > 3 ? 'medium' : 'low',
        detail: 'Sort keys, partitioning and column types decide how much ClickHouse reads per query and how well data compresses.',
        remediation: 'Open Table advisor for each table to see the exact rule and the fixed DDL.' });
    } else r.pass(base);
  }

  // ── Storage ──────────────────────────────────────────────────────────────
  if (disks === null) {
    r.skip({ id: 'ch-disk-free', category: 'Storage', title: 'Free disk space', detail: 'system.disks is not readable' });
  } else {
    const local = disks.filter(d => n(d.total_space) > 0 && n(d.total_space) < 2 ** 60);
    const worst = local.map(d => ({ name: s(d.name), free: n(d.free_space) / n(d.total_space), freeBytes: n(d.free_space) }))
      .sort((a, b) => a.free - b.free)[0];
    const base = { id: 'ch-disk-free', category: 'Storage' as const, title: 'Disks have room for merges',
      current: worst ? `${worst.name}: ${Math.round(worst.free * 100)}% free (${formatSize(worst.freeBytes)})` : 'no local disks',
      recommended: '≥ 20% free (merges need space for a copy of the parts they merge)', reference: DOCS.usage };
    if (worst && worst.free < 0.1) {
      r.fail({ ...base, severity: 'critical', detail: 'Merges and inserts will start failing when the disk fills.', remediation: 'Add capacity, add TTL to drop old data, or move cold data to another volume.' });
    } else if (worst && worst.free < 0.2) {
      r.fail({ ...base, severity: 'medium', detail: 'Large merges may not find enough space.', remediation: 'Add capacity or add TTL to expire old data.' });
    } else r.pass(base);
  }

  if (parts === null) {
    r.skip({ id: 'ch-compression', category: 'Storage', title: 'Compression ratio', detail: 'system.parts is not readable' });
  } else {
    const c = n(parts[0]?.compressed), u = n(parts[0]?.uncompressed);
    const ratioC = c ? u / c : 0;
    const base = { id: 'ch-compression', category: 'Storage' as const, title: 'Data compresses well',
      current: c ? `${ratioC.toFixed(1)}× (${formatSize(u)} → ${formatSize(c)})` : 'no user data',
      recommended: '≥ 3× is typical; check types, ORDER BY and codecs if lower', reference: 'schema-types-native-types' };
    if (c > GiB && ratioC < 2) {
      r.fail({ ...base, severity: 'low', detail: 'Low compression usually means String columns that should be numbers/dates/LowCardinality, or an ORDER BY that does not group similar values.',
        remediation: 'Run Table advisor for column-level recommendations.' });
    } else r.pass(base);
  }

  // ── Replication ──────────────────────────────────────────────────────────
  if (replicas === null) {
    r.skip({ id: 'ch-replication', category: 'Replication', title: 'Replica health', detail: 'system.replicas is not readable' });
  } else if (n(replicas[0]?.tables) === 0) {
    r.fail({ id: 'ch-replication', category: 'Replication', title: 'Data is replicated', severity: 'info',
      current: 'no Replicated*MergeTree tables', recommended: 'ReplicatedMergeTree with ≥ 2 replicas for production',
      detail: 'A single copy of the data: a lost disk or host means restoring from backup.', reference: DOCS.replication,
      remediation: 'Use ReplicatedMergeTree tables with ClickHouse Keeper (3 nodes) for high availability.' });
  } else {
    const rep = replicas[0];
    const base = { id: 'ch-replication', category: 'Replication' as const, title: 'Replicas are writable and in sync',
      current: `${n(rep.tables)} replicated tables, ${n(rep.readonly)} read-only, max delay ${n(rep.max_delay)} s, min ${n(rep.min_active)}/${n(rep.max_total)} replicas active`,
      recommended: '0 read-only, delay < 300 s, all replicas active', reference: DOCS.replication };
    if (n(rep.readonly) > 0 || n(rep.expired) > 0) {
      r.fail({ ...base, severity: 'critical', detail: 'Read-only replicas reject inserts — usually lost Keeper connectivity.', remediation: 'Check Keeper on the Replication page.' });
    } else if (n(rep.max_delay) > 300 || n(rep.min_active) < n(rep.max_total)) {
      r.fail({ ...base, severity: 'medium', detail: 'A replica is behind or offline.', remediation: 'Inspect the replication queue on the Replication page.' });
    } else if (n(rep.max_total) < 2) {
      r.fail({ ...base, severity: 'low', detail: 'Tables are replicated but have only one replica.', remediation: 'Add a second replica for redundancy.' });
    } else r.pass(base);
  }

  // ── Observability ────────────────────────────────────────────────────────
  const logQueries = set.get('log_queries');
  {
    const enabled = queryLogRecent !== null && n(logQueries?.value ?? 1) === 1;
    const base = { id: 'ch-query-log', category: 'Observability' as const, title: 'Query log is enabled',
      current: queryLogRecent === null ? 'system.query_log unavailable' : `log_queries=${s(logQueries?.value ?? '?')}, ${n(queryLogRecent[0]?.c)} entries in 24h`,
      recommended: 'log_queries = 1', reference: DOCS.systemLogs };
    if (!enabled) {
      r.fail({ ...base, severity: 'medium', detail: 'Without the query log there is no way to find slow or failing queries, or to audit who ran what.',
        remediation: 'Enable <query_log> in the server config and SET log_queries = 1 in the default profile.' });
    } else r.pass(base);
  }

  if (logTables === null) {
    r.skip({ id: 'ch-system-log-ttl', category: 'Observability', title: 'System log retention', detail: 'system.tables is not readable' });
  } else {
    const has = (name: string) => logTables.some(t => s(t.name) === name);
    if (!has('part_log')) {
      r.fail({ id: 'ch-part-log', category: 'Observability', title: 'Part log is enabled', severity: 'low',
        current: 'disabled', recommended: 'enabled', reference: DOCS.systemLogs,
        detail: 'part_log records every insert, merge and mutation — needed to diagnose too-many-parts and slow merges.',
        remediation: '<part_log><database>system</database><table>part_log</table></part_log>' });
    } else {
      r.pass({ id: 'ch-part-log', category: 'Observability', title: 'Part log is enabled', current: 'enabled', recommended: 'enabled', reference: DOCS.systemLogs });
    }
    const unbounded = logTables
      .filter(t => n(t.total_bytes) > GiB && !/\bTTL\b/.test(s(t.create_table_query)))
      .sort((a, b) => n(b.total_bytes) - n(a.total_bytes));
    const base = { id: 'ch-system-log-ttl', category: 'Observability' as const, title: 'Large system log tables have a TTL',
      current: unbounded.length ? unbounded.map(t => `${s(t.name)} ${formatSize(n(t.total_bytes))}`).join(', ') : 'no system log over 1 GiB without TTL',
      recommended: 'TTL on every system log (e.g. 30 days)', reference: DOCS.systemLogs };
    if (unbounded.length) {
      r.fail({ ...base, severity: unbounded.some(t => n(t.total_bytes) > 10 * GiB) ? 'medium' : 'low',
        detail: 'System logs have no retention by default and grow until the disk is full.',
        remediation: unbounded.slice(0, 3).map(t => `<${s(t.name)}><ttl>event_date + INTERVAL 30 DAY DELETE</ttl></${s(t.name)}>`).join('\n') });
    } else r.pass(base);
  }

  // ── Query guardrails ─────────────────────────────────────────────────────
  const met = set.get('max_execution_time');
  if (met) {
    const v = n(met.value);
    const base = { id: 'ch-max-execution-time', category: 'Query guardrails' as const, title: 'Queries have a time limit',
      current: v ? `${v} s` : '0 (unlimited)', recommended: 'Set in the settings profile for interactive users', reference: DOCS.settings };
    if (!v) {
      r.fail({ ...base, severity: 'low', detail: 'A runaway query runs until someone kills it. (Measured for the connected user\'s profile.)',
        remediation: 'ALTER SETTINGS PROFILE default SETTINGS max_execution_time = 600' });
    } else r.pass(base);
  }

  const tz = s(timezone?.[0]?.tz);
  if (tz) {
    const base = { id: 'ch-timezone', category: 'Query guardrails' as const, title: 'Server time zone is UTC',
      current: tz, recommended: 'UTC', reference: DOCS.usage };
    if (!/^(UTC|Etc\/UTC|GMT|Etc\/GMT|UCT|Zulu|Universal)$/i.test(tz)) {
      r.fail({ ...base, severity: 'info', detail: 'A non-UTC server zone makes DateTime handling depend on the server and DST changes.',
        remediation: '<timezone>UTC</timezone> — convert in queries with toTimeZone() where needed.' });
    } else r.pass(base);
  }

  // ── Server warnings (ClickHouse's own self-diagnosis) ────────────────────
  if (warnings === null) {
    r.skip({ id: 'ch-server-warnings', category: 'Server warnings', title: 'Server warnings', detail: 'system.warnings is not readable' });
  } else if (!warnings.length) {
    r.pass({ id: 'ch-server-warnings', category: 'Server warnings', title: 'ClickHouse reports no warnings', current: 'none', recommended: 'none' });
  } else {
    warnings.forEach((w, i) => {
      const msg = s(w.message);
      const serious = /too many|memory|disk|readonly|obsolete|deprecated|not enough/i.test(msg);
      r.fail({ id: `ch-server-warning-${i}`, category: 'Server warnings', title: msg.split(/[.!]/)[0].slice(0, 120),
        severity: serious ? 'medium' : 'low', detail: msg, current: 'reported by system.warnings', recommended: 'resolved',
        reference: 'https://clickhouse.com/docs/operations/system-tables/warnings' });
    });
  }

  return finalizeReview(r, CONFIG_CATEGORIES, { version: meta.version, target: meta.url, engine: 'clickhouse' });
}
