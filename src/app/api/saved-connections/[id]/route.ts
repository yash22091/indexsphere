/**
 * GET    /api/saved-connections/[id]   — get one connection
 * PUT    /api/saved-connections/[id]   — update connection (admin only)
 * DELETE /api/saved-connections/[id]   — delete connection (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase, decryptValue } from '@/lib/database-sqlite';

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const conn = getDatabase().getSavedConnectionById(id);
  if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { password_enc: _pw, ...safe } = conn;
  return NextResponse.json({ connection: safe });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();
  if (body.url && !/^https?:\/\//i.test(body.url)) {
    return NextResponse.json({ error: 'URL must start with http:// or https://' }, { status: 400 });
  }
  if (body.allowed_roles && Array.isArray(body.allowed_roles)) {
    body.allowed_roles = JSON.stringify(body.allowed_roles);
  }

  const updated = getDatabase().updateSavedConnection(id, body);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { password_enc: _pw, ...safe } = updated;
  return NextResponse.json({ connection: safe });
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const ok = getDatabase().deleteSavedConnection(id);
  if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true });
}
