import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';
import { writeAuditLog } from '@/lib/audit';

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> }
) {
  const { name: indexName } = await params;
  const ctx = requireClusterAccess(request, 'DELETE', `/${encodeURIComponent(indexName)}`);
  if (ctx instanceof NextResponse) return ctx;

  try {
    await ctx.session.client.deleteIndex(encodeURIComponent(indexName));
    writeAuditLog(request, 'index:delete', { target: indexName, statusCode: 200 });

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
  const { name: indexName } = await params;
  const ctx = requireClusterAccess(request, 'GET', `/${encodeURIComponent(indexName)}`);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const indexData = await ctx.session.client.getIndex(encodeURIComponent(indexName));
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
  const { name: indexName } = await params;
  const ctx = requireClusterAccess(request, 'PUT', `/${encodeURIComponent(indexName)}`);
  if (ctx instanceof NextResponse) return ctx;

  try {
    const body = await request.json();
    await ctx.session.client.createIndex(encodeURIComponent(indexName), body);
    writeAuditLog(request, 'index:create', { target: indexName, statusCode: 200 });

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
