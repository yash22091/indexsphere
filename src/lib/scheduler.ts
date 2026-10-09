/**
 * Scheduled report runner.
 * Parses cron expressions via node-cron and generates/emails reports on schedule.
 * Initialised as a long-lived singleton — safe in Next.js production (single process).
 */
import cron from 'node-cron';
import { getDatabase, ScheduledReport } from './database-sqlite';
import { sendEmail } from './mailer';
import { csvRow } from './csv';
import { ElasticsearchClient } from './elasticsearch';
import {
  clickHouseConfigFromSavedConnection, configFromSavedConnection, openClickHouseClient, openClusterClient,
} from './cluster-session';
import { captureClickHouseSnapshot, captureSearchSnapshot } from './drift';
import { recordSnapshot } from './drift-store';
import { refreshFeeds } from './vuln-intel';

/**
 * Background jobs have no user session: each report runs against the saved
 * connection it was created for — never against some user's live session.
 */
async function clientForReport(report: ScheduledReport): Promise<ElasticsearchClient> {
  if (!report.connection_id) throw new Error('Report has no saved connection configured');
  const conn = getDatabase().getSavedConnectionById(report.connection_id);
  if (!conn || !conn.is_active || conn.engine === 'clickhouse') {
    throw new Error('Saved Elasticsearch/OpenSearch connection for this report no longer exists or is disabled');
  }
  return openClusterClient(configFromSavedConnection(conn));
}

// ── Report generation helpers ────────────────────────────────────────────────
async function buildClusterHealthReport(client: ElasticsearchClient, format: string): Promise<{ content: string; contentType: string; ext: string }> {
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
    csvRow(['generated_at', data.generated_at]),
    ...(['cluster_name', 'status', 'number_of_nodes', 'active_primary_shards', 'active_shards', 'unassigned_shards', 'relocating_shards'] as const)
      .map(k => csvRow([k, h[k] ?? ''])),
  ];
  return { content: csvRows.join('\n'), contentType: 'text/csv', ext: 'csv' };
}

async function buildIndexStatsReport(client: ElasticsearchClient, format: string): Promise<{ content: string; contentType: string; ext: string }> {
  const indices = await client.getIndices();
  const arr = Array.isArray(indices) ? indices : [];

  if (format === 'json') {
    return { content: JSON.stringify({ generated_at: new Date().toISOString(), indices: arr }, null, 2), contentType: 'application/json', ext: 'json' };
  }

  const header = 'index,health,status,pri,rep,docs.count,store.size';
  const rows = arr.map((idx: Record<string, unknown>) =>
    csvRow([idx.index, idx.health, idx.status, idx.pri, idx.rep, idx['docs.count'], idx['store.size']])
  );
  return { content: [header, ...rows].join('\n'), contentType: 'text/csv', ext: 'csv' };
}

async function generateReport(report: ScheduledReport): Promise<void> {
  const db = getDatabase();
  try {
    const client = await clientForReport(report);
    let result;
    switch (report.report_type) {
      case 'index_stats':
        result = await buildIndexStatsReport(client, report.format);
        break;
      default:
        result = await buildClusterHealthReport(client, report.format);
    }

    const recipients: string[] = JSON.parse(report.email_to);
    const subject = report.email_subject ?? `IndexSphere Report: ${report.name}`;
    const filename = `indexsphere-${report.report_type}-${Date.now()}.${result.ext}`;

    const sent = await sendEmail({
      to: recipients,
      subject,
      text: `Please find the scheduled report "${report.name}" attached.\n\nGenerated: ${new Date().toISOString()}`,
      attachments: [{ filename, content: result.content, contentType: result.contentType }],
    });
    // The report was built but not delivered — record that, don't claim success
    if (!sent.ok) throw new Error(`email delivery failed: ${sent.error ?? 'unknown error'} (check Settings → Email / SMTP)`);

    db.updateScheduledReport(report.id, { last_run: new Date().toISOString(), last_status: 'success' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[scheduler] report "${report.name}" failed:`, msg);
    db.updateScheduledReport(report.id, { last_run: new Date().toISOString(), last_status: `error: ${msg}` });
  }
}

// ── Scheduler singleton ──────────────────────────────────────────────────────
import type { ScheduledTask } from 'node-cron';

interface SchedulerState {
  started: boolean;
  tasks: Map<string, { task: ScheduledTask; expr: string }>;
  running: Set<string>;
}

// Process-wide state on globalThis: Next.js bundles each route separately, so a
// module-level flag would let every bundle start its own copy of every job.
const STATE_KEY = '__INDEXSPHERE_SCHEDULER__';
function state(): SchedulerState {
  const g = globalThis as unknown as Record<string, SchedulerState>;
  if (!g[STATE_KEY]) g[STATE_KEY] = { started: false, tasks: new Map(), running: new Set() };
  return g[STATE_KEY];
}

/** Run a report unless the previous run of the same report is still in progress. */
async function runExclusive(reportId: string, evenIfInactive = false): Promise<boolean> {
  const st = state();
  if (st.running.has(reportId)) {
    console.warn(`[scheduler] report ${reportId} still running — skipping this tick`);
    return false;
  }
  st.running.add(reportId);
  try {
    // Re-read at fire time so edits (recipients, connection) take effect
    const current = getDatabase().getScheduledReportById(reportId);
    if (current && (current.is_active || evenIfInactive)) await generateReport(current);
    return true;
  } finally {
    st.running.delete(reportId);
  }
}

function syncReportTasks(): void {
  const st = state();
  const reports = getDatabase().getScheduledReports().filter(r => r.is_active && cron.validate(r.cron_expression));
  const wanted = new Map(reports.map(r => [r.id, r.cron_expression]));

  for (const [id, entry] of st.tasks) {
    // Deleted, disabled or rescheduled → stop the old task
    if (wanted.get(id) !== entry.expr) {
      entry.task.stop();
      st.tasks.delete(id);
    }
  }
  for (const [id, expr] of wanted) {
    if (!st.tasks.has(id)) {
      st.tasks.set(id, { task: cron.schedule(expr, () => { runExclusive(id).catch(console.error); }), expr });
    }
  }
}

/** Start background jobs once per process (called from instrumentation.ts). */
export function startScheduler(): void {
  const st = state();
  if (st.started) return;
  st.started = true;

  // Pick up new/edited/deleted scheduled reports every minute
  syncReportTasks();
  cron.schedule('* * * * *', () => {
    try { syncReportTasks(); } catch (err) { console.error('[scheduler] sync failed:', err); }
  });

  // Daily refresh of vulnerability feeds (NVD / CISA KEV) so lookups stay fast and current
  cron.schedule('17 3 * * *', () => {
    refreshFeeds().catch(err => console.warn('[scheduler] vulnerability feed refresh failed:', err instanceof Error ? err.message : err));
  });

  // Daily retention: audit log, alert triggers, stale intel cache
  cron.schedule('41 3 * * *', () => {
    try {
      const auditDays = Number(process.env.AUDIT_RETENTION_DAYS ?? 90) || 90;
      const triggerDays = Number(process.env.ALERT_TRIGGER_RETENTION_DAYS ?? 90) || 90;
      const removed = getDatabase().pruneOldData(auditDays, triggerDays);
      console.log('[scheduler] retention:', removed);
    } catch (err) {
      console.error('[scheduler] retention failed:', err);
    }
  });

  // Daily configuration snapshots of every active saved connection (drift detection)
  if (process.env.DRIFT_SNAPSHOTS_DISABLED !== 'true') {
    const expr = process.env.DRIFT_SNAPSHOT_CRON ?? '30 2 * * *';
    if (cron.validate(expr)) cron.schedule(expr, () => { snapshotAllConnections().catch(err => console.error('[scheduler] drift snapshots failed:', err)); });
  }

  console.log('[scheduler] started');
}

/** Capture a configuration snapshot of each active saved connection, one at a time. */
export async function snapshotAllConnections(): Promise<void> {
  for (const conn of getDatabase().getSavedConnections().filter(c => c.is_active)) {
    try {
      const snap = conn.engine === 'clickhouse'
        ? await (async () => {
            const { client, version } = await openClickHouseClient(clickHouseConfigFromSavedConnection(conn));
            return captureClickHouseSnapshot(client, 'readonly', version); // reads only: enforce readonly=2
          })()
        : await captureSearchSnapshot(await openClusterClient(configFromSavedConnection(conn)));
      const r = recordSnapshot(conn.id, conn.name, 'scheduler', snap);
      if (r.changed) console.log(`[drift] ${conn.name}: ${r.changes} configuration change(s) detected`);
    } catch (err) {
      console.warn(`[drift] snapshot of ${conn.name} failed:`, err instanceof Error ? err.message : err);
    }
  }
}

/** Run a specific scheduled report immediately (for "Run Now" button). */
export async function runReportNow(reportId: string): Promise<{ ok: boolean; error?: string }> {
  const report = getDatabase().getScheduledReportById(reportId);
  if (!report) return { ok: false, error: 'Report not found' };
  try {
    const ran = await runExclusive(report.id, true);
    return ran ? { ok: true } : { ok: false, error: 'This report is already running' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
