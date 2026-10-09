/**
 * GET /api/security/posture?target=search|clickhouse
 * Read-only security posture audit of the caller's connected search cluster or
 * ClickHouse server (configuration hardening + TLS + CVEs).
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getClickHouseSession, getClusterSession } from '@/lib/cluster-session';
import { auditClickHouse, auditSearchCluster } from '@/lib/posture';
import { writeAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const target = request.nextUrl.searchParams.get('target');

  try {
    if (target === 'clickhouse') {
      const ch = getClickHouseSession(user.id);
      if (!ch) return NextResponse.json({ error: 'No ClickHouse server connected' }, { status: 409 });
      const report = await auditClickHouse(ch.client, user.role, ch.version.split(' ')[0]);
      writeAuditLog(request, 'security:posture', { target: ch.url, statusCode: 200 });
      return NextResponse.json({ report });
    }
    if (target === 'search') {
      const s = getClusterSession(user.id);
      if (!s) return NextResponse.json({ error: 'No Elasticsearch/OpenSearch cluster connected' }, { status: 409 });
      const report = await auditSearchCluster(s.client, s.url);
      writeAuditLog(request, 'security:posture', { target: s.url, statusCode: 200 });
      return NextResponse.json({ report });
    }
    return NextResponse.json({ error: 'target must be search or clickhouse' }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: `Posture audit failed: ${err instanceof Error ? err.message : err}` }, { status: 502 });
  }
}
