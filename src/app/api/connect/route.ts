import { NextRequest, NextResponse } from 'next/server';
import { ElasticsearchClient, setElasticsearchClient, clearElasticsearchClient } from '@/lib/elasticsearch';
import { getUserFromRequest } from '@/lib/auth';
import { ElasticsearchConnectionConfig } from '@/types';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  try {
    const { url, username, password, type } = await request.json();

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Validate URL is http/https (no SSRF)
    if (!/^https?:\/\//i.test(url)) {
      return NextResponse.json({ error: 'Invalid URL — must start with http:// or https://' }, { status: 400 });
    }

    const config: ElasticsearchConnectionConfig = {
      url,
      type: type ?? 'elasticsearch',
      ...(username && password ? { auth: { username, password } } : {}),
    };

    // Create our custom client (direct mode — server-side)
    // sslBypassFetch used internally bypasses self-signed certs (on-prem default)
    const client = new ElasticsearchClient(config, false);

    // Detect actual server type
    await client.detectServerType();

    // Verify connectivity by fetching cluster health
    const health = await client.getClusterHealth();

    setElasticsearchClient(client);

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

  } catch (connectionError: any) {
    console.error('Connection error:', connectionError);
    clearElasticsearchClient();
    return NextResponse.json(
      { error: 'Failed to connect to cluster', details: connectionError.message ?? 'Unknown error' },
      { status: 400 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  clearElasticsearchClient();
  return NextResponse.json({ success: true, message: 'Disconnected successfully' });
}
