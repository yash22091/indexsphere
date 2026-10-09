import jwt from 'jsonwebtoken';
import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/config';
import { BOOT_NONCE } from '@/lib/boot-session';
import { getDatabase } from '@/lib/database-sqlite';

export type UserRole = 'admin' | 'user' | 'readonly';

export interface AuthUser {
  id: string;
  username: string;
  role: UserRole;
  permissions: string[];
}

export function permissionsForRole(role: UserRole): string[] {
  if (role === 'admin') return ['admin', 'user', 'readonly'];
  if (role === 'user') return ['user', 'readonly'];
  return ['readonly'];
}

interface VerifyOptions {
  /** Accept tokens whose user still has to change the default password (only /api/auth/*). */
  allowPendingPasswordChange?: boolean;
}

/**
 * Verify a session JWT. Beyond the signature this enforces:
 *   • the token was issued by the current process boot (restart = logout)
 *   • the user still exists and is active (deleted/disabled users lose access immediately)
 *   • role/permissions come from the database, not the token (demotions apply immediately)
 *   • a pending forced password change blocks everything except /api/auth/*
 */
export function verifyToken(token: string, options: VerifyOptions = {}): AuthUser | null {
  try {
    const config = getConfig();
    const decoded = jwt.verify(token, config.security.jwtSecret) as Record<string, unknown>;
    if (decoded.bid !== BOOT_NONCE) return null;

    const userId = (decoded.userId ?? decoded.id) as string | undefined;
    if (!userId) return null;

    const state = getDatabase().getUserAuthState(userId);
    if (!state || !state.is_active) return null;
    if (state.must_change_password && !options.allowPendingPasswordChange) return null;

    return {
      id: userId,
      username: state.username,
      role: state.role,
      permissions: permissionsForRole(state.role),
    };
  } catch {
    return null;
  }
}

function tokenFromRequest(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7);
  return request.cookies.get('auth-token')?.value ?? null;
}

export function getUserFromRequest(request: NextRequest): AuthUser | null {
  try {
    const token = tokenFromRequest(request);
    if (!token) return null;
    const allowPendingPasswordChange = request.nextUrl.pathname.startsWith('/api/auth/');
    return verifyToken(token, { allowPendingPasswordChange });
  } catch {
    return null;
  }
}

/** Throws a 401 NextResponse if the request has no valid session. */
export function requireAuth(request: NextRequest): AuthUser {
  const user = getUserFromRequest(request);
  if (!user) {
    throw NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  return user;
}

/** True for roles allowed to change cluster or application state (admin, user). */
export function canWrite(user: AuthUser): boolean {
  return user.permissions.includes('user');
}

/** Throws 401/403 unless the user may perform write operations (not readonly). */
export function requireWriter(request: NextRequest): AuthUser {
  const user = requireAuth(request);
  if (!canWrite(user)) {
    throw NextResponse.json({ error: 'Read-only users cannot perform this action' }, { status: 403 });
  }
  return user;
}

/**
 * Throws a 401/403 NextResponse if the request is not authenticated or the
 * authenticated user does not have the 'admin' permission.
 */
export function requireAdmin(request: NextRequest): AuthUser {
  const user = requireAuth(request);
  if (!user.permissions.includes('admin')) {
    throw NextResponse.json({ error: 'Admin permissions required' }, { status: 403 });
  }
  return user;
}

/**
 * Extract the per-session HMAC signing key (`sigK`) embedded in the JWT.
 * Returns null if there is no valid JWT or no sigK claim.
 */
export function getSigningKeyFromRequest(request: NextRequest): string | null {
  try {
    const cookie = request.cookies.get('auth-token')?.value;
    const header = request.headers.get('authorization')?.replace(/^Bearer /, '');
    const raw = cookie ?? header;
    if (!raw) return null;
    const config = getConfig();
    const decoded = jwt.verify(raw, config.security.jwtSecret) as Record<string, unknown>;
    return typeof decoded.sigK === 'string' ? decoded.sigK : null;
  } catch {
    return null;
  }
}

/**
 * Validate the HMAC-SHA256 tamper-detection signature attached by the browser
 * client (security-guardian.ts → secureFetch).
 *
 * Header contract:
 *   X-Req-Ts  : unix timestamp in ms at the time of the request
 *   X-Req-Sig : HMAC-SHA256( "<ts>:<METHOD>:<pathname>:<bodyHash>", sigK )
 *
 * Returns true when:
 *   • No X-Req-Sig header is present (request was sent without signing — allowed
 *     when lock is off, or for unauthenticated endpoints).
 *   • The signature is valid and the timestamp is within the 60-second window.
 *
 * Returns false (= reject the request) when:
 *   • A signature header IS present but the HMAC doesn't match (tampered payload).
 *   • The timestamp is older than 60 seconds (replay protection).
 */
export async function validateRequestHmac(
  request: NextRequest,
  rawBody: string,
): Promise<boolean> {
  const ts  = request.headers.get('X-Req-Ts');
  const sig = request.headers.get('X-Req-Sig');

  // No signature → not a signed request; allow through unchanged.
  if (!ts || !sig) return true;

  // Timestamp freshness check (60-second window, reject replays)
  const ageMs = Date.now() - Number(ts);
  if (isNaN(ageMs) || ageMs < 0 || ageMs > 60_000) return false;

  const sigKey = getSigningKeyFromRequest(request);
  if (!sigKey) return false;

  // Recompute the expected signature server-side
  const url      = new URL(request.url);
  const method   = request.method.toUpperCase();
  const pathname = url.pathname;
  const bodyHash = await sha256hex(rawBody);
  const payload  = `${ts}:${method}:${pathname}:${bodyHash}`;
  const expected = await hmacSha256hex(payload, sigKey);

  // Constant-time comparison
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// ── crypto helpers (mirror of the client-side ones in security-guardian.ts) ──

async function sha256hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256hex(message: string, key: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

