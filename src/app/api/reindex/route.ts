/**
 * POST /api/reindex          — start a reindex task
 * GET  /api/reindex?task=... — poll task status
 */
import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { writeAuditLog } from '@/lib/audit';

export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const client = getElasticsearchClient();
  if (!client) return NextResponse.json({ error: 'No cluster connected' }, { status: 400 });

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
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const client = getElasticsearchClient();
  if (!client) return NextResponse.json({ error: 'No cluster connected' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task');

  if (!taskId) {
    return NextResponse.json({ error: 'task parameter required' }, { status: 400 });
  }

  try {
    const task = await client.getTask(taskId);
    return NextResponse.json(task);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Task not found' }, { status: 404 });
  }
}

export async function DELETE(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const client = getElasticsearchClient();
  if (!client) return NextResponse.json({ error: 'No cluster connected' }, { status: 400 });

  const { searchParams } = new URL(request.url);
  const taskId = searchParams.get('task');
  if (!taskId) return NextResponse.json({ error: 'task parameter required' }, { status: 400 });

  try {
    await client.cancelTask(taskId);
    return NextResponse.json({ ok: true });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Cancel failed' }, { status: 500 });
  }
}
