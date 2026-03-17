/**
 * Scheduled report runner.
 * Parses cron expressions via node-cron and generates/emails reports on schedule.
 * Initialised as a long-lived singleton — safe in Next.js production (single process).
 */
import cron from 'node-cron';
import { getDatabase, ScheduledReport } from './database-sqlite';
import { sendEmail } from './mailer';
import { getElasticsearchClient } from './elasticsearch';

// ── Report generation helpers ────────────────────────────────────────────────
async function buildClusterHealthReport(format: string): Promise<{ content: string; contentType: string; ext: string }> {
  const client = getElasticsearchClient();
  if (!client) return { content: 'No cluster connected', contentType: 'text/plain', ext: 'txt' };

  const [health, stats, nodes] = await Promise.allSettled([
    client.getClusterHealth(),
    client.getClusterStats(),
    client.getNodes(),
  ]);

  const data = {
    generated_at: new Date().toISOString(),
    cluster_health: health.status === 'fulfilled' ? health.value : null,
    cluster_stats:  stats.status  === 'fulfilled' ? stats.value  : null,
    nodes:          nodes.status  === 'fulfilled' ? nodes.value  : null,
  };

  if (format === 'json') {
    return { content: JSON.stringify(data, null, 2), contentType: 'application/json', ext: 'json' };
  }

  // CSV: flatten health fields
  const h = (data.cluster_health as Record<string, unknown>) ?? {};
  const csvRows = [
    'field,value',
    `generated_at,${data.generated_at}`,
    `cluster_name,${h.cluster_name ?? ''}`,
    `status,${h.status ?? ''}`,
    `number_of_nodes,${h.number_of_nodes ?? ''}`,
    `active_primary_shards,${h.active_primary_shards ?? ''}`,
    `active_shards,${h.active_shards ?? ''}`,
    `unassigned_shards,${h.unassigned_shards ?? ''}`,
    `relocating_shards,${h.relocating_shards ?? ''}`,
  ];
  return { content: csvRows.join('\n'), contentType: 'text/csv', ext: 'csv' };
}

async function buildIndexStatsReport(format: string): Promise<{ content: string; contentType: string; ext: string }> {
  const client = getElasticsearchClient();
  if (!client) return { content: 'No cluster connected', contentType: 'text/plain', ext: 'txt' };

  const indices = await client.getIndices();
  const arr = Array.isArray(indices) ? indices : [];

  if (format === 'json') {
    return { content: JSON.stringify({ generated_at: new Date().toISOString(), indices: arr }, null, 2), contentType: 'application/json', ext: 'json' };
  }

  const header = 'index,health,status,pri,rep,docs.count,store.size';
  const rows = arr.map((idx: Record<string, unknown>) =>
    [idx.index, idx.health, idx.status, idx.pri, idx.rep, idx['docs.count'], idx['store.size']].join(',')
  );
  return { content: [header, ...rows].join('\n'), contentType: 'text/csv', ext: 'csv' };
}

async function generateReport(report: ScheduledReport): Promise<void> {
  const db = getDatabase();
  try {
    let result;
    switch (report.report_type) {
      case 'index_stats':
        result = await buildIndexStatsReport(report.format);
        break;
      default:
        result = await buildClusterHealthReport(report.format);
    }

    const recipients: string[] = JSON.parse(report.email_to);
    const subject = report.email_subject ?? `IndexSphere Report: ${report.name}`;
    const filename = `indexsphere-${report.report_type}-${Date.now()}.${result.ext}`;

    await sendEmail({
      to: recipients,
      subject,
      text: `Please find the scheduled report "${report.name}" attached.\n\nGenerated: ${new Date().toISOString()}`,
      attachments: [{ filename, content: result.content, contentType: result.contentType }],
    });

    db.updateScheduledReport(report.id, { last_run: new Date().toISOString(), last_status: 'success' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] report "${report.name}" failed:`, msg);
    db.updateScheduledReport(report.id, { last_run: new Date().toISOString(), last_status: `error: ${msg}` });
  }
}

// ── Scheduler singleton ──────────────────────────────────────────────────────
import type { ScheduledTask } from 'node-cron';
const scheduledTasks = new Map<string, ScheduledTask>();

export function startScheduler(): void {
  if (typeof process === 'undefined') return; // not server env

  // Tick every minute to pick up changes and run any due reports
  cron.schedule('* * * * *', async () => {
    const db = getDatabase();
    const reports = db.getScheduledReports().filter(r => r.is_active);

    for (const report of reports) {
      if (!scheduledTasks.has(report.id)) {
        // Only create task if expression is valid
        if (!cron.validate(report.cron_expression)) continue;

        const task = cron.schedule(report.cron_expression, () => generateReport(report));
        scheduledTasks.set(report.id, task);
      }
    }

    // Remove tasks for deleted/disabled reports
    for (const [id, task] of scheduledTasks.entries()) {
      const report = reports.find(r => r.id === id);
      if (!report) {
        task.stop();
        scheduledTasks.delete(id);
      }
    }
  });
}

/** Run a specific scheduled report immediately (for "Run Now" button). */
export async function runReportNow(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const report = getDatabase().getScheduledReportById(reportId);
  if (!report) return { ok: false, error: 'Report not found' };
  try {
    await generateReport(report);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// Auto-start when this module is imported in the server context
if (typeof window === 'undefined') {
  startScheduler();
}
