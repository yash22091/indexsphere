/**
 * GET  /api/vulnerabilities?target=search|clickhouse
 *        Detects the running version(s) from the caller's own session and
 *        returns known vulnerabilities for each distinct version.
 * GET  /api/vulnerabilities?product=elasticsearch|opensearch|clickhouse&version=x.y.z
 *        Manual lookup for any version (e.g. to vet an upgrade target).
 * POST /api/vulnerabilities { target | product+version } — same, bypassing the
 *        24h feed cache (admin only, since it hits external rate limits).
 */
import { NextRequest, NextResponse } from 'next/server';
import { AuthUser, getUserFromRequest } from '@/lib/auth';
import { getClickHouseSession, getClusterSession } from '@/lib/cluster-session';
import { assessVersion, Product } from '@/lib/vuln-intel';

const PRODUCTS: Product[] = ['elasticsearch', 'opensearch', 'clickhouse'];
const VERSION_RE = /^\d+(\.\d+){0,3}([-+][0-9A-Za-z.]{1,30})?$/;

interface Target { product: Product; version: string; nodes?: string[] }

async function detectTargets(user: AuthUser, target: string): Promise<Target[] | NextResponse> {
  if (target === 'clickhouse') {
    const ch = getClickHouseSession(user.id);
    if (!ch) return NextResponse.json({ error: 'No ClickHouse server connected' }, { status: 409 });
    return [{ product: 'clickhouse', version: ch.version.split(' ')[0] }];
  }
  const s = getClusterSession(user.id);
  if (!s) return NextResponse.json({ error: 'No Elasticsearch/OpenSearch cluster connected' }, { status: 409 });
  const info = await s.client.getClusterInfo() as { version?: { number?: string; distribution?: string } };
  const product: Product = info.version?.distribution === 'opensearch' ? 'opensearch' : 'elasticsearch';
  // Mixed-version clusters (rolling upgrades): assess every distinct node version
  let nodes: { name: string; version: string }[] = [];
  try {
    nodes = await s.client.request('/_cat/nodes?format=json&h=name,version') as { name: string; version: string }[];
  } catch { /* fall back to the root version */ }
  const versions = new Map<string, string[]>();
  for (const n of nodes) versions.set(n.version, [...(versions.get(n.version) ?? []), n.name]);
  if (!versions.size && info.version?.number) versions.set(info.version.number, []);
  return [...versions.entries()].map(([version, names]) => ({ product, version, nodes: names }));
}

async function handle(request: NextRequest, params: URLSearchParams | Record<string, unknown>, force: boolean) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (force && user.role !== 'admin') return NextResponse.json({ error: 'Admin required to force a refresh' }, { status: 403 });

  const get = (k: string) => (params instanceof URLSearchParams ? params.get(k) : (params[k] as string | undefined)) ?? null;
  const product = get('product');
  const version = get('version');
  const target = get('target');

  let targets: Target[];
  if (product || version) {
    if (!PRODUCTS.includes(product as Product)) return NextResponse.json({ error: 'product must be elasticsearch, opensearch or clickhouse' }, { status: 400 });
    if (!version || !VERSION_RE.test(version)) return NextResponse.json({ error: 'version must look like 8.10.0 or 25.12.1.649' }, { status: 400 });
    targets = [{ product: product as Product, version }];
  } else if (target === 'search' || target === 'clickhouse') {
    try {
      const t = await detectTargets(user, target);
      if (t instanceof NextResponse) return t;
      targets = t;
    } catch (err) {
      return NextResponse.json({ error: `Could not detect version: ${err instanceof Error ? err.message : err}` }, { status: 502 });
    }
  } else {
    return NextResponse.json({ error: 'Pass target=search|clickhouse, or product and version' }, { status: 400 });
  }

  const assessments = [];
  for (const t of targets) {
    const a = await assessVersion(t.product, t.version, force);
    assessments.push({ ...a, nodes: t.nodes ?? [] });
  }
  return NextResponse.json({ assessments });
}

export async function GET(request: NextRequest) {
  return handle(request, request.nextUrl.searchParams, false);
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  return handle(request, body, true);
}
