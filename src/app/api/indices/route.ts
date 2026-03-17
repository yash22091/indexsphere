import { NextRequest, NextResponse } from 'next/server';
import { getElasticsearchClient } from '@/lib/elasticsearch';

export async function GET() {
  try {
    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client available. Please connect first.' },
        { status: 400 }
      );
    }

    const indices = await client.getIndices();
    return NextResponse.json(indices);
  } catch (error: any) {
    console.error('Error fetching indices:', error);
    return NextResponse.json(
      { error: `Failed to fetch indices: ${error.message}` },
      { status: 500 }
    );
  }
}
