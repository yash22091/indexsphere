import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';
import { writeAuditLog } from '@/lib/audit';

export async function GET(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'GET', '/_index_template');
  if (ctx instanceof NextResponse) return ctx;

  try {
    const templates = await ctx.session.client.getIndexTemplates();
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
  const body = await request.json();
  const { name, template } = body;

  if (!name || !template) {
    return NextResponse.json(
      { error: 'Template name and definition are required' },
      { status: 400 }
    );
  }

  const ctx = requireClusterAccess(request, 'PUT', `/_index_template/${encodeURIComponent(name)}`);
  if (ctx instanceof NextResponse) return ctx;

  try {
    await ctx.session.client.createIndexTemplate(encodeURIComponent(name), template);
    writeAuditLog(request, 'template:create', { target: name, statusCode: 200 });
    return NextResponse.json({ success: true, message: 'Template created successfully' });
  } catch (error: any) {
    console.error('Error creating template:', error);
    return NextResponse.json(
      { error: `Failed to create template: ${error.message}` },
      { status: 500 }
    );
  }
}
