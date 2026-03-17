/**
 * GET  /api/settings/email    — get SMTP config (no password)
 * PUT  /api/settings/email    — save SMTP config
 * POST /api/settings/email    — test SMTP connection
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import { testSmtpConnection } from '@/lib/mailer';

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const settings = getDatabase().getAllSettings();
  return NextResponse.json({
    smtp_host:   settings['smtp_host']   ?? '',
    smtp_port:   settings['smtp_port']   ?? '587',
    smtp_secure: settings['smtp_secure'] ?? 'false',
    smtp_user:   settings['smtp_user']   ?? '',
    smtp_from:   settings['smtp_from']   ?? '',
    // never return smtp_pass
  });
}

export async function PUT(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const body = await request.json();
  const db = getDatabase();
  const fields = ['smtp_host', 'smtp_port', 'smtp_secure', 'smtp_user', 'smtp_pass', 'smtp_from'] as const;
  for (const key of fields) {
    if (body[key] !== undefined) db.setSetting(key, String(body[key]));
  }
  return NextResponse.json({ ok: true });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  if (user.role !== 'admin') return NextResponse.json({ error: 'Admin required' }, { status: 403 });

  const result = await testSmtpConnection();
  return NextResponse.json(result);
}
