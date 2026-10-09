/** GET /api/clickhouse/storage/partitions?database=&table= — partitions of one MergeTree table. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, type Row } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const database = request.nextUrl.searchParams.get('database');
  const table = request.nextUrl.searchParams.get('table');
  if (!database || !table) return NextResponse.json({ error: 'database and table are required' }, { status: 400 });

  try {
    const r = await session.client.query<Row>(
      `SELECT partition, partition_id, count() AS parts, sum(rows) AS rows, sum(bytes_on_disk) AS bytes,
              sum(data_uncompressed_bytes) AS uncompressed, min(min_time) AS min_time, max(max_time) AS max_time,
              max(modification_time) AS last_modified, groupUniqArray(disk_name) AS disks,
              min(delete_ttl_info_min) AS ttl_min, max(delete_ttl_info_max) AS ttl_max
       FROM system.parts WHERE active AND database = {db:String} AND table = {t:String}
       GROUP BY partition, partition_id ORDER BY partition_id DESC LIMIT 2000`,
      { role: user.role, params: { db: database, t: table } },
    );
    return NextResponse.json({ partitions: r.data });
  } catch (err) {
    return chErrorResponse(err);
  }
}
