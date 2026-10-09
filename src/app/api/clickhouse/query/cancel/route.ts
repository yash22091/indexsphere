/**
 * POST /api/clickhouse/query/cancel { clientQueryId } | { queryId }
 * Cancel your own running workbench query (admins: any).
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, queryOwners } from '@/lib/clickhouse-api';

export async function POST(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const body = await request.json().catch(() => ({}));
  const queryId = typeof body.clientQueryId === 'string' ? `indexsphere-${body.clientQueryId}` : body.queryId;
  if (typeof queryId !== 'string' || !queryId) return NextResponse.json({ error: 'queryId is required' }, { status: 400 });

  if (user.role !== 'admin' && queryOwners().get(queryId) !== user.id) {
    return NextResponse.json({ error: 'You can only cancel your own queries' }, { status: 403 });
  }
  try {
    // KILL runs without the readonly setting: it is authorized above, not by ClickHouse's readonly mode
    await session.client.query('KILL QUERY WHERE query_id = {id:String} ASYNC', { params: { id: queryId } });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return chErrorResponse(err);
  }
}
