import { NextRequest, NextResponse } from 'next/server';
import { getElasticsearchClient, ElasticsearchClient } from '@/lib/elasticsearch';
import { sslBypassFetch } from '@/lib/ssl-bypass';

export async function GET() {
  try {
    const client = getElasticsearchClient();
    if (!client) {
      return NextResponse.json(
        { error: 'No Elasticsearch client available. Please connect first.' },
        { status: 400 }
      );
    }

    const health = await client.getClusterHealth();
    return NextResponse.json(health);
  } catch (error: any) {
    console.error('Error fetching cluster health:', error);
    return NextResponse.json(
      { error: `Failed to fetch cluster health: ${error.message}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const config = await request.json();
    const { url, auth } = config;

    if (!url) {
      return NextResponse.json({ error: 'URL is required' }, { status: 400 });
    }

    // Prepare headers
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    // Add authentication if provided
    if (auth && auth.username && auth.password) {
      const credentials = btoa(`${auth.username}:${auth.password}`);
      headers.Authorization = `Basic ${credentials}`;
    }

    // Make request to get cluster health with SSL bypass
    const response = await sslBypassFetch(`${url}/_cluster/health`, {
      method: 'GET',
      headers,
    });

    if (!response.ok) {
      throw new Error(`Failed to connect: HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`);
    }

    const health = await response.json();
    return NextResponse.json(health);

  } catch (error: any) {
    console.error('Cluster health error:', error);
    return NextResponse.json(
      { error: 'Failed to get cluster health', message: error.message },
      { status: 400 }
    );
  }
}

// Reports export functionality
export async function PUT(request: NextRequest) {
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
      csvContent += `Cluster Name,${data.cluster?.cluster_name || 'Unknown'}\n`;
      csvContent += `Status,${data.cluster?.status || 'Unknown'}\n`;
      csvContent += `Total Nodes,${data.cluster?.number_of_nodes || 0}\n`;
      csvContent += `Data Nodes,${data.cluster?.number_of_data_nodes || 0}\n`;
      csvContent += `Active Shards,${data.cluster?.active_shards || 0}\n`;
      csvContent += `Primary Shards,${data.cluster?.active_primary_shards || 0}\n`;
      csvContent += `Unassigned Shards,${data.cluster?.unassigned_shards || 0}\n`;
      csvContent += `Active Shards Percent,${data.cluster?.active_shards_percent_as_number || 0}%\n`;
      csvContent += '\n';

      // Nodes information
      csvContent += 'NODES\n';
      csvContent += 'Name,Host,IP,Version,Roles\n';
      if (data.nodes && Array.isArray(data.nodes)) {
        data.nodes.forEach((node: any) => {
          csvContent += `"${node.name || ''}","${node.host || ''}","${node.ip || ''}","${node.version || ''}","${(node.roles || []).join(';')}"\n`;
        });
      }
      csvContent += '\n';

      // Indices information
      csvContent += 'INDICES\n';
      csvContent += 'Index,Health,Status,Primary Shards,Replica Shards,Documents Count,Deleted Documents,Store Size,Primary Store Size\n';
      if (data.indices && Array.isArray(data.indices)) {
        data.indices.forEach((index: any) => {
          csvContent += `"${index.index || ''}","${index.health || ''}","${index.status || ''}","${index.pri || ''}","${index.rep || ''}","${index['docs.count'] || ''}","${index['docs.deleted'] || ''}","${index['store.size'] || ''}","${index['pri.store.size'] || ''}"\n`;
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
