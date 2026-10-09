import { NextRequest, NextResponse } from 'next/server';
import { namedSemaphore } from '@/lib/concurrency';
import { requireAdmin } from '@/lib/auth';
import debugLog from '@/lib/debug';

// Generate PDF from report data
export async function POST(request: NextRequest) {
  debugLog.api.request('POST', '/api/reports/generate-pdf');

  let user;
  try {
    user = requireAdmin(request);
  } catch (errResponse) {
    return errResponse as NextResponse;
  }

  try {
    const { reportData } = await request.json();
    
    if (!reportData) {
      return NextResponse.json(
        { error: 'Report data is required' },
        { status: 400 }
      );
    }

    debugLog.debug('api', 'Generating PDF report', { 
      user: user.username,
      cluster: reportData.metadata?.cluster_name
    });

    // Create HTML content for the PDF — every string from the request is HTML-escaped
    const htmlContent = generateReportHTML(escapeDeep(reportData));
    
    // For now, we'll use puppeteer for PDF generation
    // In production, you might want to use a dedicated PDF service
    // puppeteer is ESM-only: load it with a dynamic import
    const puppeteer = (await import('puppeteer')).default;
    
    // Each PDF launches headless Chrome (~200 MB): cap concurrency so bursts queue
    // instead of exhausting memory. The slot is held until Chrome has exited.
    const sem = namedSemaphore('pdf', Number(process.env.PDF_MAX_CONCURRENCY ?? 2) || 2);
    let job: Promise<unknown>;
    try {
      const release = await sem.acquire(30_000);
      job = generatePDFWithPuppeteer(puppeteer, htmlContent).finally(release);
    } catch {
      return NextResponse.json({ error: 'PDF generator is busy, please retry in a moment' }, { status: 429 });
    }
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const pdfBuffer = await Promise.race([
      job,
      new Promise((_, reject) => {
        timeoutId = setTimeout(() => reject(new Error('PDF generation timeout after 2 minutes')), 120000);
      }),
    ]).finally(() => clearTimeout(timeoutId));
    
    debugLog.api.response(200, 'PDF generated successfully');

    // Return PDF as response
    return new NextResponse(pdfBuffer as Buffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="cluster-report-${String(reportData.metadata?.cluster_name || 'unknown').replace(/[^\w.-]/g, '_')}-${new Date().toISOString().split('T')[0]}.pdf"`
      }
    });

  } catch (error: any) {
    debugLog.api.error('PDF generation failed', { error: error.message });
    return NextResponse.json(
      { error: error.message },
      { status: error.message.includes('authentication') ? 401 : 500 }
    );
  }
}

async function generatePDFWithPuppeteer(puppeteer: any, htmlContent: string) {
  const browser = await puppeteer.launch({
    headless: true,
    args: [
      '--no-sandbox', 
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-features=TranslateUI'
    ],
    protocolTimeout: 120000, // 2 minutes
    timeout: 120000 // 2 minutes
  });
  
  try {
    const page = await browser.newPage();

    // The report is static HTML: no scripts, and no network access at all
    // (prevents SSRF / data exfiltration from injected markup).
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on('request', (req: any) => {
      if (req.url().startsWith('data:')) req.continue();
      else req.abort();
    });
    
    // Set longer timeouts for the page
    page.setDefaultTimeout(60000); // 1 minute
    page.setDefaultNavigationTimeout(60000); // 1 minute
    
    // Set the HTML content with reduced wait time
    await page.setContent(htmlContent, {
      waitUntil: 'domcontentloaded', // Changed from 'networkidle0' for faster loading
      timeout: 30000 // 30 seconds timeout
    });
    
    // Generate PDF with timeout
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '20mm',
        right: '15mm',
        bottom: '20mm',
        left: '15mm'
      },
      timeout: 60000 // 1 minute timeout for PDF generation
    });
    
    return pdfBuffer;
  } finally {
    await browser.close();
  }
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Recursively HTML-escape every string (keys included) in client-supplied report data. */
function escapeDeep(value: any): any {
  if (typeof value === 'string') return escapeHtml(value);
  if (Array.isArray(value)) return value.map(escapeDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [escapeHtml(k), escapeDeep(v)]));
  }
  return value;
}

function generateReportHTML(data: any) {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat().format(num);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'green': return '#28a745';
      case 'yellow': return '#ffc107';
      case 'red': return '#dc3545';
      default: return '#6c757d';
    }
  };

  return `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Elasticsearch Cluster Report</title>
    <style>
        body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            line-height: 1.6;
            color: #333;
            margin: 0;
            padding: 0;
        }
        .header {
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 30px;
            text-align: center;
        }
        .header h1 {
            margin: 0;
            font-size: 28px;
            font-weight: 300;
        }
        .header .subtitle {
            font-size: 16px;
            opacity: 0.9;
            margin-top: 10px;
        }
        .container {
            max-width: 1000px;
            margin: 0 auto;
            padding: 20px;
        }
        .section {
            margin-bottom: 30px;
            background: white;
            border-radius: 8px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
            overflow: hidden;
        }
        .section-header {
            background: #f8f9fa;
            padding: 15px 20px;
            border-bottom: 1px solid #dee2e6;
            font-weight: 600;
            font-size: 18px;
        }
        .section-content {
            padding: 20px;
        }
        .summary-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
        }
        .summary-card {
            background: #f8f9fa;
            padding: 15px;
            border-radius: 6px;
            text-align: center;
        }
        .summary-card .value {
            font-size: 24px;
            font-weight: bold;
            color: #495057;
        }
        .summary-card .label {
            font-size: 12px;
            color: #6c757d;
            text-transform: uppercase;
            margin-top: 5px;
        }
        .status-badge {
            display: inline-block;
            padding: 4px 12px;
            border-radius: 20px;
            color: white;
            font-weight: bold;
            text-transform: uppercase;
            font-size: 12px;
        }
        .table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        .table th, .table td {
            padding: 12px;
            text-align: left;
            border-bottom: 1px solid #dee2e6;
        }
        .table th {
            background: #f8f9fa;
            font-weight: 600;
        }
        .progress-bar {
            background: #e9ecef;
            border-radius: 10px;
            height: 10px;
            overflow: hidden;
        }
        .progress-fill {
            height: 100%;
            border-radius: 10px;
            transition: width 0.3s ease;
        }
        .issues-list {
            background: #fff3cd;
            border: 1px solid #ffeaa7;
            border-radius: 6px;
            padding: 15px;
            margin: 10px 0;
        }
        .recommendations-list {
            background: #d1ecf1;
            border: 1px solid #bee5eb;
            border-radius: 6px;
            padding: 15px;
            margin: 10px 0;
        }
        .footer {
            text-align: center;
            padding: 20px;
            color: #6c757d;
            font-size: 12px;
            border-top: 1px solid #dee2e6;
            margin-top: 30px;
        }
        @media print {
            .section {
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <h1>Elasticsearch Cluster Report</h1>
        <div class="subtitle">
            Cluster: ${data.metadata?.cluster_name || 'Unknown'} | 
            Generated: ${new Date(data.metadata?.generated_at || new Date()).toLocaleString()} |
            By: ${data.metadata?.generated_by || 'System'}
        </div>
    </div>

    <div class="container">
        <!-- Executive Summary -->
        <div class="section">
            <div class="section-header">Executive Summary</div>
            <div class="section-content">
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="value">
                            <span class="status-badge" style="background-color: ${getStatusColor(data.executive_summary?.cluster_status)}">
                                ${data.executive_summary?.cluster_status || 'Unknown'}
                            </span>
                        </div>
                        <div class="label">Cluster Status</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${formatNumber(data.executive_summary?.total_nodes || 0)}</div>
                        <div class="label">Total Nodes</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${formatNumber(data.executive_summary?.total_indices || 0)}</div>
                        <div class="label">Total Indices</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${formatNumber(data.executive_summary?.total_documents || 0)}</div>
                        <div class="label">Total Documents</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.executive_summary?.total_storage_gb || 0} GB</div>
                        <div class="label">Storage Used</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.executive_summary?.active_shards_percent || 0}%</div>
                        <div class="label">Active Shards</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Cluster Health -->
        <div class="section">
            <div class="section-header">Cluster Health Details</div>
            <div class="section-content">
                <table class="table">
                    <tr>
                        <td><strong>Cluster Name</strong></td>
                        <td>${data.cluster_health?.cluster_name || 'N/A'}</td>
                        <td><strong>Number of Nodes</strong></td>
                        <td>${data.cluster_health?.number_of_nodes || 0}</td>
                    </tr>
                    <tr>
                        <td><strong>Data Nodes</strong></td>
                        <td>${data.cluster_health?.number_of_data_nodes || 0}</td>
                        <td><strong>Active Shards</strong></td>
                        <td>${data.cluster_health?.active_shards || 0}</td>
                    </tr>
                    <tr>
                        <td><strong>Primary Shards</strong></td>
                        <td>${data.cluster_health?.active_primary_shards || 0}</td>
                        <td><strong>Relocating Shards</strong></td>
                        <td>${data.cluster_health?.relocating_shards || 0}</td>
                    </tr>
                    <tr>
                        <td><strong>Initializing Shards</strong></td>
                        <td>${data.cluster_health?.initializing_shards || 0}</td>
                        <td><strong>Unassigned Shards</strong></td>
                        <td>${data.cluster_health?.unassigned_shards || 0}</td>
                    </tr>
                </table>
            </div>
        </div>

        <!-- Nodes Analysis -->
        <div class="section">
            <div class="section-header">Nodes Analysis</div>
            <div class="section-content">
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="value">${data.nodes_analysis?.summary?.total_nodes || 0}</div>
                        <div class="label">Total Nodes</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.nodes_analysis?.summary?.data_nodes || 0}</div>
                        <div class="label">Data Nodes</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.nodes_analysis?.summary?.avg_memory_usage || 0}%</div>
                        <div class="label">Avg Memory Usage</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.nodes_analysis?.summary?.avg_cpu_usage || 0}%</div>
                        <div class="label">Avg CPU Usage</div>
                    </div>
                </div>

                ${data.nodes_analysis?.nodes?.length > 0 ? `
                <table class="table">
                    <thead>
                        <tr>
                            <th>Node Name</th>
                            <th>IP</th>
                            <th>Roles</th>
                            <th>Memory</th>
                            <th>CPU</th>
                            <th>Disk</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.nodes_analysis.nodes.slice(0, 10).map((node: any) => `
                        <tr>
                            <td>${node.name || 'N/A'}</td>
                            <td>${node.ip || 'N/A'}</td>
                            <td>${Array.isArray(node.roles) ? node.roles.join(', ') : 'N/A'}</td>
                            <td>${node.memory_usage || 0}%</td>
                            <td>${node.cpu_usage || 0}%</td>
                            <td>${node.disk_usage || 0}%</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : '<p>No node data available</p>'}
            </div>
        </div>

        <!-- Top Indices -->
        <div class="section">
            <div class="section-header">Top Indices by Size</div>
            <div class="section-content">
                ${data.indices_analysis?.indices?.length > 0 ? `
                <table class="table">
                    <thead>
                        <tr>
                            <th>Index Name</th>
                            <th>Documents</th>
                            <th>Storage Size</th>
                            <th>Deleted Docs</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${data.indices_analysis.indices.slice(0, 15).map((index: any) => `
                        <tr>
                            <td>${index.name || 'N/A'}</td>
                            <td>${formatNumber(index.docs_count || 0)}</td>
                            <td>${formatBytes(index.store_size_bytes || 0)}</td>
                            <td>${formatNumber(index.docs_deleted || 0)}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : '<p>No index data available</p>'}
            </div>
        </div>

        <!-- Search Performance -->
        <div class="section">
            <div class="section-header">Search Performance</div>
            <div class="section-content">
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="value">${formatNumber(data.search_performance?.total_queries || 0)}</div>
                        <div class="label">Total Queries</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.search_performance?.average_query_time || 0}ms</div>
                        <div class="label">Avg Query Time</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.search_performance?.average_fetch_time || 0}ms</div>
                        <div class="label">Avg Fetch Time</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.search_performance?.current_queries || 0}</div>
                        <div class="label">Current Queries</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.search_performance?.current_eps || 0}</div>
                        <div class="label">Current EPS</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.search_performance?.peak_eps || 0}</div>
                        <div class="label">Peak EPS</div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Shards Analysis -->
        <div class="section">
            <div class="section-header">Shards Analysis</div>
            <div class="section-content">
                <div class="summary-grid">
                    <div class="summary-card">
                        <div class="value">${data.shards_analysis?.summary?.total || 0}</div>
                        <div class="label">Total Shards</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.shards_analysis?.summary?.started || 0}</div>
                        <div class="label">Started</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.shards_analysis?.summary?.unassigned || 0}</div>
                        <div class="label">Unassigned</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.shards_analysis?.summary?.relocating || 0}</div>
                        <div class="label">Relocating</div>
                    </div>
                    <div class="summary-card">
                        <div class="value">${data.shards_analysis?.summary?.initializing || 0}</div>
                        <div class="label">Initializing</div>
                    </div>
                </div>
                
                ${data.shards_analysis?.unassigned_reasons && Object.keys(data.shards_analysis.unassigned_reasons).length > 0 ? `
                <h4 style="margin-top: 20px;">Unassigned Shard Reasons:</h4>
                <table class="table">
                    <thead>
                        <tr>
                            <th>Reason</th>
                            <th>Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${Object.entries(data.shards_analysis.unassigned_reasons).map(([reason, count]) => `
                        <tr>
                            <td>${reason}</td>
                            <td>${count}</td>
                        </tr>
                        `).join('')}
                    </tbody>
                </table>
                ` : ''}
            </div>
        </div>

        <!-- Issues and Recommendations -->
        <div class="section">
            <div class="section-header">Issues and Recommendations</div>
            <div class="section-content">
                ${data.issues_and_recommendations?.issues?.length > 0 ? `
                <h4>Issues Found:</h4>
                <div class="issues-list">
                    ${data.issues_and_recommendations.issues.map((issue: any) => `
                        <div class="issue-item" style="margin-bottom: 15px; padding: 10px; border-left: 4px solid ${issue.severity === 'critical' ? '#dc3545' : '#ffc107'}; background: #f8f9fa;">
                            <h5 style="margin: 0 0 5px 0; color: ${issue.severity === 'critical' ? '#dc3545' : '#856404'};">
                                ${issue.title || 'Unknown Issue'}
                            </h5>
                            <p style="margin: 0 0 5px 0; font-size: 14px;">
                                ${issue.description || 'No description available'}
                            </p>
                            ${issue.affected_resources && issue.affected_resources.length > 0 ? `
                                <small style="color: #6c757d;">
                                    Affected: ${issue.affected_resources.join(', ')}
                                </small>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                ` : '<p>No issues found - cluster appears healthy!</p>'}

                ${data.issues_and_recommendations?.recommendations?.length > 0 ? `
                <h4 style="margin-top: 25px;">Recommendations:</h4>
                <div class="recommendations-list">
                    ${data.issues_and_recommendations.recommendations.map((rec: any) => `
                        <div class="recommendation-item" style="margin-bottom: 15px; padding: 10px; border-left: 4px solid #007bff; background: #f8f9fa;">
                            <h5 style="margin: 0 0 5px 0; color: #007bff;">
                                ${rec.title || 'Recommendation'}
                            </h5>
                            <p style="margin: 0 0 10px 0; font-size: 14px;">
                                ${rec.description || 'No description available'}
                            </p>
                            ${rec.actions && rec.actions.length > 0 ? `
                                <ul style="margin: 0; padding-left: 20px; font-size: 13px;">
                                    ${rec.actions.map((action: string) => `<li>${action}</li>`).join('')}
                                </ul>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
                ` : ''}
            </div>
        </div>
    </div>

    <div class="footer">
        Generated by IndexSphere on ${new Date().toLocaleString()} | 
        This report provides a snapshot of your Elasticsearch cluster health and performance.
    </div>
</body>
</html>
  `;
}
