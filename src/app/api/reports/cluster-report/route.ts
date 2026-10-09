import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { ElasticsearchClient } from '@/lib/elasticsearch';
import {
  configFromSavedConnection, getClusterSession, getSavedConnectionForUser, openClusterClient,
} from '@/lib/cluster-session';
import debugLog from '@/lib/debug';

/** Adapts our client to the small subset of the official client API the collectors use. */
function adapt(client: ElasticsearchClient) {
  return {
    cluster: {
      health: () => client.getClusterHealth(),
      stats: () => client.request('/_cluster/stats'),
    },
    nodes: { stats: () => client.request('/_nodes/stats') },
    indices: { stats: () => client.request('/_stats') },
  };
}

// ✅ Cluster health
async function getClusterHealth(esClient: any) {
  try {
    const health = await esClient.cluster.health();
    const stats = await esClient.cluster.stats();

    return {
      status: health.status,
      cluster_name: health.cluster_name,
      number_of_nodes: health.number_of_nodes,
      number_of_data_nodes: health.number_of_data_nodes,
      active_primary_shards: health.active_primary_shards,
      active_shards: health.active_shards,
      relocating_shards: health.relocating_shards,
      initializing_shards: health.initializing_shards,
      unassigned_shards: health.unassigned_shards,
      delayed_unassigned_shards: health.delayed_unassigned_shards,
      number_of_pending_tasks: health.number_of_pending_tasks,
      task_max_waiting_in_queue_millis: health.task_max_waiting_in_queue_millis,
      active_shards_percent_as_number: health.active_shards_percent_as_number,
      indices_count: stats.indices?.count || 0,
      docs_count: stats.indices?.docs?.count || 0,
      store_size_bytes: stats.indices?.store?.size_in_bytes || 0
    };
  } catch (error: any) {
    debugLog.error('api', 'Failed to get cluster health', { error: error.message });
    throw new Error('Failed to retrieve cluster health data');
  }
}

// ✅ Node info
async function getNodesInfo(esClient: any) {
  try {
    const nodesStats = await esClient.nodes.stats();
    const nodes = [];

    for (const [nodeId, nodeData] of Object.entries(nodesStats.nodes)) {
      const node = nodeData as any;
      nodes.push({
        id: nodeId,
        name: node.name,
        roles: node.roles,
        memory_usage: Math.round(node.jvm?.mem?.heap_used_percent || 0),
        cpu_usage: Math.round(node.os?.cpu?.percent || 0),
        disk_usage: Math.round(
          (node.fs?.total?.available_in_bytes || 0) /
            (node.fs?.total?.total_in_bytes || 1) *
            100
        ),
        load_average: node.os?.cpu?.load_average?.['1m'] || 0
      });
    }

    return nodes;
  } catch (error: any) {
    debugLog.error('api', 'Failed to get nodes info', { error: error.message });
    throw new Error('Failed to retrieve nodes information');
  }
}

// ✅ Index info
async function getIndicesInfo(esClient: any) {
  try {
    const indicesStats = await esClient.indices.stats();
    const indices = [];

    for (const [indexName, indexData] of Object.entries(indicesStats.indices)) {
      const index = indexData as any;
      indices.push({
        name: indexName,
        docs_count: index.total?.docs?.count || 0,
        store_size_bytes: index.total?.store?.size_in_bytes || 0,
        primary_shards: index.primaries?.docs?.count || 0,
        replica_shards:
          (index.total?.docs?.count || 0) -
          (index.primaries?.docs?.count || 0)
      });
    }

    // Sort largest first
    return indices.sort((a, b) => b.store_size_bytes - a.store_size_bytes);
  } catch (error: any) {
    debugLog.error('api', 'Failed to get indices info', { error: error.message });
    throw new Error('Failed to retrieve indices information');
  }
}

// ✅ Search analytics
async function getSearchAnalytics(esClient: any) {
  try {
    const clusterStats = await esClient.cluster.stats();
    const indicesStats = await esClient.indices.stats();

    let totalQueries = 0;
    let totalQueryTime = 0;

    for (const [, indexData] of Object.entries(indicesStats.indices)) {
      const index = indexData as any;
      totalQueries += index.total?.search?.query_total || 0;
      totalQueryTime += index.total?.search?.query_time_in_millis || 0;
    }

    return {
      total_queries: totalQueries,
      average_query_time:
        totalQueries > 0 ? Math.round(totalQueryTime / totalQueries) : 0,
      queries_per_second: clusterStats.indices?.search?.query_total || 0,
      cache_hit_ratio:
        clusterStats.indices?.query_cache?.hit_count &&
        clusterStats.indices?.query_cache?.miss_count
          ? Math.round(
              (clusterStats.indices.query_cache.hit_count /
                (clusterStats.indices.query_cache.hit_count +
                  clusterStats.indices.query_cache.miss_count)) *
                100
            )
          : 0
    };
  } catch (error: any) {
    debugLog.error('api', 'Failed to get search analytics', { error: error.message });
    throw new Error('Failed to retrieve search analytics');
  }
}

export async function POST(request: NextRequest) {
  debugLog.api.request('POST', '/api/reports/cluster-report');

  try {
    const user = getUserFromRequest(request);
    if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

    // Cluster is resolved server-side only: the caller's active session, or a
    // saved connection their role may use. Browser-supplied hosts are not accepted.
    const { connectionId, useActiveConnection } = await request.json();

    let esClient;
    let connectionInfo;

    if (useActiveConnection || !connectionId || connectionId === 'active' || connectionId === 'current') {
      const session = getClusterSession(user.id);
      if (!session) {
        return NextResponse.json(
          { error: 'No active connection found. Please connect to a cluster first.' },
          { status: 400 }
        );
      }
      esClient = adapt(session.client);
      connectionInfo = { name: session.url };
    } else {
      const conn = getSavedConnectionForUser(String(connectionId), user);
      if (conn instanceof NextResponse) return conn;
      esClient = adapt(await openClusterClient(configFromSavedConnection(conn)));
      connectionInfo = { name: conn.name };
    }

    debugLog.debug('api', 'Collecting cluster data for report', {
      connectionId,
      useActiveConnection,
      user: user.username
    });

    // ✅ Collect all data in parallel
    const [clusterHealth, nodesInfo, indicesInfo, searchAnalytics] =
      await Promise.all([
        getClusterHealth(esClient),
        getNodesInfo(esClient),
        getIndicesInfo(esClient),
        getSearchAnalytics(esClient)
      ]);

    // ✅ Additional metrics
    const totalStorageGB = Math.round(
      (clusterHealth.store_size_bytes || 0) / (1024 * 1024 * 1024) * 100
    ) / 100;
    const avgDocsPerIndex =
      indicesInfo.length > 0
        ? Math.round(
            indicesInfo.reduce(
              (sum: number, idx: any) => sum + idx.docs_count,
              0
            ) / indicesInfo.length
          )
        : 0;

    const issues: string[] = [];
    const recommendations: string[] = [];

    // ✅ Analyze cluster health
    if (clusterHealth.status === 'red') {
      issues.push('Cluster status is RED - some primary shards are not allocated');
      recommendations.push('Investigate unassigned shards and node availability');
    } else if (clusterHealth.status === 'yellow') {
      issues.push('Cluster status is YELLOW - some replica shards are not allocated');
      recommendations.push('Check if you have enough nodes for your replica configuration');
    }

    // ✅ Analyze node resources
    const highMemoryNodes = nodesInfo.filter((node: any) => node.memory_usage > 85);
    if (highMemoryNodes.length > 0) {
      issues.push(`${highMemoryNodes.length} node(s) have high memory usage (>85%)`);
      recommendations.push('Consider increasing heap size or adding more nodes');
    }

    const highDiskNodes = nodesInfo.filter((node: any) => node.disk_usage > 90);
    if (highDiskNodes.length > 0) {
      issues.push(`${highDiskNodes.length} node(s) have high disk usage (>90%)`);
      recommendations.push('Free up disk space or add more storage capacity');
    }

    // ✅ Analyze search performance
    if (searchAnalytics.average_query_time > 1000) { // > 1 second
      issues.push('Average query time is high (>1s)');
      recommendations.push('Review query optimization and index mappings');
    }

    // ✅ Prepare final report data
    const reportData = {
      metadata: {
        generated_at: new Date().toISOString(),
        generated_by: user.username,
        connection_name: connectionInfo.name,
        cluster_name: clusterHealth.cluster_name
      },
      executive_summary: {
        cluster_status: clusterHealth.status,
        total_nodes: clusterHealth.number_of_nodes,
        total_indices: clusterHealth.indices_count,
        total_documents: clusterHealth.docs_count,
        total_storage_gb: totalStorageGB,
        active_shards_percent: clusterHealth.active_shards_percent_as_number,
        issues_count: issues.length,
        recommendations_count: recommendations.length
      },
      cluster_health: clusterHealth,
      nodes_analysis: {
        nodes: nodesInfo,
        summary: {
          total_nodes: nodesInfo.length,
          data_nodes: nodesInfo.filter((n: any) => n.roles.includes('data')).length,
          master_nodes: nodesInfo.filter((n: any) => n.roles.includes('master')).length,
          avg_memory_usage: nodesInfo.length > 0
            ? Math.round(nodesInfo.reduce((sum: number, n: any) => sum + n.memory_usage, 0) / nodesInfo.length)
            : 0,
          avg_cpu_usage: nodesInfo.length > 0
            ? Math.round(nodesInfo.reduce((sum: number, n: any) => sum + n.cpu_usage, 0) / nodesInfo.length)
            : 0
        }
      },
      indices_analysis: {
        indices: indicesInfo.slice(0, 20), // Top 20
        summary: {
          total_indices: indicesInfo.length,
          total_documents: indicesInfo.reduce((sum: number, idx: any) => sum + idx.docs_count, 0),
          largest_index: indicesInfo[0]?.name || 'N/A',
          avg_docs_per_index: avgDocsPerIndex
        }
      },
      search_performance: searchAnalytics,
      issues_and_recommendations: {
        issues,
        recommendations
      }
    };

    debugLog.api.response(200, 'Cluster report data collected successfully', {
      cluster_name: clusterHealth.cluster_name,
      nodes_count: nodesInfo.length,
      indices_count: indicesInfo.length,
      issues_count: issues.length
    });

    return NextResponse.json({ status: 'success', reportData });

  } catch (error: any) {
    debugLog.api.error('Failed to generate cluster report', {
      error: error.message,
      stack: error.stack
    });

    return NextResponse.json(
      { error: error.message || 'Failed to generate cluster report' },
      { status: 500 }
    );
  }
}

