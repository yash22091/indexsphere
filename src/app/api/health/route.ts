import { NextRequest, NextResponse } from 'next/server';
import { getElasticsearchClient } from '@/lib/elasticsearch';

// Health check endpoint for production monitoring
export async function GET(request: NextRequest) {
  // Basic system info — always available
  const systemInfo = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    nodeVersion: process.version,
    memory: process.memoryUsage(),
  };

  // ES connectivity is informational; app health does not depend on it
  const client = getElasticsearchClient();

  if (!client) {
    return NextResponse.json({
      status: 'healthy',
      elasticsearch: { connected: false, reason: 'No connection configured' },
      system: systemInfo,
    });
  }

  try {
    const health = await client.getClusterHealth();
    return NextResponse.json({
      status: 'healthy',
      elasticsearch: {
        connected: true,
        cluster_name: health.cluster_name,
        status: health.status,
        nodes: health.number_of_nodes,
        active_shards: health.active_shards,
      },
      system: systemInfo,
    });
  } catch (error: any) {
    // ES unreachable — app is still healthy, ES is not
    return NextResponse.json({
      status: 'healthy',
      elasticsearch: { connected: false, reason: error.message },
      system: systemInfo,
    });
  }
}
