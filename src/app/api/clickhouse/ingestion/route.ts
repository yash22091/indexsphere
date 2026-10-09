/**
 * GET /api/clickhouse/ingestion?hours=24 — insert activity per table (part_log),
 * small-insert detection (insert-batch-size), async inserts, insert errors,
 * Kafka consumers, materialized views and refreshable views.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, runSections, type Row } from '@/lib/clickhouse-api';

const USER_DBS = "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')";

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const hours = Math.min(168, Math.max(1, Number(request.nextUrl.searchParams.get('hours') ?? 24) || 24));
  const bucket = hours <= 6 ? 5 : hours <= 24 ? 30 : 180; // minutes
  const q = (sql: string) => session.client.query<Row>(sql, { role: user.role, params: { h: hours, b: bucket } }).then(r => r.data);

  try {
    const { data, unavailable } = await runSections(q, {
      // part_log.rows is aliased as total_rows: an alias named "rows" would shadow the column in avg()/countIf()
      tables: `SELECT database, table, count() AS inserts, sum(part_log.rows) AS total_rows, round(avg(part_log.rows)) AS avg_rows,
                      sum(size_in_bytes) AS bytes, countIf(part_log.rows < 1000) AS small_inserts, max(event_time) AS last_insert
               FROM system.part_log
               WHERE event_type = 'NewPart' AND event_time > now() - INTERVAL {h:UInt32} HOUR AND ${USER_DBS}
               GROUP BY database, table ORDER BY inserts DESC LIMIT 100`,
      timeline: `SELECT toStartOfInterval(event_time, INTERVAL {b:UInt32} MINUTE) AS t, count() AS inserts, sum(rows) AS rows
                 FROM system.part_log
                 WHERE event_type = 'NewPart' AND event_time > now() - INTERVAL {h:UInt32} HOUR AND ${USER_DBS}
                 GROUP BY t ORDER BY t`,
      asyncPending: `SELECT database, table, format, first_update, total_bytes FROM system.asynchronous_inserts`,
      asyncLog: `SELECT database, table, status, count() AS flushes, sum(rows) AS rows, max(event_time) AS last,
                        any(substring(exception, 1, 300)) AS exception
                 FROM system.asynchronous_insert_log
                 WHERE event_time > now() - INTERVAL {h:UInt32} HOUR
                 GROUP BY database, table, status ORDER BY flushes DESC LIMIT 100`,
      errors: `SELECT arrayStringConcat(tables, ', ') AS tables, exception_code, count() AS failures, max(event_time) AS last,
                      any(substring(exception, 1, 400)) AS exception
               FROM system.query_log
               WHERE query_kind = 'Insert' AND type IN ('ExceptionBeforeStart', 'ExceptionWhileProcessing')
                 AND event_time > now() - INTERVAL {h:UInt32} HOUR
               GROUP BY tables, exception_code ORDER BY failures DESC LIMIT 50`,
      kafka: `SELECT database, table, consumer_id, num_messages_read, last_poll_time, last_commit_time,
                     num_rebalance_revocations, is_currently_used,
                     arrayStringConcat(arraySlice(exceptions.text, -1), '') AS last_exception
              FROM system.kafka_consumers`,
      views: `SELECT database, name, substring(as_select, 1, 1000) AS as_select,
                     extract(create_table_query, '\\\\bTO\\\\s+([\`\\\\w.]+)') AS target, total_rows
              FROM system.tables WHERE engine = 'MaterializedView' AND ${USER_DBS} ORDER BY database, name LIMIT 500`,
      sources: `SELECT database, name, dependencies_database, dependencies_table FROM system.tables
                WHERE length(dependencies_table) > 0 AND ${USER_DBS} LIMIT 1000`,
      refreshes: `SELECT * FROM system.view_refreshes LIMIT 100`,
      viewErrors: `SELECT view_name, view_type, status, count() AS c, any(substring(exception, 1, 300)) AS exception
                   FROM system.query_views_log
                   WHERE event_time > now() - INTERVAL {h:UInt32} HOUR AND status != 'QueryFinish'
                   GROUP BY view_name, view_type, status ORDER BY c DESC LIMIT 50`,
    });
    // Source table → materialized views fed by it
    const feeds: Record<string, string[]> = {};
    for (const s of data.sources ?? []) {
      const dbs = (s.dependencies_database as string[]) ?? [];
      ((s.dependencies_table as string[]) ?? []).forEach((t, i) => {
        (feeds[`${dbs[i]}.${t}`] ??= []).push(`${s.database}.${s.name}`);
      });
    }
    const views = (data.views ?? []).map(v => ({
      ...v,
      sources: Object.entries(feeds).filter(([, mvs]) => mvs.includes(`${v.database}.${v.name}`)).map(([src]) => src),
    }));
    return NextResponse.json({ hours, bucketMinutes: bucket, ...data, views, sources: undefined, unavailable });
  } catch (err) {
    return chErrorResponse(err);
  }
}
