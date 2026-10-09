/**
 * GET  /api/saved-connections          — list saved connections (role-filtered)
 * POST /api/saved-connections          — create a saved connection (admin only)
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import { parseOutboundUrl, UnsafeUrlError } from '@/lib/url-guard';

const VALID_ROLES = ['admin', 'user', 'readonly'];

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
  const { name, url, username, password, color, description, allowed_roles, ssl_verify, engine } = body;

  if (!name?.trim() || !url?.trim()) {
    return NextResponse.json({ error: 'name and url are required' }, { status: 400 });
  }
  try {
    parseOutboundUrl(url, 'cluster');
  } catch (err) {
    return NextResponse.json({ error: err instanceof UnsafeUrlError ? err.message : 'Invalid URL' }, { status: 400 });
  }
  const roles = Array.isArray(allowed_roles) ? allowed_roles.filter((r: unknown) => VALID_ROLES.includes(r as string)) : ['admin'];

  const conn = getDatabase().createSavedConnection({
    name: name.trim(),
    url: url.trim(),
    username: username ?? undefined,
    password_enc: password ?? undefined,
    color: color ?? '#0ea5e9',
    description: description ?? undefined,
    allowed_roles: JSON.stringify(roles.length ? roles : ['admin']),
    ssl_verify: ssl_verify !== false,
    created_by: user.id,
    is_active: true,
    engine: ['elasticsearch', 'opensearch', 'clickhouse'].includes(engine) ? engine : 'elasticsearch',
  });

  const { password_enc: _pw, ...safe } = conn;
  return NextResponse.json({ connection: safe }, { status: 201 });
}
