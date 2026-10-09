import { NextRequest, NextResponse } from 'next/server';
import { writeAuditLog } from '@/lib/audit';
import { requireClusterSession } from '@/lib/cluster-session';
import { isEsRequestAllowed } from '@/lib/es-permissions';

const MAX_BODY_BYTES = Number(process.env.PROXY_MAX_BODY_BYTES ?? 20 * 1024 * 1024);

function tooLarge() {
  return NextResponse.json(
    { error: `Request body exceeds ${Math.round(MAX_BODY_BYTES / 1024 / 1024)} MB (PROXY_MAX_BODY_BYTES). Split bulk requests into smaller batches.` },
    { status: 413 },
  );
}

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET');
}

export async function HEAD(request: NextRequest) {
  return handleRequest(request, 'HEAD');
}

export async function POST(request: NextRequest) {
  return handleRequest(request, 'POST');
}

export async function PUT(request: NextRequest) {
  return handleRequest(request, 'PUT');
}

export async function DELETE(request: NextRequest) {
  return handleRequest(request, 'DELETE');
}

export async function OPTIONS() {
  // Same-origin requests only — no wildcard CORS
  return new NextResponse(null, { status: 204 });
}

/**
 * Proxies a request to the caller's own active cluster session.
 * The target cluster (URL + credentials) is resolved server-side from the
 * session — nothing the browser sends can redirect the request elsewhere.
 */
async function handleRequest(request: NextRequest, method: string) {
  const ctx = requireClusterSession(request);
  if (ctx instanceof NextResponse) return ctx;
  const { user, session } = ctx;

  const url = new URL(request.url);
  const esPath = url.pathname.replace(/^\/api\/es-proxy/, '') || '/';

  if (!isEsRequestAllowed(user.role, method, esPath)) {
    writeAuditLog(request, `es:${method.toLowerCase()}:denied`, {
      endpoint: esPath,
      clusterUrl: session.url,
      statusCode: 403,
    });
    return NextResponse.json(
      { error: `Your role (${user.role}) is not allowed to perform ${method} ${esPath}` },
      { status: 403 },
    );
  }

  try {
    const baseUrl = new URL(session.url);
    const esUrl = new URL(session.url.replace(/\/+$/, '') + esPath + url.search);
    // Defence in depth: the composed URL must stay on the session's cluster
    if (esUrl.origin !== baseUrl.origin) {
      return NextResponse.json({ error: 'Invalid cluster path' }, { status: 400 });
    }

    let body: string | undefined;
    if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
      // Reject oversized bodies before buffering them (OOM protection)
      const declared = Number(request.headers.get('content-length') ?? 0);
      if (declared > MAX_BODY_BYTES) return tooLarge();
      const text = await request.text();
      if (Buffer.byteLength(text) > MAX_BODY_BYTES) return tooLarge();
      if (text) body = text;
    }

    const contentType = request.headers.get('content-type') ?? 'application/json';
    const startTime = Date.now();
    const response = await session.client.rawRequest(method, esUrl.toString(), body, contentType);

    const responseData = await response.text();

    // Audit log every proxied ES operation
    writeAuditLog(request, `es:${method.toLowerCase()}`, {
      endpoint: esPath,
      clusterUrl: session.url,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
      requestBody: body,
    });

    if (method === 'HEAD') return new NextResponse(null, { status: response.status });
    // Pass the cluster's body through as-is: no parse + re-serialize of large results
    const responseType = String(response.headers['content-type'] ?? '');
    if (responseType.includes('json')) {
      return new NextResponse(responseData, { status: response.status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
    }
    return NextResponse.json({ message: responseData }, { status: response.status });

  } catch (error: unknown) {
    console.error('Elasticsearch proxy error:', error);
    return NextResponse.json(
      { error: 'Connection failed', message: error instanceof Error ? error.message : String(error) },
      { status: 502 }
    );
  }
}
