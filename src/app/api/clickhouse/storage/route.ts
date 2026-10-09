/** GET /api/clickhouse/storage — disks, storage policies, TTL, detached parts, dropped tables, dictionaries. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, runSections, type Row } from '@/lib/clickhouse-api';

const USER_DBS = "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')";

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const q = (sql: string) => session.client.query<Row>(sql, { role: user.role }).then(r => r.data);

  try {
    const { data, unavailable } = await runSections(q, {
      disks: `SELECT name, path, type, free_space, total_space, keep_free_space FROM system.disks ORDER BY name`,
      diskUsage: `SELECT disk_name, count() AS parts, sum(bytes_on_disk) AS bytes, uniqExact(database, table) AS tables
                  FROM system.parts WHERE active GROUP BY disk_name`,
      policies: `SELECT policy_name, volume_name, volume_priority, disks, volume_type, max_data_part_size, move_factor
                 FROM system.storage_policies ORDER BY policy_name, volume_priority`,
      tables: `SELECT database, name AS table, engine, storage_policy, total_rows, total_bytes,
                      extract(create_table_query, '\\\\bTTL\\\\s+(.+?)(?:\\\\s+SETTINGS\\\\s|$)') AS ttl,
                      extract(create_table_query, 'PARTITION BY\\\\s+(.+?)\\\\s+(?:PRIMARY KEY|ORDER BY|SAMPLE BY|TTL|SETTINGS)') AS partition_key
               FROM system.tables WHERE ${USER_DBS} AND engine LIKE '%MergeTree%'
               ORDER BY total_bytes DESC NULLS LAST LIMIT 500`,
      detached: `SELECT database, table, partition_id, name, disk, reason FROM system.detached_parts
                 ORDER BY database, table LIMIT 500`,
      dropped: `SELECT database, table, engine, table_dropped_time FROM system.dropped_tables ORDER BY table_dropped_time DESC LIMIT 100`,
      dictionaries: `SELECT database, name, status, origin, type, element_count, bytes_allocated, round(hit_rate, 3) AS hit_rate,
                            round(loading_duration, 2) AS loading_duration, last_successful_update_time,
                            substring(last_exception, 1, 500) AS last_exception
                     FROM system.dictionaries ORDER BY database, name LIMIT 500`,
    });
    return NextResponse.json({ ...data, unavailable });
  } catch (err) {
    return chErrorResponse(err);
  }
}
