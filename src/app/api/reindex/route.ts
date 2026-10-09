/**
 * POST /api/reindex          — start a reindex task
 * GET  /api/reindex?task=... — poll task status
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireClusterAccess } from '@/lib/cluster-session';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'POST', '/_reindex');
  if (ctx instanceof NextResponse) return ctx;
  const client = ctx.session.client;

  const body = await request.json();
  const { source_index, dest_index, query, pipeline, conflicts } = body;

  if (!source_index || !dest_index) {
    return NextResponse.json({ error: 'source_index and dest_index are required' }, { status: 400 });
  }

  const reindexBody: Record<string, unknown> = {
    source: { index: source_index, ...(query ? { query } : {}) },
    dest:   { index: dest_index,   ...(pipeline ? { pipeline } : {}) },
    ...(conflicts ? { conflicts } : {}),
  };

  try {
    const result = await client.reindex(reindexBody, false);
    writeAuditLog(request, 'reindex', {
      target: `${source_index} -> ${dest_index}`,
      statusCode: 200,
    });
    return NextResponse.json(result);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Reindex failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'GET', '/_tasks');
  if (ctx instanceof NextResponse) return ctx;
  const client = ctx.session.client;

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task');

  if (!taskId || !/^[\w.-]+:\d+$/.test(taskId)) {
    return NextResponse.json({ error: 'valid task parameter required (node:id)' }, { status: 400 });
  }

  try {
    const task = await client.getTask(taskId);
    return NextResponse.json(task);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Task not found' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'POST', '/_tasks/_cancel');
  if (ctx instanceof NextResponse) return ctx;
  const client = ctx.session.client;

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task');
  if (!taskId || !/^[\w.-]+:\d+$/.test(taskId)) {
    return NextResponse.json({ error: 'valid task parameter required (node:id)' }, { status: 400 });
  }

  try {
    await client.cancelTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cancel failed' }, { status: 500 });
  }
}
