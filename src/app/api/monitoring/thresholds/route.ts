/**
 * GET  /api/monitoring/thresholds — retrieve current threshold config
 * PUT  /api/monitoring/thresholds — save threshold config to app_settings
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';

const DEFAULTS = {
  cpu_warn: 70, cpu_crit: 90,
  heap_warn: 75, heap_crit: 90,
  gc_warn: 30, gc_crit: 60,
  unassigned_shards_warn: 1, unassigned_shards_crit: 10,
};

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const db = getDatabase();
  const stored = db.getSetting('monitoring_thresholds');
  const thresholds = stored ? { ...DEFAULTS, ...JSON.parse(stored) } : DEFAULTS;
  return NextResponse.json(thresholds);
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const body = await request.json();
  getDatabase().setSetting('monitoring_thresholds', JSON.stringify(body));
  return NextResponse.json({ ok: true, thresholds: body });
}
