import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';

export async function GET(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'GET', '/_cat/indices');
  if (ctx instanceof NextResponse) return ctx;

  try {
    const indices = await ctx.session.client.getIndices();
    return NextResponse.json(indices);
  } catch (error: any) {
    console.error('Error fetching indices:', error);
    return NextResponse.json(
      { error: `Failed to fetch indices: ${error.message}` },
      { status: 500 }
    );
  }
}
