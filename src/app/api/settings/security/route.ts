/**
 * GET  /api/settings/security  — returns lock status + debug pwd initialized flag
 * POST /api/settings/security  — toggle lock, regenerate debug password, activate/deactivate debug mode
 *
 * Body shapes:
 *   { action: "setLock",       enabled: boolean, password: string }   — admin + own password
 *   { action: "regenDebugPwd", password: string }                     — admin + own password; generates new pwd, prints to logs
 *   { action: "debugOn",       debugPwd: string }                     — verify debug password, returns 1-hr token
 *   { action: "debugOff" }                                           — convenience no-op
 *
 * Debug password lifecycle:
 *   - Auto-generated on first container boot and printed to stdout ONCE.
 *   - Admin can regenerate it (new password printed to logs, old one invalidated).
 *   - Never exposed via any API response — must be retrieved from container logs.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, validateRequestHmac } from '@/lib/auth';
import { getDatabase } from '@/lib/database-sqlite';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';

const LOCK_KEY      = 'security_lock_enabled';
const DEBUG_PWD_KEY = 'security_debug_password';

function jwtSecret(): string {
  return process.env.JWT_SECRET ?? 'changeme-insecure';
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const db = getDatabase();
  const lockEnabled   = db.getSetting(LOCK_KEY) === '1';
  // debugPwdSet = true means the auto-generated password exists in DB (it always should after first boot)
  const debugPwdSet   = !!(db.getSetting(DEBUG_PWD_KEY) ?? process.env.SECURITY_DEBUG_PASSWORD);

  return NextResponse.json({ lockEnabled, hasDebugPwd: debugPwdSet, debugPwdSet });
}

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request) as { userId?: string; username?: string } | null;
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  // Validate HMAC signature when lock is active (protects against Burp/proxy tampering)
  const rawBody = await request.text();
  const hmacOk = await validateRequestHmac(request, rawBody);
  if (!hmacOk) return NextResponse.json({ error: 'Request signature invalid — possible tampering detected' }, { status: 403 });

  const body = JSON.parse(rawBody) as Record<string, string>;
  const { action } = body;
  const db = getDatabase();

  // ── Toggle security lock (requires admin + own password) ──────────────────
  if (action === 'setLock') {
    const { password } = body as unknown as { enabled: string; password: string };

    // Verify the caller's own password
    const dbUser = await db.getUserByUsername(user.username ?? '');
    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const valid = await bcrypt.compare(password ?? '', dbUser.password_hash ?? '');
    if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });

    // Check admin
    if (!dbUser.role || dbUser.role !== 'admin') {
      return NextResponse.json({ error: 'Admin privileges required' }, { status: 403 });
    }

    db.setSetting(LOCK_KEY, body.enabled === 'true' ? '1' : '0');
    return NextResponse.json({ ok: true, lockEnabled: body.enabled === 'true' });
  }

  // ── Set / change debug-unlock password (admin + own password) ─────────────
  if (action === 'setDebugPwd') {
    const { newDebugPwd, password } = body as { newDebugPwd: string; password: string };
    if (!newDebugPwd || newDebugPwd.length < 8) {
      return NextResponse.json({ error: 'Debug password must be at least 8 characters' }, { status: 400 });
    }

    const dbUser = await db.getUserByUsername(user.username ?? '');
    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const valid = await bcrypt.compare(password ?? '', dbUser.password_hash ?? '');
    if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });
    if (dbUser.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    const hashed = await bcrypt.hash(newDebugPwd, 12);
    db.setSetting(DEBUG_PWD_KEY, hashed);
    return NextResponse.json({ ok: true });
  }

  // ── Regenerate debug password (admin + own password) ──────────────────────
  if (action === 'regenDebugPwd') {
    const { password } = body as { password: string };

    const dbUser = await db.getUserByUsername(user.username ?? '');
    if (!dbUser) return NextResponse.json({ error: 'User not found' }, { status: 404 });
    const valid = await bcrypt.compare(password ?? '', dbUser.password_hash ?? '');
    if (!valid) return NextResponse.json({ error: 'Incorrect password' }, { status: 403 });
    if (dbUser.role !== 'admin') return NextResponse.json({ error: 'Admin only' }, { status: 403 });

    // createDebugPassword stores the new hash and prints the plain-text to container logs
    db.createDebugPassword();
    return NextResponse.json({ ok: true, message: 'New debug password printed to container logs.' });
  }

  // ── Activate debug mode (verify debug password, return time-limited token) ─
  if (action === 'debugOn') {
    const { debugPwd } = body as { debugPwd: string };
    const storedHash  = db.getSetting(DEBUG_PWD_KEY);
    const envPwd      = process.env.SECURITY_DEBUG_PASSWORD;

    let valid = false;
    if (storedHash) {
      valid = await bcrypt.compare(debugPwd ?? '', storedHash);
    } else if (envPwd) {
      // Plain-text comparison against env var (set-and-forget initial setup)
      valid = debugPwd === envPwd;
    }

    if (!valid) {
      return NextResponse.json({ error: 'Incorrect debug password' }, { status: 403 });
    }

    // Issue a 1-hour debug token
    const debugToken = jwt.sign(
      { sub: user.username, mode: 'debug', iat: Math.floor(Date.now() / 1000) },
      jwtSecret(),
      { expiresIn: 3600 }
    );

    return NextResponse.json({ ok: true, debugToken });
  }

  // ── Deactivate debug mode (no auth needed — just a convenience endpoint) ───
  if (action === 'debugOff') {
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
