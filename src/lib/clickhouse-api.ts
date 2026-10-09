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
