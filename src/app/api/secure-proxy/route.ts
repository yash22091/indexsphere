import { NextRequest, NextResponse } from 'next/server';
import { ElasticsearchClient } from '@/lib/elasticsearch';
import { rateLimit } from '@/lib/rate-limit';
import { logger } from '@/lib/logger';

// Rate limiting
const limiter = rateLimit({
  interval: 60 * 1000, // 1 minute
  uniqueTokenPerInterval: 500, // Max 500 users per minute
});

// Simple API key validation
function validateApiKey(apiKey: string | null): boolean {
  if (!apiKey) return false;
  return apiKey === process.env.API_SECRET_KEY;
}

export async function POST(request: NextRequest) {
  try {
    const clientIp = request.headers.get('x-forwarded-for') ?? request.headers.get('x-real-ip') ?? 'anonymous';
    
    // Rate limiting
    await limiter.check(10, clientIp); // 10 requests per minute per IP

    // API Key validation
    const apiKey = request.headers.get('x-api-key');
    if (!validateApiKey(apiKey)) {
      logger.securityEvent('invalid_api_key', { ip: clientIp, apiKey: apiKey?.substring(0, 8) + '...' });
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
    }

    // Sanitize and validate request
    const { endpoint, method, body, config } = await request.json();
    
    // Validate endpoint (whitelist approach)
    const allowedEndpoints = [
      '/_cluster/health',
      '/_cluster/stats',
      '/_cluster/settings',
      '/_nodes',
      '/_cat/',
      '/_search',
      '/_template',
      '/_index_template',
      '/_component_template',
      '/_alias',
      '/_aliases',
      '/_ilm/',
      '/_snapshot',
      '/_scripts',
    ];
    
    if (!allowedEndpoints.some(allowed => endpoint.startsWith(allowed))) {
      logger.securityEvent('blocked_endpoint', { endpoint, ip: clientIp });
      return NextResponse.json({ error: 'Endpoint not allowed' }, { status: 403 });
    }

    // Create secure client (server-side only)
    const client = new ElasticsearchClient(config, false);
    const result = await client.genericRequest(method, endpoint, body);

    logger.info('Secure proxy request successful', { 
      endpoint, 
      method, 
      ip: clientIp,
      responseSize: JSON.stringify(result).length 
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof Error && error.message.includes('Rate limit')) {
      logger.securityEvent('rate_limit_exceeded', { ip: request.headers.get('x-forwarded-for') ?? 'unknown' });
      return NextResponse.json({ error: 'Rate limit exceeded' }, { status: 429 });
    }
    
    logger.error('Secure proxy error', { 
      ip: request.headers.get('x-forwarded-for') ?? 'unknown',
      error: error instanceof Error ? error.message : 'Unknown error'
    }, error as Error);
    
    return NextResponse.json(
      { error: 'Internal server error' }, 
      { status: 500 }
    );
  }
}
