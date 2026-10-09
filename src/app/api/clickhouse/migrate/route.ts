/**
 * POST /api/clickhouse/migrate
 *   { index, database, table, naming?, analyzeCardinality?, create? }
 *
 * Reads an index mapping from the caller's Elasticsearch/OpenSearch session and
 * proposes a ClickHouse table following the best-practice rules
 * (es-to-clickhouse.ts). With create=true the DDL is run on the caller's
 * ClickHouse session, subject to the same role checks as the SQL workbench.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseSession, requireClusterAccess } from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { checkClickHouseQuery } from '@/lib/clickhouse-sql';
import { indexPath, planFromIndex, SAFE_IDENT } from '@/lib/migration-plan';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { index, database, table, naming, analyzeCardinality, create } = body as {
    index?: string; database?: string; table?: string; naming?: 'underscore' | 'dotted';
    analyzeCardinality?: boolean; create?: boolean;
  };
  if (!index || typeof index !== 'string') return NextResponse.json({ error: 'index is required' }, { status: 400 });
  if (!database || !table || !SAFE_IDENT.test(database) || !SAFE_IDENT.test(table)) {
    return NextResponse.json({ error: 'database and table must be simple identifiers (letters, digits, _)' }, { status: 400 });
  }

  const ctx = requireClusterAccess(request, 'GET', `${indexPath(index)}/_mapping`);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;

  let planned;
  try {
    planned = await planFromIndex(session.client, { index, database, table, naming, analyzeCardinality });
  } catch (err) {
    return NextResponse.json({ error: `Could not read mapping: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
  const { plan, cardinalityAnalyzed } = planned;

  let created = false;
  if (create) {
    const ch = getClickHouseSession(user.id);
    if (!ch) return NextResponse.json({ error: 'Connect to ClickHouse first', plan }, { status: 409 });
    const denied = checkClickHouseQuery(user.role, plan.ddl);
    if (denied) return NextResponse.json({ error: denied, plan }, { status: 403 });
    try {
      await ch.client.query(plan.ddl, { role: user.role });
      created = true;
      writeAuditLog(request, 'clickhouse:create-table', { target: `${database}.${table}`, requestBody: plan.ddl, statusCode: 200 });
    } catch (err) {
      const r = chErrorResponse(err);
      const data = await r.json();
      return NextResponse.json({ ...data, plan }, { status: r.status });
    }
  }

  return NextResponse.json({ plan, created, cardinalityAnalyzed });
}
