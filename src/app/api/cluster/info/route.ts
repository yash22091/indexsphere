import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { assertMayUseAdHocConnection } from '@/lib/cluster-session';
import { ElasticsearchClient } from '@/lib/elasticsearch';

/** POST — root info (version/distribution) of an ad-hoc cluster URL being tested. */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const denied = assertMayUseAdHocConnection(user);
  if (denied) return denied;

  try {
    const { url, auth, verifyTls } = await request.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // sslBypassFetch (inside the client) SSRF-guards the destination
    const client = new ElasticsearchClient({
      url: String(url).replace(/\/+$/, ''),
      verifyTls: verifyTls === true,
      ...(auth?.username && auth?.password ? { auth: { username: auth.username, password: auth.password } } : {}),
    }, false);
    const info = await client.getClusterInfo();
    return NextResponse.json(info);

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to get cluster info', message: error.message },
      { status: 500 }
    );
  }
}
