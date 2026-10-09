/** Shared helpers for /api/clickhouse/* route handlers. */
import { NextResponse } from 'next/server';
import { ClickHouseError } from './clickhouse';
import { UnsafeUrlError } from './url-guard';

export function chErrorResponse(err: unknown, fallback = 'ClickHouse request failed'): NextResponse {
  const message = err instanceof Error ? err.message : fallback;
  if (err instanceof UnsafeUrlError) return NextResponse.json({ error: message }, { status: 400 });
  if (err instanceof ClickHouseError && err.code === 394) {
    return NextResponse.json({ error: 'Query cancelled', code: 394, cancelled: true }, { status: 400 });
  }
  if (err instanceof ClickHouseError) {
    // 4xx from ClickHouse = bad query / permissions; anything else = upstream failure
    const status = err.status && err.status >= 400 && err.status < 500 ? 400 : 502;
    return NextResponse.json({ error: message, code: err.code }, { status });
  }
  return NextResponse.json({ error: message }, { status: 502 });
}

/** Settled promise → value or null (sections of a dashboard degrade independently). */
export function settled<T>(r: PromiseSettledResult<T>): T | null {
  return r.status === 'fulfilled' ? r.value : null;
}

export const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

/** Running workbench queries → owning user, so users can cancel only their own. */
const OWNERS_KEY = '__INDEXSPHERE_CH_QUERY_OWNERS__';
export function queryOwners(): Map<string, string> {
  const g = globalThis as unknown as Record<string, Map<string, string>>;
  if (!g[OWNERS_KEY]) g[OWNERS_KEY] = new Map();
  return g[OWNERS_KEY];
}

export type Row = Record<string, unknown>;

/**
 * Run independent dashboard queries in parallel. A section that fails (table
 * missing on this version, feature not configured, privilege not granted) is
 * reported in `unavailable` instead of failing the page. If every section
 * fails, the first error is thrown so the caller returns a real error.
 */
export async function runSections<K extends string>(
  q: (sql: string) => Promise<Row[]>,
  defs: Record<K, string>,
): Promise<{ data: Record<K, Row[] | null>; unavailable: { section: K; error: string }[] }> {
  const keys = Object.keys(defs) as K[];
  const results = await Promise.allSettled(keys.map(k => q(defs[k])));
  const data = {} as Record<K, Row[] | null>;
  const unavailable: { section: K; error: string }[] = [];
  results.forEach((r, i) => {
    if (r.status === 'fulfilled') data[keys[i]] = r.value;
    else {
      data[keys[i]] = null;
      unavailable.push({ section: keys[i], error: r.reason instanceof Error ? r.reason.message.slice(0, 300) : 'failed' });
    }
  });
  if (keys.length && unavailable.length === keys.length) {
    throw (results[0] as PromiseRejectedResult).reason;
  }
  return { data, unavailable };
}

/** IndexSphere role gate for ClickHouse actions: 'write' = admin or operator, 'admin' = admin only. */
export function chRoleDenied(role: string, needs: 'write' | 'admin'): NextResponse | null {
  if (role === 'admin') return null;
  if (needs === 'write' && role === 'user') return null;
  return NextResponse.json({ error: needs === 'admin' ? 'Admin required' : 'Operator or admin role required' }, { status: 403 });
}
