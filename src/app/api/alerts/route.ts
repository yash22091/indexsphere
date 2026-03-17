/**
 * GET  /api/alerts          — list alert rules + recent triggers
 * POST /api/alerts          — create an alert rule
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const db = getDatabase();
  const rules = db.getAlertRules();
  const triggers = db.getAlertTriggers(50);
  return NextResponse.json({ rules, triggers });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const body = await request.json();
  const { name, metric, operator, threshold, window_minutes, severity, channels, connection_id } = body;

  if (!name || !metric || !operator || threshold == null) {
    return NextResponse.json({ error: 'name, metric, operator, threshold are required' }, { status: 400 });
  }
  if (!['gt', 'gte', 'lt', 'lte'].includes(operator)) {
    return NextResponse.json({ error: 'operator must be gt|gte|lt|lte' }, { status: 400 });
  }

  const rule = getDatabase().createAlertRule({
    name, metric, operator,
    threshold: Number(threshold),
    window_minutes: window_minutes ?? 5,
    severity: severity ?? 'warning',
    channels: JSON.stringify(channels ?? []),
    connection_id: connection_id ?? undefined,
    is_active: body.is_active !== false,
  });

  return NextResponse.json({ rule }, { status: 201 });
}
