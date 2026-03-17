/**
 * GET  /api/saved-connections          — list saved connections (role-filtered)
 * POST /api/saved-connections          — create a saved connection (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const connections = getDatabase().getSavedConnections(user.role);
  // Strip encrypted passwords from response
  const safe = connections.map(({ password_enc: _pw, ...c }) => c);
  return NextResponse.json({ connections: safe });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const body = await request.json();
  const { name, url, username, password, color, description, allowed_roles, ssl_verify } = body;

  if (!name?.trim() || !url?.trim()) {
    return NextResponse.json({ error: 'name and url are required' }, { status: 400 });
  }
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: 'URL must start with http:// or https://' }, { status: 400 });
  }

  const conn = getDatabase().createSavedConnection({
    name: name.trim(),
    url: url.trim(),
    username: username ?? undefined,
    password_enc: password ?? undefined,
    color: color ?? '#0ea5e9',
    description: description ?? undefined,
    allowed_roles: JSON.stringify(allowed_roles ?? ['admin']),
    ssl_verify: ssl_verify !== false,
    created_by: user.id,
    is_active: true,
  });

  const { password_enc: _pw, ...safe } = conn;
  return NextResponse.json({ connection: safe }, { status: 201 });
}
