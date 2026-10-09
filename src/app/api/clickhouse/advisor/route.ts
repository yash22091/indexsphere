/**
 * GET  /api/clickhouse/advisor?database=…        — grade every table (system tables only)
 * POST /api/clickhouse/advisor { database, table } — deep analysis of one table (sampled stats)
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { collectDeepStats, collectTableFacts, scoreTable } from '@/lib/clickhouse-advisor';

export async function GET(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const database = request.nextUrl.searchParams.get('database') || undefined;

  try {
    const { facts, warnings } = await collectTableFacts(session.client, user.role, database);
    const scores = facts.map(scoreTable).sort((a, b) => a.score - b.score);
    return NextResponse.json({ scores, warnings });
  } catch (err) {
    return chErrorResponse(err);
  }
}

export async function POST(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;
  const { database, table } = await request.json().catch(() => ({}));
  if (typeof database !== 'string' || typeof table !== 'string') {
    return NextResponse.json({ error: 'database and table are required' }, { status: 400 });
  }

  try {
    const { facts, warnings } = await collectTableFacts(session.client, user.role, database);
    const f = facts.find(x => x.table === table);
    if (!f) return NextResponse.json({ error: 'Table not found' }, { status: 404 });
    f.deep = await collectDeepStats(session.client, user.role, f);
    return NextResponse.json({ score: scoreTable(f), deep: f.deep, warnings });
  } catch (err) {
    return chErrorResponse(err);
  }
}
