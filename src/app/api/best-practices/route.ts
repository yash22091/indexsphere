/**
 * GET /api/best-practices?target=search|clickhouse
 * Read-only review of the connected server's configuration against the
 * vendor's production recommendations (see search-config-review.ts and
 * clickhouse-config-review.ts).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getClickHouseSession, getClusterSession } from '@/lib/cluster-session';
import { collectTableFacts, scoreTable } from '@/lib/clickhouse-advisor';
import { reviewClickHouseConfig } from '@/lib/clickhouse-config-review';
import { reviewSearchConfig } from '@/lib/search-config-review';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { writeAuditLog } from '@/lib/audit';
import type { ConfigReview } from '@/lib/config-review';

// Overview cards and the full page ask for the same review: reuse it briefly.
// Keyed by user so a review never crosses accounts. ?refresh=1 bypasses it.
const TTL_MS = 60_000;
const CACHE_KEY = '__INDEXSPHERE_BEST_PRACTICES__';
const cache: Map<string, { at: number; review: Promise<ConfigReview> }> =
  ((globalThis as Record<string, unknown>)[CACHE_KEY] as Map<string, { at: number; review: Promise<ConfigReview> }>) ??
  ((globalThis as Record<string, unknown>)[CACHE_KEY] = new Map());

/** Returns the review and whether it was freshly run (only fresh runs are audited). */
function cached(key: string, refresh: boolean, run: () => Promise<ConfigReview>): [Promise<ConfigReview>, boolean] {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at > TTL_MS) cache.delete(k);
  const hit = cache.get(key);
  if (hit && !refresh) return [hit.review, false];
  const review = run();
  cache.set(key, { at: now, review });
  review.catch(() => cache.delete(key)); // never cache failures
  return [review, true];
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const target = request.nextUrl.searchParams.get('target');
  const refresh = request.nextUrl.searchParams.get('refresh') === '1';

  if (target === 'clickhouse') {
    const ch = getClickHouseSession(user.id);
    if (!ch) return NextResponse.json({ error: 'No ClickHouse server connected' }, { status: 409 });
    try {
      const [pending, fresh] = cached(`${user.id}:clickhouse:${ch.url}`, refresh, async () => {
        await ch.client.ping(); // a real error when the server is unreachable
        const schema = await collectTableFacts(ch.client, user.role)
          .then(({ facts }) => facts.map(scoreTable).map(t => ({ table: `${t.database}.${t.table}`, score: t.score, grade: t.grade })))
          .catch(() => null);
        return reviewClickHouseConfig(ch.client, user.role, { url: ch.url, version: ch.version.split(' ')[0] }, schema);
      });
      const review = await pending;
      if (fresh) writeAuditLog(request, 'best-practices:review', { target: ch.url, statusCode: 200 });
      return NextResponse.json({ review });
    } catch (err) {
      return chErrorResponse(err);
    }
  }

  if (target === 'search') {
    const s = getClusterSession(user.id);
    if (!s) return NextResponse.json({ error: 'No Elasticsearch/OpenSearch cluster connected' }, { status: 409 });
    try {
      const [pending, fresh] = cached(`${user.id}:search:${s.url}`, refresh, () => reviewSearchConfig(s.client, s.url));
      const review = await pending;
      if (fresh) writeAuditLog(request, 'best-practices:review', { target: s.url, statusCode: 200 });
      return NextResponse.json({ review });
    } catch (err) {
      return NextResponse.json({ error: `Review failed: ${err instanceof Error ? err.message : err}` }, { status: 502 });
    }
  }

  return NextResponse.json({ error: 'target must be search or clickhouse' }, { status: 400 });
}
