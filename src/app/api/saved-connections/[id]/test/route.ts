/**
 * POST /api/saved-connections/[id]/test — test connectivity for a saved connection
 * POST /api/saved-connections/[id]/connect — activate this saved connection
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase, decryptValue } from '@/lib/database-sqlite';
import { ElasticsearchClient, setElasticsearchClient } from '@/lib/elasticsearch';
import { ElasticsearchConnectionConfig } from '@/types';

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const url = new URL(request.url);
  const action = url.pathname.split('/').pop(); // 'test' or 'connect'

  const conn = getDatabase().getSavedConnectionById(id);
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const plainPw = conn.password_enc ? decryptValue(conn.password_enc) : undefined;
  const config: ElasticsearchConnectionConfig = {
    url: conn.url,
    type: 'elasticsearch',
    ...(conn.username && plainPw ? { auth: { username: conn.username, password: plainPw } } : {}),
  };

  const client = new ElasticsearchClient(config, false);
  let health: Record<string, unknown>;
  try {
    await client.detectServerType();
    health = await client.getClusterHealth();
  } catch (err: unknown) {
    return NextResponse.json({
      ok: false,
      error: err instanceof Error ? err.message : 'Connection failed',
    }, { status: 200 });
  }

  if (action === 'connect') {
    setElasticsearchClient(client);
    getDatabase().updateSavedConnection(id, { last_connected: new Date().toISOString() });
  }

  return NextResponse.json({
    ok: true,
    cluster: {
      name: health.cluster_name,
      status: health.status,
      nodeCount: health.number_of_nodes,
      serverType: client.getServerType(),
    },
  });
}
