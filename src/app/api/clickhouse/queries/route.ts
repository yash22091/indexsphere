/** GET /api/clickhouse/queries?hours=24 — running, slowest, failed and heaviest query patterns. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, settled } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const hours = Math.min(168, Math.max(1, Number(request.nextUrl.searchParams.get('hours') ?? 24) || 24));
  const q = (sql: string) => session.client.query(sql, { role: user.role, params: { h: hours } }).then(r => r.data);

  try {
    const running = await q(`SELECT query_id, user, elapsed, read_rows, read_bytes, memory_usage,
                                    substring(query, 1, 2000) AS query
                             FROM system.processes ORDER BY elapsed DESC LIMIT 100`);
    const [slow, failed, patterns] = await Promise.allSettled([
      q(`SELECT event_time, query_id, user, query_duration_ms, read_rows, read_bytes, result_rows, memory_usage,
                substring(query, 1, 2000) AS query
         FROM system.query_log
         WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL {h:UInt32} HOUR AND NOT has(databases, 'system')
         ORDER BY query_duration_ms DESC LIMIT 25`),
      q(`SELECT event_time, query_id, user, exception_code, substring(exception, 1, 500) AS exception,
                substring(query, 1, 2000) AS query
         FROM system.query_log
         WHERE type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing') AND event_time > now() - INTERVAL {h:UInt32} HOUR
         ORDER BY event_time DESC LIMIT 25`),
      q(`SELECT normalized_query_hash AS hash, any(substring(query, 1, 2000)) AS example, count() AS calls,
                round(avg(query_duration_ms)) AS avg_ms, max(query_duration_ms) AS max_ms,
                sum(read_rows) AS read_rows, sum(read_bytes) AS read_bytes, round(avg(memory_usage)) AS avg_memory
         FROM system.query_log
         WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL {h:UInt32} HOUR AND NOT has(databases, 'system')
         GROUP BY hash ORDER BY read_bytes DESC LIMIT 25`),
    ]);
    return NextResponse.json({
      hours,
      running,
      slow: settled(slow) ?? [],
      failed: settled(failed) ?? [],
      patterns: settled(patterns) ?? [],
      queryLogAvailable: slow.status === 'fulfilled',
    });
  } catch (err) {
    return chErrorResponse(err);
  }
}
