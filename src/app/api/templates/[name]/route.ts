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

    const { name: templateName } = await params;
    await client.deleteIndexTemplate(templateName);
    
    return NextResponse.json({ 
      success: true, 
      message: `Template '${templateName}' deleted successfully` 
    });
  } catch (error: any) {
    console.error('Error deleting template:', error);
    return NextResponse.json(
      { error: `Failed to delete template: ${error.message}` },
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

    const { name: templateName } = await params;
    const template = await client.getIndexTemplate(templateName);
    
    return NextResponse.json(template);
  } catch (error: any) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { error: `Failed to fetch template: ${error.message}` },
      { status: 500 }
    );
  }
}
