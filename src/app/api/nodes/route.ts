import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';

// Get cluster nodes information
export async function GET(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'GET', '/_nodes');
  if (ctx instanceof NextResponse) return ctx;

  try {
    const nodes = await ctx.session.client.getNodes();
    return NextResponse.json(nodes);
  } catch (error: any) {
    console.error('Failed to fetch nodes:', error);
    return NextResponse.json(
      { error: `Failed to fetch nodes: ${error.message}` },
      { status: 500 }
    );
  }
}
