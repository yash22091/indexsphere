/**
 * POST /api/saved-connections/[id]/test — test connectivity for a saved connection.
 * Does not change the caller's active cluster session.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  clickHouseConfigFromSavedConnection, configFromSavedConnection, getSavedConnectionForUser, openClickHouseClient, openClusterClient,
} from '@/lib/cluster-session';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const conn = getSavedConnectionForUser(id, user, 'any');
  if (conn instanceof NextResponse) return conn;

  if (conn.engine === 'clickhouse') {
    try {
      const { version } = await openClickHouseClient(clickHouseConfigFromSavedConnection(conn));
      return NextResponse.json({ ok: true, message: `ClickHouse ${version}`, cluster: { name: conn.name, serverType: 'clickhouse', version } });
    } catch (err: unknown) {
      return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' }, { status: 200 });
    }
  }

  let health: Record<string, unknown>;
  let serverType: string;
  try {
    const client = await openClusterClient(configFromSavedConnection(conn));
    health = await client.getClusterHealth();
    serverType = client.getServerType();
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    }, { status: 200 });
  }

  return NextResponse.json({
    ok: true,
    cluster: {
      name: health.cluster_name,
      status: health.status,
      nodeCount: health.number_of_nodes,
      serverType,
    },
  });
}
