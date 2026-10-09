/**
 * POST   /api/clickhouse/connect — open an ad-hoc ClickHouse connection for the caller
 * GET    /api/clickhouse/connect — the caller's current ClickHouse session (no credentials)
 * DELETE /api/clickhouse/connect — drop it
 * Saved connections are activated via /api/saved-connections/[id]/connect.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  assertMayUseAdHocConnection, clearClickHouseSession, getClickHouseSession, openClickHouseClient, setClickHouseSession,
} from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const denied = assertMayUseAdHocConnection(user);
  if (denied) return denied;

  try {
    const { url, username, password, verifyTls } = await request.json();
    const { client, version } = await openClickHouseClient({ url, username, password, verifyTls: verifyTls === true });
    setClickHouseSession(user.id, client, version);
    writeAuditLog(request, 'clickhouse:connect', { target: client.getBaseUrl(), statusCode: 200 });
    return NextResponse.json({ success: true, url: client.getBaseUrl(), version });
  } catch (err) {
    return chErrorResponse(err, 'Failed to connect to ClickHouse');
  }
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const s = getClickHouseSession(user.id);
  if (!s) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    url: s.url,
    version: s.version,
    username: s.client.getUsername(),
    savedConnectionId: s.savedConnectionId ?? null,
  });
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  clearClickHouseSession(user.id);
  return NextResponse.json({ success: true });
}
