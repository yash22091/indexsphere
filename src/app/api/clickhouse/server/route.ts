/** GET /api/clickhouse/server — warnings, errors, crashes, changed settings, metrics, backups, build. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, runSections, type Row } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const q = (sql: string) => session.client.query<Row>(sql, { role: user.role }).then(r => r.data);

  try {
    const { data, unavailable } = await runSections(q, {
      warnings: `SELECT message FROM system.warnings`,
      errors: `SELECT name, code, value, last_error_time, substring(last_error_message, 1, 500) AS last_error_message, remote
               FROM system.errors WHERE value > 0 ORDER BY last_error_time DESC LIMIT 200`,
      crashes: `SELECT event_time, signal, thread_id, query_id, version,
                       substring(arrayStringConcat(trace_full, '\n'), 1, 4000) AS trace
                FROM system.crash_log ORDER BY event_time DESC LIMIT 20`,
      serverSettings: `SELECT name, value, default, description FROM system.server_settings WHERE changed ORDER BY name`,
      mergeTreeSettings: `SELECT name, value, description FROM system.merge_tree_settings WHERE changed ORDER BY name`,
      metrics: `SELECT 'metric' AS kind, metric AS name, toFloat64(value) AS value, description FROM system.metrics
                UNION ALL SELECT 'event', event, toFloat64(value), description FROM system.events
                UNION ALL SELECT 'async', metric, toFloat64(value), description FROM system.asynchronous_metrics`,
      backups: `SELECT id, name, status, substring(error, 1, 500) AS error, start_time, end_time, num_files, total_size, compressed_size
                FROM system.backups ORDER BY start_time DESC LIMIT 50`,
      backupLog: `SELECT event_time, name, status, substring(error, 1, 300) AS error, total_size
                  FROM system.backup_log WHERE status IN ('BACKUP_CREATED', 'BACKUP_FAILED', 'RESTORED', 'RESTORE_FAILED')
                  ORDER BY event_time DESC LIMIT 50`,
      build: `SELECT name, value FROM system.build_options
              WHERE name IN ('VERSION_FULL', 'VERSION_DESCRIBE', 'BUILD_TYPE', 'SYSTEM', 'GIT_HASH')`,
    });
    // The connected user's effective settings, as the profile defines them
    const profile = await session.client.profileSettings([
      'max_memory_usage', 'max_execution_time', 'max_threads', 'max_rows_to_read', 'readonly', 'async_insert',
      'max_concurrent_queries_for_user', 'max_result_rows', 'log_queries', 'max_bytes_ratio_before_external_group_by',
    ], user.role).catch(() => null);
    return NextResponse.json({ ...data, profile, unavailable });
  } catch (err) {
    return chErrorResponse(err);
  }
}
