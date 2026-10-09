/**
 * GET /api/monitoring/stream — Server-Sent Events stream of live cluster metrics.
 * Pushes a JSON event every 5 seconds until the client disconnects.
 * Also evaluates alert rules on each tick.
 */
import { NextRequest } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { getClusterSession } from '@/lib/cluster-session';
import { evaluateAlerts, ClusterMetrics } from '@/lib/alert-engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Rate counters are per stream so concurrent viewers/clusters don't corrupt each other
interface StreamState { prevDocs: number; prevGcOldMs: number }

async function collectMetrics(userId: string, state: StreamState): Promise<{ metrics: ClusterMetrics; connectionId?: string }> {
  const session = getClusterSession(userId);
  if (!session) throw new Error('no_client');
  const client = session.client;

  const [statsRes, healthRes] = await Promise.all([
    client.getDetailedNodeStats(),
    client.getClusterHealth(),
  ]);

  // Aggregate across all nodes
  const nodes = Object.values((statsRes.nodes ?? {}) as Record<string, unknown>);
  let cpuSum = 0, heapUsed = 0, heapMax = 0, gcOldMs = 0;

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
    gcOldMs += (old.collection_time_in_millis as number) ?? 0;
  }

  const nodeCount = nodes.length || 1;
  const cpuPercent = cpuSum / nodeCount;
  const heapPercent = heapMax > 0 ? (heapUsed / heapMax) * 100 : 0;

  // GC pressure = delta GC time / wall time (capped 0-100)
  const deltaGcMs = state.prevGcOldMs ? Math.max(0, gcOldMs - state.prevGcOldMs) : 0;
  const gcPressure = Math.min(100, (deltaGcMs / 5000) * 100);
  state.prevGcOldMs = gcOldMs;

  const health = healthRes as Record<string, unknown>;
  const activeShardsVal = (health.active_shards as number) ?? 0;
  const unassignedShardsVal = (health.unassigned_shards as number) ?? 0;

  // Indexing rate (docs delta)
  let docsCount = 0;
  try {
    const statsSimple = await client.getClusterStats();
    docsCount = ((statsSimple as Record<string, unknown>).indices as Record<string, unknown> ?? {}).count as number ?? 0;
  } catch { /* ignore */ }
  const deltaDocsSec = state.prevDocs ? Math.max(0, (docsCount - state.prevDocs) / 5) : 0;
  state.prevDocs = docsCount;

  const metrics: ClusterMetrics = {
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
  return { metrics, connectionId: session.savedConnectionId };
}

export async function GET(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();
  const state: StreamState = { prevDocs: 0, prevGcOldMs: 0 };
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const stop = () => {
    closed = true;
    if (timer) clearTimeout(timer);
  };

  const stream = new ReadableStream({
    start(controller) {
      // Sequential loop: the next tick is scheduled only after the previous one
      // finishes, so a slow cluster can never cause overlapping collections.
      const tick = async () => {
        if (closed) return;
        let payload: string;
        try {
          const { metrics, connectionId } = await collectMetrics(user.id, state);
          // Run alert evaluation (fire-and-forget) for rules scoped to this cluster
          evaluateAlerts(metrics, connectionId).catch(console.warn);
          payload = JSON.stringify({ type: 'metrics', ...metrics });
        } catch (err) {
          payload = JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
        } catch {
          stop(); // client went away
          return;
        }
        timer = setTimeout(tick, 5000);
      };
      tick();
    },
    cancel() {
      stop();
    },
  });

  request.signal.addEventListener('abort', stop);

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
