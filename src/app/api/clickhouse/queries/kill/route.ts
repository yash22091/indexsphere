/** POST /api/clickhouse/queries/kill { queryId } — admin only (readonly=2 does not block KILL). */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { queryId } = await request.json();
  if (typeof queryId !== 'string' || !queryId) return NextResponse.json({ error: 'queryId is required' }, { status: 400 });
  try {
    await session.client.query('KILL QUERY WHERE query_id = {id:String} ASYNC', { role: user.role, params: { id: queryId } });
    writeAuditLog(request, 'clickhouse:kill', { target: queryId, statusCode: 200 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return chErrorResponse(err);
  }
}
