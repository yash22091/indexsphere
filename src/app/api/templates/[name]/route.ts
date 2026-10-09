import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';
import { writeAuditLog } from '@/lib/audit';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name: templateName } = await params;
  const ctx = requireClusterAccess(request, 'DELETE', `/_index_template/${encodeURIComponent(templateName)}`);
  if (ctx instanceof NextResponse) return ctx;

  try {
    await ctx.session.client.deleteIndexTemplate(encodeURIComponent(templateName));
    writeAuditLog(request, 'template:delete', { target: templateName, statusCode: 200 });

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
  const { name: templateName } = await params;
  const ctx = requireClusterAccess(request, 'GET', `/_index_template/${encodeURIComponent(templateName)}`);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const template = await ctx.session.client.getIndexTemplate(encodeURIComponent(templateName));
    return NextResponse.json(template);
  } catch (error: any) {
    console.error('Error fetching template:', error);
    return NextResponse.json(
      { error: `Failed to fetch template: ${error.message}` },
      { status: 500 }
    );
  }
}
