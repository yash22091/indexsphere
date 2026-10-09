import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/auth';
import { requireClusterAccess, assertMayUseAdHocConnection } from '@/lib/cluster-session';
import { ElasticsearchClient } from '@/lib/elasticsearch';
import { csvCell, csvRow } from '@/lib/csv';

/** GET — health of the caller's active cluster session. */
export async function GET(request: NextRequest) {
  const ctx = requireClusterAccess(request, 'GET', '/_cluster/health');
  if (ctx instanceof NextResponse) return ctx;

  try {
    const health = await ctx.session.client.getClusterHealth();
    return NextResponse.json(health);
  } catch (error: any) {
    console.error('Error fetching cluster health:', error);
    return NextResponse.json(
      { error: `Failed to fetch cluster health: ${error.message}` },
      { status: 500 }
    );
  }
}

/** POST — test an ad-hoc cluster URL (does not change the caller's session). */
export async function POST(request: NextRequest) {
  const user = getUserFromRequest(request);
  if (!user) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const denied = assertMayUseAdHocConnection(user);
  if (denied) return denied;

  try {
    const { url, auth, verifyTls } = await request.json();
    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // sslBypassFetch (inside the client) SSRF-guards the destination
    const client = new ElasticsearchClient({
      url: String(url).replace(/\/+$/, ''),
      verifyTls: verifyTls === true,
      ...(auth?.username && auth?.password ? { auth: { username: auth.username, password: auth.password } } : {}),
    }, false);
    const health = await client.getClusterHealth();
    return NextResponse.json(health);

  } catch (error: any) {
    return NextResponse.json(
      { error: 'Failed to get cluster health', message: error.message },
      { status: 400 }
    );
  }
}

// Reports export functionality
export async function PUT(request: NextRequest) {
  if (!getUserFromRequest(request)) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }
  try {
    const body = await request.json();
    const { format, data, connection } = body;

    if (!data || !format) {
      return NextResponse.json(
        { error: 'Missing required data or format' },
        { status: 400 }
      );
    }

    if (format === 'json') {
      // Generate JSON report
      const jsonReport = {
        reportMetadata: {
          generatedAt: new Date().toISOString(),
          format: 'json',
          version: '1.0.0',
          connection: {
            name: connection?.name || 'Unknown',
            host: connection?.host || 'Unknown',
            port: connection?.port || 'Unknown',
          }
        },
        clusterHealth: data.cluster,
        nodes: data.nodes,
        indices: data.indices,
        summary: {
          totalNodes: data.cluster?.number_of_nodes || 0,
          totalIndices: data.indices?.length || 0,
          totalShards: data.cluster?.active_shards || 0,
          clusterStatus: data.cluster?.status || 'unknown'
        }
      };

      const jsonString = JSON.stringify(jsonReport, null, 2);
      
      return new NextResponse(jsonString, {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="elasticsearch-report-${Date.now()}.json"`,
        },
      });
    } else if (format === 'csv') {
      // Generate CSV report
      let csvContent = '';
      
      // Cluster summary
      csvContent += 'CLUSTER SUMMARY\n';
      csvContent += 'Property,Value\n';
      csvContent += csvRow(['Cluster Name', data.cluster?.cluster_name || 'Unknown']) + '\n';
      csvContent += csvRow(['Status', data.cluster?.status || 'Unknown']) + '\n';
      csvContent += csvRow(['Total Nodes', data.cluster?.number_of_nodes || 0]) + '\n';
      csvContent += csvRow(['Data Nodes', data.cluster?.number_of_data_nodes || 0]) + '\n';
      csvContent += csvRow(['Active Shards', data.cluster?.active_shards || 0]) + '\n';
      csvContent += csvRow(['Primary Shards', data.cluster?.active_primary_shards || 0]) + '\n';
      csvContent += csvRow(['Unassigned Shards', data.cluster?.unassigned_shards || 0]) + '\n';
      csvContent += csvRow(['Active Shards Percent', `${data.cluster?.active_shards_percent_as_number || 0}%`]) + '\n';
      csvContent += '\n';

      // Nodes information
      csvContent += 'NODES\n';
      csvContent += 'Name,Host,IP,Version,Roles\n';
      if (data.nodes && Array.isArray(data.nodes)) {
        data.nodes.forEach((node: any) => {
          csvContent += [node.name, node.host, node.ip, node.version, (node.roles || []).join(';')].map(csvCell).join(',') + '\n';
        });
      }
      csvContent += '\n';

      // Indices information
      csvContent += 'INDICES\n';
      csvContent += 'Index,Health,Status,Primary Shards,Replica Shards,Documents Count,Deleted Documents,Store Size,Primary Store Size\n';
      if (data.indices && Array.isArray(data.indices)) {
        data.indices.forEach((index: any) => {
          csvContent += [index.index, index.health, index.status, index.pri, index.rep, index['docs.count'],
            index['docs.deleted'], index['store.size'], index['pri.store.size']].map(csvCell).join(',') + '\n';
        });
      }

      return new NextResponse(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="elasticsearch-report-${Date.now()}.csv"`,
        },
      });
    } else {
      return NextResponse.json(
        { error: 'Unsupported format. Use json or csv.' },
        { status: 400 }
      );
    }
  } catch (error) {
    console.error('Error generating report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report' },
      { status: 500 }
    );
  }
}
