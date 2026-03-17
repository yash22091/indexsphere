import { NextRequest, NextResponse } from 'next/server';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { getUserFromRequest } from '@/lib/auth';

// Execute search queries
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const client = getElasticsearchClient();
    
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client configured' },
        { status: 500 }
      );
    }

    const body = await request.json();
    const { index, query } = body;

    if (!index || !query) {
      return NextResponse.json(
        { error: 'Index and query are required' },
        { status: 400 }
      );
    }

    // Execute search using existing method
    const result = await client.search(index, query);
    
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
  const user = getUserFromRequest(request);
  if (!user) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  try {
    const client = getElasticsearchClient();
    
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client configured' },
        { status: 500 }
      );
    }

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
