import { NextRequest, NextResponse } from 'next/server';
import { getElasticsearchClient } from '@/lib/elasticsearch';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client available. Please connect first.' },
        { status: 400 }
      );
    }

    const { name: indexName } = await params;
    await client.deleteIndex(indexName);
    
    return NextResponse.json({ 
      success: true, 
      message: `Index '${indexName}' deleted successfully` 
    });
  } catch (error: any) {
    console.error('Error deleting index:', error);
    return NextResponse.json(
      { error: `Failed to delete index: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client available. Please connect first.' },
        { status: 400 }
      );
    }

    const { name: indexName } = await params;
    const indexData = await client.getIndex(indexName);
    
    return NextResponse.json(indexData);
  } catch (error: any) {
    console.error('Error fetching index:', error);
    return NextResponse.json(
      { error: `Failed to fetch index: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client available. Please connect first.' },
        { status: 400 }
      );
    }

    const { name: indexName } = await params;
    const body = await request.json();
    
    await client.createIndex(indexName, body);
    
    return NextResponse.json({ 
      success: true, 
      message: `Index '${indexName}' created successfully` 
    });
  } catch (error: any) {
    console.error('Error creating index:', error);
    return NextResponse.json(
      { error: `Failed to create index: ${error.message}` },
      { status: 500 }
    );
  }
}
