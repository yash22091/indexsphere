/** GET /api/clickhouse/tables?database=… — tables with storage stats. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const database = request.nextUrl.searchParams.get('database');
  if (!database) return NextResponse.json({ error: 'database is required' }, { status: 400 });

  try {
    const r = await session.client.query(`
      SELECT t.name AS name, t.engine AS engine, t.sorting_key AS sorting_key, t.partition_key AS partition_key,
             t.comment AS comment, ifNull(t.total_rows, 0) AS rows, ifNull(t.total_bytes, 0) AS bytes,
             t.metadata_modification_time AS modified,
             ifNull(p.parts, 0) AS parts, ifNull(p.partitions, 0) AS partitions,
             ifNull(p.compressed, 0) AS compressed, ifNull(p.uncompressed, 0) AS uncompressed
      FROM system.tables AS t
      LEFT JOIN (
        SELECT table, count() AS parts, uniqExact(partition_id) AS partitions,
               sum(data_compressed_bytes) AS compressed, sum(data_uncompressed_bytes) AS uncompressed
        FROM system.parts WHERE active AND database = {db:String} GROUP BY table
      ) AS p ON p.table = t.name
      WHERE t.database = {db:String} AND NOT t.is_temporary
      ORDER BY bytes DESC, name
      LIMIT 2000`, { role: user.role, params: { db: database } });
    return NextResponse.json({ tables: r.data });
  } catch (err) {
    return chErrorResponse(err);
  }
}
