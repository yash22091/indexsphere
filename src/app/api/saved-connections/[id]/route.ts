/**
 * GET    /api/saved-connections/[id]   — get one connection (role-filtered)
 * PUT    /api/saved-connections/[id]   — update connection (admin only)
 * DELETE /api/saved-connections/[id]   — delete connection (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase, SavedConnection } from '@/lib/database-sqlite';
import { clearSessionsForSavedConnection, getSavedConnectionForUser } from '@/lib/cluster-session';
import { parseOutboundUrl, UnsafeUrlError } from '@/lib/url-guard';

const VALID_ROLES = ['admin', 'user', 'readonly'];

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const { id } = await params;
  const conn = getSavedConnectionForUser(id, user, 'any');
  if (conn instanceof NextResponse) return conn;

  const { password_enc: _pw, ...safe } = conn;
  return NextResponse.json({ connection: safe });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const { id } = await params;
  const body = await request.json();

  const updates: Partial<SavedConnection> = {};
  if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
  if (body.url !== undefined) {
    try {
      updates.url = parseOutboundUrl(body.url, 'cluster').toString().replace(/\/+$/, '');
    } catch (err) {
      return NextResponse.json({ error: err instanceof UnsafeUrlError ? err.message : 'Invalid URL' }, { status: 400 });
    }
  }
  if (typeof body.username === 'string') updates.username = body.username;
  // UI sends `password`; blank means "keep the existing password"
  const newPassword = body.password ?? body.password_enc;
  if (typeof newPassword === 'string' && newPassword) updates.password_enc = newPassword;
  if (typeof body.color === 'string') updates.color = body.color;
  if (typeof body.description === 'string') updates.description = body.description;
  if (typeof body.ssl_verify === 'boolean') updates.ssl_verify = body.ssl_verify;
  if (typeof body.is_active === 'boolean') updates.is_active = body.is_active;
  if (['elasticsearch', 'opensearch', 'clickhouse'].includes(body.engine)) updates.engine = body.engine;
  if (Array.isArray(body.allowed_roles)) {
    const roles = body.allowed_roles.filter((r: unknown) => VALID_ROLES.includes(r as string));
    updates.allowed_roles = JSON.stringify(roles.length ? roles : ['admin']);
  }

  const updated = getDatabase().updateSavedConnection(id, updates);
  if (!updated) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  // Credentials, URL or role grants may have changed — force users to reconnect
  clearSessionsForSavedConnection(id);

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
  clearSessionsForSavedConnection(id);
  return NextResponse.json({ ok: true });
}
