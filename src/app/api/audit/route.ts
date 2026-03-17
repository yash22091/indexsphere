/**
 * GET  /api/audit             — query audit log with filters + pagination
 *   ?limit=&offset=&username=&action=&from=&to=&export=csv
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  // Only admins can view the full audit log; regular users see only their own entries
  const { searchParams } = new URL(request.url);

  const opts = {
    limit:    parseInt(searchParams.get('limit')  ?? '200', 10),
    offset:   parseInt(searchParams.get('offset') ?? '0',   10),
    username: user.role === 'admin' ? (searchParams.get('username') ?? undefined) : user.username,
    action:   searchParams.get('action') ?? undefined,
    from:     searchParams.get('from')   ?? undefined,
    to:       searchParams.get('to')     ?? undefined,
  };

  const db = getDatabase();
  const entries = db.getAuditLogs(opts);
  const total = db.countAuditLogs();

  // Export as CSV
  if (searchParams.get('export') === 'csv') {
    const header = 'id,username,action,target,method,endpoint,status_code,duration_ms,ip_address,cluster_url,created_at';
    const rows = entries.map(e =>
      [e.id, e.username, e.action, e.target, e.method, e.endpoint,
       e.status_code, e.duration_ms, e.ip_address, e.cluster_url, e.created_at]
        .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    );
    const csv = [header, ...rows].join('\n');
    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="indexsphere-audit-${Date.now()}.csv"`,
      },
    });
  }

  return NextResponse.json({ entries, total, limit: opts.limit, offset: opts.offset });
}
