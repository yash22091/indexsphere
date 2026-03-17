/**
 * PUT    /api/alerts/[id]   — update alert rule
 * DELETE /api/alerts/[id]   — delete alert rule
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  if (body.channels && Array.isArray(body.channels)) body.channels = JSON.stringify(body.channels);

  const updated = getDatabase().updateAlertRule(id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ rule: updated });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const ok = getDatabase().deleteAlertRule(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
