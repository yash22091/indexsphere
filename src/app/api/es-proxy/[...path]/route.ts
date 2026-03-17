import { NextRequest, NextResponse } from 'next/server';
import { sslBypassFetch } from '@/lib/ssl-bypass';
import { getUserFromRequest } from '@/lib/auth';
import { writeAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET');
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

async function handleRequest(request: NextRequest, method: string) {
  // Require a valid authenticated session before proxying anything
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const esConfigHeader = request.headers.get('X-ES-Config');
    if (!esConfigHeader) {
      return NextResponse.json({ error: 'Missing Elasticsearch configuration' }, { status: 400 });
    }

    let esConfig: { url: string; auth?: { username: string; password: string }; headers?: Record<string, string> };
    try {
      esConfig = JSON.parse(esConfigHeader);
    } catch {
      return NextResponse.json({ error: 'Invalid Elasticsearch configuration' }, { status: 400 });
    }

    const { url: baseUrl, auth, headers: esHeaders } = esConfig;

    // Validate that baseUrl is an http/https URL (prevents SSRF to internal protocols)
    if (!baseUrl || !/^https?:\/\//i.test(baseUrl)) {
      return NextResponse.json({ error: 'Invalid cluster URL' }, { status: 400 });
    }

    const url = new URL(request.url);
    const esPath = url.pathname.replace('/api/es-proxy', '');
    const esUrl = `${baseUrl}${esPath}${url.search}`;

    const requestHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...esHeaders,
    };

    if (auth?.username && auth?.password) {
      const credentials = btoa(`${auth.username}:${auth.password}`);
      requestHeaders.Authorization = `Basic ${credentials}`;
    }

    const requestOptions: { method: string; headers: Record<string, string>; body?: string } = {
      method,
      headers: requestHeaders,
    };

    if (method === 'POST' || method === 'PUT') {
      const body = await request.text();
      if (body) requestOptions.body = body;
    }

    // sslBypassFetch uses a scoped https.Agent — safe for on-prem self-signed certs
    const startTime = Date.now();
    const response = await sslBypassFetch(esUrl, requestOptions);

    const responseData = await response.text();
    let jsonData;
    try {
      jsonData = JSON.parse(responseData);
    } catch {
      jsonData = { message: responseData };
    }

    // Audit log every proxied ES operation
    writeAuditLog(request, `es:${method.toLowerCase()}`, {
      endpoint: esPath,
      clusterUrl: baseUrl,
      statusCode: response.status,
      durationMs: Date.now() - startTime,
      requestBody: method === 'POST' || method === 'PUT' ? (requestOptions.body ?? undefined) : undefined,
    });

    return NextResponse.json(jsonData, { status: response.status });

  } catch (error: any) {
    console.error('Elasticsearch proxy error:', error);
    return NextResponse.json(
      { error: 'Connection failed', message: error.message },
      { status: 500 }
    );
  }
}
