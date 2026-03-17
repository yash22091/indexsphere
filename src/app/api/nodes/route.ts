import { NextRequest, NextResponse } from 'next/server';
import { getElasticsearchClient } from '@/lib/elasticsearch';

// Get cluster nodes information
export async function GET(request: NextRequest) {
  try {
    const client = getElasticsearchClient();
    
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client configured' },
        { status: 500 }
      );
    }

    // Get nodes information
    const nodes = await client.getNodes();
    
    return NextResponse.json(nodes);

  } catch (error: any) {
    console.error('Failed to fetch nodes:', error);
    
    return NextResponse.json(
      { error: `Failed to fetch nodes: ${error.message}` },
      { status: 500 }
    );
  }
}
