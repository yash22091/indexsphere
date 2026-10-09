/**
 * PUT    /api/scheduled-reports/[id]           — update report
 * DELETE /api/scheduled-reports/[id]           — delete report
 * POST   /api/scheduled-reports/[id]/run       — run immediately
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import { runReportNow } from '@/lib/scheduler';
import cron from 'node-cron';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  if (body.cron_expression !== undefined && !cron.validate(body.cron_expression)) {
    return NextResponse.json({ error: 'Invalid cron expression' }, { status: 400 });
  }
  if (body.connection_id !== undefined) {
    const target = getDatabase().getSavedConnectionById(body.connection_id);
    if (!target || target.engine === 'clickhouse') {
      return NextResponse.json({ error: 'connection_id must reference a saved Elasticsearch/OpenSearch connection' }, { status: 400 });
    }
  }
  if (body.email_to && Array.isArray(body.email_to)) body.email_to = JSON.stringify(body.email_to);

  const updated = getDatabase().updateScheduledReport(id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ report: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const ok = getDatabase().deleteScheduledReport(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const result = await runReportNow(id);
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
