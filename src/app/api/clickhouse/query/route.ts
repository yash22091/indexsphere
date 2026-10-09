/**
 * POST /api/clickhouse/query { sql, database?, mode?: 'run'|'explain'|'estimate', maxRows? }
 *
 * SQL workbench. Role checks (clickhouse-sql.ts) + server-enforced readonly=2
 * for readonly users, and the agent-query-safety limits on every query:
 * max_execution_time, result row cap (break mode) and a scan cap.
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClickHouseSession } from '@/lib/cluster-session';
import { chErrorResponse, queryOwners } from '@/lib/clickhouse-api';
import { analyzeClickHouseQuery, checkClickHouseQuery } from '@/lib/clickhouse-sql';
import { writeAuditLog } from '@/lib/audit';
import { randomUUID } from 'crypto';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_SQL_CHARS = 1_000_000;
const MAX_BYTES_TO_READ = Number(process.env.CLICKHOUSE_MAX_BYTES_TO_READ ?? 20 * 1024 ** 3);
const MAX_EXECUTION_TIME = Number(process.env.CLICKHOUSE_MAX_EXECUTION_TIME ?? 60);

export async function POST(request: NextRequest) {
  const ctx = requireClickHouseSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;

  const body = await request.json().catch(() => ({}));
  const sql = typeof body.sql === 'string' ? body.sql.trim().replace(/;\s*$/, '') : '';
  if (sql.length > MAX_SQL_CHARS) {
    return NextResponse.json({ error: `Query exceeds ${MAX_SQL_CHARS} characters. Load large data with batched INSERTs from an ingestion tool.` }, { status: 413 });
  }
  const mode: 'run' | 'explain' | 'estimate' = ['explain', 'estimate'].includes(body.mode) ? body.mode : 'run';
  const maxRows = Math.min(10_000, Math.max(1, Number(body.maxRows) || 1000));

  const denied = checkClickHouseQuery(user.role, sql);
  if (denied) return NextResponse.json({ error: denied }, { status: 403 });

  const analysis = analyzeClickHouseQuery(sql);
  if (mode !== 'run' && analysis.level !== 'read') {
    return NextResponse.json({ error: 'EXPLAIN is only available for read queries' }, { status: 400 });
  }
  const finalSql = mode === 'explain' ? `EXPLAIN indexes = 1 ${sql}` : mode === 'estimate' ? `EXPLAIN ESTIMATE ${sql}` : sql;

  // The browser may choose the id (UUID) so it can cancel while the query runs
  const clientId = typeof body.clientQueryId === 'string' && UUID_RE.test(body.clientQueryId) ? body.clientQueryId : randomUUID();
  const queryId = `indexsphere-${clientId}`;
  queryOwners().set(queryId, user.id);
  const started = Date.now();
  try {
    const r = await session.client.query(finalSql, {
      role: user.role,
      queryId,
      database: typeof body.database === 'string' && body.database ? body.database : undefined,
      numeric64: false, // keep 64-bit integers exact in user results
      settings: {
        max_execution_time: MAX_EXECUTION_TIME,
        max_result_rows: maxRows,
        result_overflow_mode: 'break',
        max_bytes_to_read: MAX_BYTES_TO_READ,
        read_overflow_mode: 'throw',
      },
    });
    if (analysis.level !== 'read') {
      writeAuditLog(request, 'clickhouse:query', { target: session.url, requestBody: sql, statusCode: 200, durationMs: Date.now() - started });
    }
    return NextResponse.json({
      queryId,
      columns: r.meta,
      rows: r.data,
      rowCount: r.rows,
      truncated: r.rows >= maxRows,
      rowsBeforeLimit: r.rowsBeforeLimit ?? null,
      statistics: r.statistics ?? null,
      elapsedMs: Date.now() - started,
      statement: analysis.statement,
    });
  } catch (err) {
    if (analysis.level !== 'read') {
      writeAuditLog(request, 'clickhouse:query', { target: session.url, requestBody: sql, statusCode: 400 });
    }
    return chErrorResponse(err);
  } finally {
    queryOwners().delete(queryId);
  }
}
