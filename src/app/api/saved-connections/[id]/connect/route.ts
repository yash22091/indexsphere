/**
 * POST /api/saved-connections/[id]/connect — activate a saved connection server-side
 * Decrypts stored credentials from SQLite and registers the ES client singleton.
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
  const conn = getDatabase().getSavedConnectionById(id);
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const plainPw = conn.password_enc ? decryptValue(conn.password_enc) : undefined;
  const config: ElasticsearchConnectionConfig = {
    url: conn.url,
    type: 'elasticsearch',
    ...(conn.username && plainPw ? { auth: { username: conn.username, password: plainPw } } : {}),
  };

  const client = new ElasticsearchClient(config, false);
  try {
    await client.detectServerType();
    await client.getClusterHealth();
  } catch (err: unknown) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : 'Connection failed' });
  }

  setElasticsearchClient(client);
  getDatabase().updateSavedConnection(id, { last_connected: new Date().toISOString() });

  return NextResponse.json({ ok: true });
}
