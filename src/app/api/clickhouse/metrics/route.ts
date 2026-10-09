/**
 * GET /api/clickhouse/metrics — live metrics snapshot (polled by the dashboard).
 * Also evaluates alert rules on ClickHouse metrics (ch_*), scoped to the
 * session's saved connection like the search-cluster monitoring stream.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, num } from '@/lib/clickhouse-api';
import { evaluateAlerts } from '@/lib/alert-engine';

type Row = Record<string, unknown>;

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;

  try {
    const [m] = (await session.client.query<Row>(`
      SELECT
        (SELECT value FROM system.metrics WHERE metric = 'Query') AS running_queries,
        (SELECT value FROM system.metrics WHERE metric = 'Merge') AS merges_running,
        (SELECT value FROM system.metrics WHERE metric = 'MemoryTracking') AS memory_tracked,
        (SELECT value FROM system.asynchronous_metrics WHERE metric = 'OSMemoryTotal') AS memory_total,
        (SELECT value FROM system.asynchronous_metrics WHERE metric = 'MaxPartCountForPartition') AS max_parts,
        (SELECT value FROM system.asynchronous_metrics WHERE metric = 'ReplicasMaxAbsoluteDelay') AS replica_delay,
        (SELECT value FROM system.asynchronous_metrics WHERE metric = 'LoadAverage1') AS load1
    `, { role: user.role })).data;

    // query_log may be disabled/not granted — rates are optional
    let qps = 0, insertRows = 0, failed5m = 0;
    try {
      const [l] = (await session.client.query<Row>(`
        SELECT countIf(type = 'QueryFinish' AND event_time > now() - 60) / 60 AS qps,
               sumIf(written_rows, type = 'QueryFinish' AND query_kind = 'Insert' AND event_time > now() - 60) / 60 AS insert_rows,
               countIf(type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')) AS failed
        FROM system.query_log WHERE event_time > now() - INTERVAL 5 MINUTE
          AND NOT has(databases, 'system')`, { role: user.role })).data;
      qps = num(l?.qps); insertRows = num(l?.insert_rows); failed5m = num(l?.failed);
    } catch { /* optional */ }

    const memTotal = num(m?.memory_total);
    const metrics = {
      ch_running_queries: num(m?.running_queries),
      ch_merges_running: num(m?.merges_running),
      ch_memory_bytes: num(m?.memory_tracked),
      ch_memory_percent: memTotal > 0 ? Math.round((num(m?.memory_tracked) / memTotal) * 1000) / 10 : 0,
      ch_max_parts_per_partition: num(m?.max_parts),
      ch_replica_delay_seconds: num(m?.replica_delay),
      ch_load1: num(m?.load1),
      ch_queries_per_sec: Math.round(qps * 100) / 100,
      ch_insert_rows_per_sec: Math.round(insertRows),
      ch_failed_queries_5m: failed5m,
    };

    evaluateAlerts(metrics, session.savedConnectionId).catch(console.warn);
    return NextResponse.json({ timestamp: Date.now(), ...metrics });
  } catch (err) {
    return chErrorResponse(err);
  }
}
