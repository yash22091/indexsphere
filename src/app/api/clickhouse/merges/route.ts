/** GET /api/clickhouse/merges — running merges, mutations, parts pressure, moves and merge history. */
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
      merges: `SELECT database, table, round(elapsed, 1) AS elapsed, round(progress, 4) AS progress, num_parts,
                      result_part_name, total_size_bytes_compressed, rows_read, rows_written, memory_usage,
                      is_mutation, merge_type, merge_algorithm
               FROM system.merges ORDER BY elapsed DESC LIMIT 200`,
      mutations: `SELECT database, table, mutation_id, substring(command, 1, 1000) AS command, create_time,
                         parts_to_do, is_done, latest_failed_part, latest_fail_time,
                         substring(latest_fail_reason, 1, 1000) AS latest_fail_reason
                  FROM system.mutations
                  WHERE NOT is_done OR create_time > now() - INTERVAL 7 DAY
                  ORDER BY is_done, create_time DESC LIMIT 200`,
      partitions: `SELECT database, table, partition, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS bytes
                   FROM system.parts WHERE active
                   GROUP BY database, table, partition ORDER BY parts DESC LIMIT 50`,
      thresholds: `SELECT name, value FROM system.merge_tree_settings
                   WHERE name IN ('parts_to_delay_insert', 'parts_to_throw_insert', 'max_parts_in_total')`,
      moves: `SELECT database, table, round(elapsed, 1) AS elapsed, target_disk_name, part_name, part_size
              FROM system.moves`,
      history: `SELECT database, table,
                       countIf(event_type = 'MergeParts') AS merges,
                       countIf(event_type = 'MutatePart') AS mutations,
                       round(avgIf(duration_ms, event_type = 'MergeParts')) AS avg_merge_ms,
                       maxIf(duration_ms, event_type = 'MergeParts') AS max_merge_ms,
                       sumIf(size_in_bytes, event_type = 'MergeParts') AS merged_bytes,
                       countIf(error != 0) AS errors
                FROM system.part_log
                WHERE event_time > now() - INTERVAL 24 HOUR AND event_type IN ('MergeParts', 'MutatePart')
                GROUP BY database, table ORDER BY merges DESC LIMIT 50`,
    });
    return NextResponse.json({ ...data, unavailable });
  } catch (err) {
    return chErrorResponse(err);
  }
}
