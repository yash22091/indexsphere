/**
 * Audit trail helper.
 * Called from API route handlers and the es-proxy to log every significant action.
 */
import { NextRequest } from 'next/server';
import { getDatabase, AuditLogEntry } from './database-sqlite';
import { getUserFromRequest } from './auth';

/** Extract the client's real IP from standard headers. */
function getIp(req: NextRequest): string {
  return (
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    req.headers.get('x-real-ip') ??
    'unknown'
  );
}

/**
 * Write an audit log entry.  Safe to call from any API route handler.
 * Failures are swallowed so they never break primary functionality.
 */
export function writeAuditLog(
  req: NextRequest,
  action: string,
  opts: {
    target?: string;
    endpoint?: string;
    requestBody?: string;
    statusCode?: number;
    durationMs?: number;
    clusterUrl?: string;
  } = {}
): void {
  try {
    const user = getUserFromRequest(req);
    const entry: Omit<AuditLogEntry, 'id' | 'created_at'> = {
      user_id: user?.id,
      username: user?.username,
      action,
      target: opts.target,
      method: req.method,
      endpoint: opts.endpoint ?? new URL(req.url).pathname,
      request_body: opts.requestBody,
      status_code: opts.statusCode,
      duration_ms: opts.durationMs,
      ip_address: getIp(req),
      cluster_url: opts.clusterUrl,
    };
    getDatabase().writeAuditLog(entry);
  } catch {
    // Never let audit logging break the primary request
  }
}
