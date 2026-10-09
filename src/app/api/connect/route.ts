import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import {
  openClusterClient, setClusterSession, clearClusterSession, getClusterSession, assertMayUseAdHocConnection,
} from '@/lib/cluster-session';
import { UnsafeUrlError } from '@/lib/url-guard';
import { writeAuditLog } from '@/lib/audit';
import { ElasticsearchConnectionConfig } from '@/types';

/** POST /api/connect — open an ad-hoc cluster connection for the calling user only. */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const denied = assertMayUseAdHocConnection(user);
  if (denied) return denied;

  try {
    const body = await request.json();
    const { url, type, verifyTls } = body;
    // Accept both {username,password} and {auth:{username,password}}
    const username = body.username ?? body.auth?.username;
    const password = body.password ?? body.auth?.password;

    const config: ElasticsearchConnectionConfig = {
      url,
      type: type ?? 'elasticsearch',
      verifyTls: verifyTls === true,
      ...(username && password ? { auth: { username, password } } : {}),
    };

    const client = await openClusterClient(config);
    const health = await client.getClusterHealth();
    setClusterSession(user.id, client, client.getBaseUrl());
    writeAuditLog(request, 'cluster:connect', { target: client.getBaseUrl(), statusCode: 200 });

    return NextResponse.json({
      success: true,
      message: 'Connected successfully',
      cluster: {
        name: health.cluster_name,
        status: health.status,
        nodeCount: health.number_of_nodes,
        dataNodeCount: health.number_of_data_nodes,
        serverType: client.getServerType(),
      },
    });
  } catch (connectionError: unknown) {
    const message = connectionError instanceof Error ? connectionError.message : 'Unknown error';
    const status = connectionError instanceof UnsafeUrlError ? 400 : 502;
    return NextResponse.json({ error: 'Failed to connect to cluster', details: message, message }, { status });
  }
}

/** GET /api/connect — the caller's current cluster session (no credentials). */
export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const session = getClusterSession(user.id);
  if (!session) return NextResponse.json({ connected: false });
  return NextResponse.json({
    connected: true,
    url: session.url,
    serverType: session.serverType,
    savedConnectionId: session.savedConnectionId ?? null,
  });
}

/** DELETE /api/connect — drop the caller's cluster session. */
export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  clearClusterSession(user.id);
  return NextResponse.json({ success: true });
}
