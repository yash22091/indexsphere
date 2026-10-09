/**
 * POST /api/saved-connections/[id]/connect — activate a saved connection for the calling user.
 * Credentials are decrypted server-side and never sent to the browser.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import {
  clickHouseConfigFromSavedConnection, configFromSavedConnection, getSavedConnectionForUser,
  openClickHouseClient, openClusterClient, setClickHouseSession, setClusterSession,
} from '@/lib/cluster-session';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const conn = getSavedConnectionForUser(id, user, 'any');
  if (conn instanceof NextResponse) return conn;

  if (conn.engine === 'clickhouse') {
    try {
      const { client, version } = await openClickHouseClient(clickHouseConfigFromSavedConnection(conn));
      setClickHouseSession(user.id, client, version, conn.id);
      getDatabase().updateSavedConnection(id, { last_connected: new Date().toISOString() });
      writeAuditLog(request, 'clickhouse:connect', { target: `${conn.name} (${conn.url})`, statusCode: 200 });
      return NextResponse.json({ ok: true, engine: 'clickhouse', version });
    } catch (err: unknown) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' }, { status: 502 });
    }
  }

  let client;
  try {
    client = await openClusterClient(configFromSavedConnection(conn));
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' }, { status: 502 });
  }

  setClusterSession(user.id, client, client.getBaseUrl(), conn.id);
  getDatabase().updateSavedConnection(id, { last_connected: new Date().toISOString() });
  writeAuditLog(request, 'cluster:connect', { target: `${conn.name} (${conn.url})`, statusCode: 200 });

  return NextResponse.json({ ok: true, engine: client.getServerType(), serverType: client.getServerType() });
}
