/** GET /api/clickhouse/databases — databases with table counts and sizes. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const includeSystem = request.nextUrl.searchParams.get('system') === '1';

  try {
    const r = await session.client.query(`
      SELECT d.name AS name, d.engine AS engine, d.comment AS comment,
             countIf(t.name != '') AS tables,
             sum(ifNull(t.total_rows, 0)) AS rows,
             sum(ifNull(t.total_bytes, 0)) AS bytes
      FROM system.databases AS d
      LEFT JOIN system.tables AS t ON t.database = d.name
      WHERE ${includeSystem ? '1' : "d.name NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')"}
      GROUP BY d.name, d.engine, d.comment
      ORDER BY bytes DESC, name`, { role: user.role });
    return NextResponse.json({ databases: r.data });
  } catch (err) {
    return chErrorResponse(err);
  }
}
