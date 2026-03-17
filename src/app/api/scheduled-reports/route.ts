/**
 * GET  /api/scheduled-reports          — list scheduled reports
 * POST /api/scheduled-reports          — create a scheduled report
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import cron from 'node-cron';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const reports = getDatabase().getScheduledReports();
  return NextResponse.json({ reports });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const body = await request.json();
  const { name, report_type, format, cron_expression, email_to, email_subject, connection_id } = body;

  if (!name || !report_type || !cron_expression || !email_to) {
    return NextResponse.json({ error: 'name, report_type, cron_expression, email_to are required' }, { status: 400 });
  }
  if (!cron.validate(cron_expression)) {
    return NextResponse.json({ error: 'Invalid cron expression' }, { status: 400 });
  }

  const recipients = Array.isArray(email_to) ? email_to : [email_to];

  const report = getDatabase().createScheduledReport({
    name, report_type,
    format: format ?? 'csv',
    cron_expression,
    email_to: JSON.stringify(recipients),
    email_subject: email_subject ?? undefined,
    connection_id: connection_id ?? undefined,
    is_active: body.is_active !== false,
    next_run: undefined,
    created_by: user.id,
  });

  return NextResponse.json({ report }, { status: 201 });
}
