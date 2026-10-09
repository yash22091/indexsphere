import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';

// Execute search queries
export async function POST(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'POST', '/_search');
  if (ctx instanceof NextResponse) return ctx;
  const client = ctx.session.client;

  try {
    const body = await request.json();
    const { index, query } = body;

    if (!index || !query) {
      return NextResponse.json(
        { error: 'Index and query are required' },
        { status: 400 }
      );
    }

    // Execute search using existing method
    const result = await client.search(encodeURIComponent(index).replace(/%2C/gi, ',').replace(/%2A/gi, '*'), query);
    
    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Search failed:', error);
    
    return NextResponse.json(
      { error: `Search failed: ${error.message}` },
      { status: 500 }
    );
  }
}

// Get search templates
export async function GET(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'GET', '/_cluster/state/metadata');
  if (ctx instanceof NextResponse) return ctx;
  const client = ctx.session.client;

  try {
    // Get stored search templates (gracefully returns empty on unsupported servers)
    const templates = await client.getSearchTemplates();
    
    return NextResponse.json(templates);

  } catch (error: any) {
    console.error('Failed to fetch search templates:', error);
    
    return NextResponse.json(
      { scripts: {} },
      { status: 200 }
    );
  }
}
