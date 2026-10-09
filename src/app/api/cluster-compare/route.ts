/**
 * POST /api/cluster-compare
 * Body: { connectionAId, connectionBId } — uses saved connections
 *   OR  { connectionA: {url,username,password}, connectionB: {url,username,password} }
 *
 * Returns a side-by-side diff of indices, templates, and cluster settings.
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthUser, getUserFromRequest } from '@/lib/auth';
import { ElasticsearchClient } from '@/lib/elasticsearch';
import { assertMayUseAdHocConnection, configFromSavedConnection, getSavedConnectionForUser } from '@/lib/cluster-session';
import { ElasticsearchConnectionConfig } from '@/types';

interface ConnSpec { url: string; username?: string; password?: string; verifyTls?: boolean; }

async function buildClient(config: ElasticsearchConnectionConfig): Promise<ElasticsearchClient> {
  // sslBypassFetch (inside the client) SSRF-guards the destination
  const client = new ElasticsearchClient({ ...config, url: config.url.replace(/\/+$/, '') }, false);
  await client.detectServerType();
  return client;
}

async function buildClientFromSpec(spec: ConnSpec): Promise<ElasticsearchClient> {
  return buildClient({
    url: spec.url,
    type: 'elasticsearch',
    verifyTls: spec.verifyTls === true,
    ...(spec.username && spec.password ? { auth: { username: spec.username, password: spec.password } } : {}),
  });
}

/** Only saved connections the caller's role may use (others look like "not found"). */
async function buildClientFromSavedId(id: string, user: AuthUser): Promise<ElasticsearchClient | null> {
  const conn = getSavedConnectionForUser(id, user);
  if (conn instanceof NextResponse) return null;
  return buildClient(configFromSavedConnection(conn));
}

function diffStringArrays(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[]; inBoth: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    onlyInA: a.filter(x => !setB.has(x)),
    onlyInB: b.filter(x => !setA.has(x)),
    inBoth:  a.filter(x => setB.has(x)),
  };
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const body = await request.json();
  const { connectionAId, connectionBId, connectionA, connectionB } = body;

  if ((!connectionAId && connectionA?.url) || (!connectionBId && connectionB?.url)) {
    const denied = assertMayUseAdHocConnection(user);
    if (denied) return denied;
  }

  let clientA: ElasticsearchClient | null = null;
  let clientB: ElasticsearchClient | null = null;

  try {
    if (connectionAId) clientA = await buildClientFromSavedId(connectionAId, user);
    else if (connectionA?.url) clientA = await buildClientFromSpec(connectionA);
  } catch (err: unknown) {
    return NextResponse.json({ error: `Cluster A error: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }
  try {
    if (connectionBId) clientB = await buildClientFromSavedId(connectionBId, user);
    else if (connectionB?.url) clientB = await buildClientFromSpec(connectionB);
  } catch (err: unknown) {
    return NextResponse.json({ error: `Cluster B error: ${err instanceof Error ? err.message : err}` }, { status: 400 });
  }

  if (!clientA || !clientB) return NextResponse.json({ error: 'Two cluster connections required' }, { status: 400 });

  const [
    indicesA, indicesB, templatesA, templatesB, settingsA, settingsB, healthA, healthB
  ] = await Promise.allSettled([
    clientA.fetchRemoteIndices(), clientB.fetchRemoteIndices(),
    clientA.fetchRemoteTemplates(), clientB.fetchRemoteTemplates(),
    clientA.fetchRemoteSettings(), clientB.fetchRemoteSettings(),
    clientA.getClusterHealth(), clientB.getClusterHealth(),
  ]);

  const arrA = indicesA.status === 'fulfilled' && Array.isArray(indicesA.value) ? indicesA.value as Record<string, unknown>[] : [];
  const arrB = indicesB.status === 'fulfilled' && Array.isArray(indicesB.value) ? indicesB.value as Record<string, unknown>[] : [];
  const idxNamesA = arrA.map(i => i.index as string);
  const idxNamesB = arrB.map(i => i.index as string);
  const idxDiff = diffStringArrays(idxNamesA, idxNamesB);

  // Template names
  const tmplA = templatesA.status === 'fulfilled' ? Object.keys(templatesA.value as object ?? {}) : [];
  const tmplB = templatesB.status === 'fulfilled' ? Object.keys(templatesB.value as object ?? {}) : [];
  const tmplDiff = diffStringArrays(tmplA, tmplB);

  // Index count delta
  const inBothDetails = idxDiff.inBoth.map(name => {
    const ia = arrA.find(i => i.index === name);
    const ib = arrB.find(i => i.index === name);
    const diff: Record<string, unknown> = { index: name };
    for (const field of ['health', 'status', 'pri', 'rep', 'docs.count', 'store.size']) {
      if (ia?.[field] !== ib?.[field]) diff[field] = { a: ia?.[field], b: ib?.[field] };
    }
    return diff;
  }).filter(d => Object.keys(d).length > 1);

  return NextResponse.json({
    clusterA: healthA.status === 'fulfilled' ? healthA.value : null,
    clusterB: healthB.status === 'fulfilled' ? healthB.value : null,
    indices: {
      countA: idxNamesA.length,
      countB: idxNamesB.length,
      ...idxDiff,
      differences: inBothDetails,
    },
    templates: { countA: tmplA.length, countB: tmplB.length, ...tmplDiff },
    settings: {
      a: settingsA.status === 'fulfilled' ? settingsA.value : null,
      b: settingsB.status === 'fulfilled' ? settingsB.value : null,
    },
  });
}
