/**
 * GET /api/monitoring/stream — Server-Sent Events stream of live cluster metrics.
 * Pushes a JSON event every 5 seconds until the client disconnects.
 * Also evaluates alert rules on each tick.
 */
import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getElasticsearchClient } from '@/lib/elasticsearch';
import { evaluateAlerts, ClusterMetrics } from '@/lib/alert-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

let prevDocs = 0;
let prevGcOld = 0;
let prevGcOldMs = 0;

async function collectMetrics(): Promise<ClusterMetrics> {
  const client = getElasticsearchClient();
  if (!client) throw new Error('no_client');

  const [statsRes, healthRes] = await Promise.all([
    client.getDetailedNodeStats(),
    client.getClusterHealth(),
  ]);

  // Aggregate across all nodes
  const nodes = Object.values((statsRes.nodes ?? {}) as Record<string, unknown>);
  let cpuSum = 0, heapUsed = 0, heapMax = 0, gcOld = 0, gcOldMs = 0, threads = 0;

  for (const n of nodes) {
    const node = n as Record<string, unknown>;
    const os = node.os as Record<string, unknown> ?? {};
    const jvm = node.jvm as Record<string, unknown> ?? {};
    const mem = jvm.mem as Record<string, unknown> ?? {};
    const gcColl = (jvm.gc as Record<string, unknown> ?? {}).collectors as Record<string, unknown> ?? {};

    cpuSum += ((os.cpu as Record<string, unknown>)?.percent as number) ?? 0;
    heapUsed += ((mem.heap_used_in_bytes as number) ?? 0);
    heapMax += ((mem.heap_max_in_bytes as number) ?? 0);

    const old = (gcColl.old ?? gcColl['ConcurrentMarkSweep'] ?? gcColl['G1 Old Generation']) as Record<string, unknown> ?? {};
    gcOld += (old.collection_count as number) ?? 0;
    gcOldMs += (old.collection_time_in_millis as number) ?? 0;

    threads += ((jvm.threads as Record<string, unknown>)?.count as number) ?? 0;
  }

  const nodeCount = nodes.length || 1;
  const cpuPercent = cpuSum / nodeCount;
  const heapPercent = heapMax > 0 ? (heapUsed / heapMax) * 100 : 0;

  // GC pressure = delta GC time / wall time (capped 0-100)
  const deltaGcMs = Math.max(0, gcOldMs - prevGcOldMs);
  const gcPressure = Math.min(100, (deltaGcMs / 5000) * 100);
  prevGcOldMs = gcOldMs;
  prevGcOld = gcOld;

  const health = healthRes as Record<string, unknown>;
  const activeShardsVal = (health.active_shards as number) ?? 0;
  const unassignedShardsVal = (health.unassigned_shards as number) ?? 0;

  // Indexing rate (docs delta)
  let docsCount = 0;
  try {
    const statsSimple = await client.getClusterStats();
    docsCount = ((statsSimple as Record<string, unknown>).indices as Record<string, unknown> ?? {}).count as number ?? 0;
  } catch { /* ignore */ }
  const deltaDocsSec = Math.max(0, (docsCount - prevDocs) / 5);
  prevDocs = docsCount;

  return {
    cpu_percent: Math.round(cpuPercent * 10) / 10,
    heap_percent: Math.round(heapPercent * 10) / 10,
    heap_used_bytes: heapUsed,
    heap_max_bytes: heapMax,
    gc_pressure: Math.round(gcPressure * 10) / 10,
    unassigned_shards: unassignedShardsVal,
    active_shards: activeShardsVal,
    docs_count: docsCount,
    indexing_rate: deltaDocsSec,
    node_count: nodeCount,
    cluster_status: (health.status as string) ?? 'unknown',
  };
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  let timer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const push = async () => {
        try {
          const metrics = await collectMetrics();
          // Run alert evaluation (fire-and-forget)
          evaluateAlerts(metrics).catch(console.warn);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'metrics', ...metrics })}\n\n`));
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`));
        }
      };
      // Push immediately, then every 5 s
      push();
      timer = setInterval(push, 5000);
    },
    cancel() {
      if (timer) clearInterval(timer);
    },
  });

  request.signal.addEventListener('abort', () => {
    if (timer) clearInterval(timer);
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
