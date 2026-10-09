/**
 * POST /api/clickhouse/compare { a, b }
 *   a / b: "session" (the caller's connected ClickHouse server) or a saved ClickHouse connection id.
 *
 * Compares two ClickHouse servers: schema (CREATE TABLE statements), dictionaries,
 * changed server settings and — for admins — users, roles, grants, quotas,
 * settings profiles and row policies. Also compares row counts and sizes of
 * tables that exist on both. Reuses the configuration-drift capture/diff.
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, type AuthUser } from '@/lib/auth';
import {
  clickHouseConfigFromSavedConnection, getClickHouseSession, getSavedConnectionForUser, openClickHouseClient,
} from '@/lib/cluster-session';
import type { ClickHouseClient } from '@/lib/clickhouse';
import { captureClickHouseSnapshot, diffSnapshots, SENSITIVE_SECTIONS } from '@/lib/drift';
import { chErrorResponse } from '@/lib/clickhouse-api';
import { writeAuditLog } from '@/lib/audit';

interface Side { client: ClickHouseClient; version: string; label: string }

async function resolve(spec: unknown, user: AuthUser): Promise<Side | NextResponse> {
  if (spec === 'session') {
    const s = getClickHouseSession(user.id);
    if (!s) return NextResponse.json({ error: 'No ClickHouse server connected' }, { status: 409 });
    return { client: s.client, version: s.version, label: s.url };
  }
  if (typeof spec !== 'string' || !spec) return NextResponse.json({ error: 'Choose two servers' }, { status: 400 });
  const conn = getSavedConnectionForUser(spec, user, 'clickhouse');
  if (conn instanceof NextResponse) return conn;
  const { client, version } = await openClickHouseClient(clickHouseConfigFromSavedConnection(conn));
  return { client, version, label: conn.name };
}

async function tableStats(side: Side, user: AuthUser) {
  const r = await side.client.query<{ t: string; rows: number; bytes: number; engine: string }>(
    `SELECT concat(database, '.', name) AS t, engine, total_rows AS rows, total_bytes AS bytes FROM system.tables
     WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND NOT is_temporary`,
    { role: user.role, settings: { max_result_rows: 100_000 } },
  ).catch(() => null);
  return new Map((r?.data ?? []).map(x => [x.t, x]));
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const { a, b } = await request.json().catch(() => ({}));
  if (a === b) return NextResponse.json({ error: 'Choose two different servers' }, { status: 400 });

  try {
    const A = await resolve(a, user);
    if (A instanceof NextResponse) return A;
    const B = await resolve(b, user);
    if (B instanceof NextResponse) return B;

    const [snapA, snapB, statsA, statsB] = await Promise.all([
      captureClickHouseSnapshot(A.client, user.role, A.version),
      captureClickHouseSnapshot(B.client, user.role, B.version),
      tableStats(A, user),
      tableStats(B, user),
    ]);
    const visible = (s: typeof snapA.sections) =>
      Object.fromEntries(Object.entries(s).filter(([name]) => user.role === 'admin' || !SENSITIVE_SECTIONS.has(name)));
    const changes = diffSnapshots(visible(snapA.sections), visible(snapB.sections));

    const sizes = [...statsA.keys()].filter(t => statsB.has(t)).map(t => {
      const x = statsA.get(t)!, y = statsB.get(t)!;
      return { table: t, engine: x.engine, rowsA: Number(x.rows ?? 0), rowsB: Number(y.rows ?? 0), bytesA: Number(x.bytes ?? 0), bytesB: Number(y.bytes ?? 0) };
    }).filter(r => r.rowsA !== r.rowsB || r.bytesA !== r.bytesB);

    writeAuditLog(request, 'clickhouse:compare', { target: `${A.label} ↔ ${B.label}`, statusCode: 200 });
    return NextResponse.json({
      a: { label: A.label, version: A.version, tables: statsA.size, unreadable: snapA.notes },
      b: { label: B.label, version: B.version, tables: statsB.size, unreadable: snapB.notes },
      changes,
      sizes,
      hiddenSections: user.role === 'admin' ? [] : [...SENSITIVE_SECTIONS].filter(s => s in snapA.sections || s in snapB.sections),
    });
  } catch (err) {
    return chErrorResponse(err);
  }
}
