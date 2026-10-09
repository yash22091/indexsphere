import { NextResponse } from 'next/server';

// Liveness probe for Docker/NGINX/monitoring. Public, so it deliberately exposes
// nothing about the process or any connected cluster (cluster connections are
// per-user sessions — see /api/connect for the caller's own connection state).
export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}
