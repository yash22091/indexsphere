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

    const templates = await client.getIndexTemplates();
    return NextResponse.json(templates);
  } catch (error: any) {
    console.error('Error fetching templates:', error);
    return NextResponse.json(
      { error: `Failed to fetch templates: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client available. Please connect first.' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { name, template } = body;

    if (!name || !template) {
      return NextResponse.json(
        { error: 'Template name and definition are required' },
        { status: 400 }
      );
    }

    await client.createIndexTemplate(name, template);
    return NextResponse.json({ success: true, message: 'Template created successfully' });
  } catch (error: any) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { error: `Failed to create template: ${error.message}` },
      { status: 500 }
    );
  }
}
