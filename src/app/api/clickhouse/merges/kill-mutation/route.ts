/** POST /api/clickhouse/merges/kill-mutation { database, table, mutationId } — admin only. */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, chRoleDenied } from '@/lib/clickhouse-api';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const denied = chRoleDenied(user.role, 'admin');
  if (denied) return denied;

  const { database, table, mutationId } = await request.json().catch(() => ({}));
  if (![database, table, mutationId].every(v => typeof v === 'string' && v)) {
    return NextResponse.json({ error: 'database, table and mutationId are required' }, { status: 400 });
  }
  try {
    await session.client.query(
      'KILL MUTATION WHERE database = {db:String} AND table = {t:String} AND mutation_id = {m:String}',
      { role: user.role, params: { db: database, t: table, m: mutationId } },
    );
    writeAuditLog(request, 'clickhouse:kill-mutation', { target: `${database}.${table}:${mutationId}`, statusCode: 200 });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return chErrorResponse(err);
  }
}
