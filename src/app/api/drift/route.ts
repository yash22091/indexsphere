/**
 * GET  /api/drift?target=search|clickhouse — snapshot timeline for the connected server
 * POST /api/drift { target }               — capture now; stored only if something changed
 * Admins and operators only; user/role/grant sections are visible to admins only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthUser, canWrite, getUserFromRequest } from '@/lib/auth';
import { getClickHouseSession, getClusterSession } from '@/lib/cluster-session';
import { captureClickHouseSnapshot, captureSearchSnapshot } from '@/lib/drift';
import { recordSnapshot } from '@/lib/drift-store';
import { getDatabase } from '@/lib/database-sqlite';
import { writeAuditLog } from '@/lib/audit';

function sessionKey(user: AuthUser, target: string): { key: string; label: string } | NextResponse {
  if (target === 'clickhouse') {
    const ch = getClickHouseSession(user.id);
    if (!ch) return NextResponse.json({ error: 'No ClickHouse server connected' }, { status: 409 });
    return { key: ch.savedConnectionId ?? `adhoc:${ch.url}`, label: ch.url };
  }
  if (target === 'search') {
    const s = getClusterSession(user.id);
    if (!s) return NextResponse.json({ error: 'No Elasticsearch/OpenSearch cluster connected' }, { status: 409 });
    return { key: s.savedConnectionId ?? `adhoc:${s.url}`, label: s.url };
  }
  return NextResponse.json({ error: 'target must be search or clickhouse' }, { status: 400 });
}

function authorize(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!canWrite(user)) return NextResponse.json({ error: 'Configuration history is available to admins and operators' }, { status: 403 });
  return user;
}

export async function GET(request: NextRequest) {
  const user = authorize(request);
  if (user instanceof NextResponse) return user;
  const k = sessionKey(user, request.nextUrl.searchParams.get('target') ?? '');
  if (k instanceof NextResponse) return k;
  return NextResponse.json({ connection: k.label, snapshots: getDatabase().listSnapshots(k.key) });
}

export async function POST(request: NextRequest) {
  const user = authorize(request);
  if (user instanceof NextResponse) return user;
  const body = await request.json().catch(() => ({}));
  const target = String(body.target ?? '');
  const k = sessionKey(user, target);
  if (k instanceof NextResponse) return k;

  try {
    const snap = target === 'clickhouse'
      ? await (async () => { const ch = getClickHouseSession(user.id)!; return captureClickHouseSnapshot(ch.client, user.role, ch.version.split(' ')[0]); })()
      : await captureSearchSnapshot(getClusterSession(user.id)!.client);
    const result = recordSnapshot(k.key, k.label, user.username, snap);
    writeAuditLog(request, 'drift:snapshot', { target: k.label, statusCode: 200, endpoint: result.changed ? `${result.changes} changes` : 'unchanged' });
    return NextResponse.json({ ...result, unreadable: snap.notes });
  } catch (err) {
    return NextResponse.json({ error: `Snapshot failed: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
}
