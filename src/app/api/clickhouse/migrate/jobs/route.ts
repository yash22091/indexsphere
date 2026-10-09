/**
 * GET  /api/clickhouse/migrate/jobs — migration jobs (own jobs; admins see all)
 * POST /api/clickhouse/migrate/jobs { index, database, table, naming?, analyzeCardinality?,
 *                                     createTable?, insertBatch?, maxDocs? }
 *   Plans the table from the live mapping, optionally creates it, then copies the
 *   documents into ClickHouse in the background. Requires a role that may write.
 */
import { NextRequest, NextResponse } from 'next/server';
import { canWrite, getUserFromRequest } from '@/lib/auth';
import { getClickHouseSession, requireClusterAccess } from '@/lib/cluster-session';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { checkClickHouseQuery } from '@/lib/clickhouse-sql';
import { indexPath, planFromIndex, SAFE_IDENT } from '@/lib/migration-plan';
import { startMigrationJob } from '@/lib/migration-runner';
import { getDatabase } from '@/lib/database-sqlite';
import { writeAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const jobs = getDatabase().listMigrationJobs(user.role === 'admin' ? undefined : user.id);
  return NextResponse.json({ jobs: jobs.map(j => ({ ...j, result: j.result ? JSON.parse(j.result) : null })) });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (!canWrite(user)) return NextResponse.json({ error: 'Read-only users cannot copy data' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const { index, database, table, naming, analyzeCardinality, createTable } = body;
  const insertBatch = Math.min(100_000, Math.max(1_000, Number(body.insertBatch) || 20_000));
  const maxDocs = body.maxDocs ? Math.max(1, Number(body.maxDocs)) : undefined;
  if (!index || typeof index !== 'string') return NextResponse.json({ error: 'index is required' }, { status: 400 });
  if (!database || !table || !SAFE_IDENT.test(database) || !SAFE_IDENT.test(table)) {
    return NextResponse.json({ error: 'database and table must be simple identifiers (letters, digits, _)' }, { status: 400 });
  }

  // Source: read access to the index; target: an INSERT the role may run
  const ctx = requireClusterAccess(request, 'POST', `${indexPath(index)}/_search`);
  if (ctx instanceof NextResponse) return ctx;
  const ch = getClickHouseSession(user.id);
  if (!ch) return NextResponse.json({ error: 'Connect to ClickHouse first' }, { status: 409 });
  const insertCheck = checkClickHouseQuery(user.role, `INSERT INTO \`${database}\`.\`${table}\` FORMAT JSONEachRow`);
  if (insertCheck) return NextResponse.json({ error: insertCheck }, { status: 403 });

  let plan;
  try {
    ({ plan } = await planFromIndex(ctx.session.client, { index, database, table, naming, analyzeCardinality }));
  } catch (err) {
    return NextResponse.json({ error: `Could not read mapping: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }

  try {
    if (createTable) {
      const ddl = plan.ddl.replace(/^CREATE TABLE /, 'CREATE TABLE IF NOT EXISTS ');
      const denied = checkClickHouseQuery(user.role, ddl);
      if (denied) return NextResponse.json({ error: denied }, { status: 403 });
      await ch.client.query(ddl, { role: user.role });
    }
    // Fail fast if the target table doesn't exist
    await ch.client.query('SELECT 1 FROM {db:Identifier}.{t:Identifier} LIMIT 0', { params: { db: database, t: table }, role: user.role });
  } catch (err) {
    return chErrorResponse(err);
  }

  const job = startMigrationJob({
    userId: user.id, role: user.role, es: ctx.session.client, ch: ch.client,
    index, database, table, columns: plan.columns, insertBatch, maxDocs,
  });
  writeAuditLog(request, 'clickhouse:migrate', { target: `${index} -> ${database}.${table}`, statusCode: 202 });
  return NextResponse.json({ job, plan }, { status: 202 });
}
