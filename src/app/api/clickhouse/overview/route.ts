/** GET /api/clickhouse/overview — server summary, storage, activity, replication, disks. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, num, settled } from '@/lib/clickhouse-api';

type Row = Record<string, unknown>;
const USER_DBS = "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')";

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const q = (sql: string) => session.client.query<Row>(sql, { role: user.role }).then(r => r.data);

  try {
    const server = (await q(`SELECT version() AS version, uptime() AS uptime, hostName() AS host,
      timezone() AS timezone, currentUser() AS user`))[0];

    const results = await Promise.allSettled([
      q(`SELECT count() AS parts, uniqExact(database, table) AS tables, sum(rows) AS rows,
                sum(bytes_on_disk) AS bytes_on_disk, sum(data_compressed_bytes) AS compressed,
                sum(data_uncompressed_bytes) AS uncompressed
         FROM system.parts WHERE active AND ${USER_DBS}`),
      q(`SELECT count() AS databases FROM system.databases WHERE name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')`),
      q(`SELECT (SELECT count() FROM system.processes) AS running_queries,
                (SELECT count() FROM system.merges) AS merges,
                (SELECT count() FROM system.mutations WHERE NOT is_done) AS pending_mutations`),
      q(`SELECT metric, value FROM system.asynchronous_metrics
         WHERE metric IN ('OSMemoryTotal', 'OSMemoryAvailable', 'LoadAverage1', 'MaxPartCountForPartition',
                          'ReplicasMaxAbsoluteDelay', 'NumberOfTables', 'OSUptime')`),
      q(`SELECT metric, value FROM system.metrics WHERE metric IN ('MemoryTracking', 'Query', 'Merge', 'TCPConnection', 'HTTPConnection')`),
      q(`SELECT name, path, free_space, total_space, type FROM system.disks`),
      q(`SELECT count() AS replicas, countIf(is_readonly) AS readonly_replicas, countIf(is_session_expired) AS expired,
                max(absolute_delay) AS max_delay, sum(queue_size) AS queue
         FROM system.replicas`),
      q(`SELECT database, name, engine, total_rows, total_bytes FROM system.tables
         WHERE ${USER_DBS} AND total_bytes IS NOT NULL ORDER BY total_bytes DESC LIMIT 10`),
      q(`SELECT countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed,
                countIf(type = 'QueryFinish') AS finished,
                quantileIf(0.95)(query_duration_ms, type = 'QueryFinish') AS p95_ms
         FROM system.query_log WHERE event_time > now() - INTERVAL 1 HOUR`),
      q(`SELECT name, code, value, last_error_time, last_error_message FROM system.errors
         WHERE last_error_time > now() - INTERVAL 1 DAY ORDER BY last_error_time DESC LIMIT 10`),
    ]);

    const [storage, dbs, activity, asyncM, metrics, disks, replicas, topTables, qlog, errors] = results.map(settled);
    const kv = (rows: Row[] | null) => Object.fromEntries((rows ?? []).map(r => [String(r.metric), num(r.value)]));
    const am = kv(asyncM);
    const m = kv(metrics);

    return NextResponse.json({
      connection: { url: session.url, savedConnectionId: session.savedConnectionId ?? null },
      server,
      storage: storage?.[0] ?? null,
      databases: num(dbs?.[0]?.databases),
      activity: activity?.[0] ?? null,
      memory: {
        tracked: m.MemoryTracking ?? null,
        total: am.OSMemoryTotal ?? null,
        available: am.OSMemoryAvailable ?? null,
      },
      load1: am.LoadAverage1 ?? null,
      maxPartsPerPartition: am.MaxPartCountForPartition ?? null,
      connections: { tcp: m.TCPConnection ?? null, http: m.HTTPConnection ?? null },
      disks: disks ?? [],
      replication: replicas?.[0] && num(replicas[0].replicas) > 0 ? replicas[0] : null,
      topTables: topTables ?? [],
      queries1h: qlog?.[0] ?? null,
      recentErrors: errors ?? [],
      unavailable: results.map((r, i) => (r.status === 'rejected'
        ? ['storage', 'databases', 'activity', 'async_metrics', 'metrics', 'disks', 'replicas', 'top_tables', 'query_log', 'errors'][i]
        : null)).filter(Boolean),
    });
  } catch (err) {
    return chErrorResponse(err);
  }
}
