/**
 * Alert Engine — evaluates cluster metrics against alert rules and fires
 * notifications (email, Slack webhook, generic webhook) when thresholds are breached.
 *
 * Called from the monitoring SSE stream and from the /api/alerts/check endpoint.
 */
import { getDatabase, AlertRule, AlertTrigger } from './database-sqlite';
import { sendEmail } from './mailer';

export interface ClusterMetrics {
  cpu_percent: number;
  heap_percent: number;
  heap_used_bytes: number;
  heap_max_bytes: number;
  gc_pressure: number;          // 0-100: % of time spent in GC
  unassigned_shards: number;
  active_shards: number;
  docs_count: number;
  indexing_rate: number;        // docs/s (delta, may be 0 if first sample)
  node_count: number;
  cluster_status: string;
}

interface NotificationChannel {
  type: 'email' | 'slack' | 'webhook';
  to?: string;
  url?: string;
}

function evaluate(rule: AlertRule, value: number): boolean {
  switch (rule.operator) {
    case 'gt':  return value > rule.threshold;
    case 'gte': return value >= rule.threshold;
    case 'lt':  return value < rule.threshold;
    case 'lte': return value <= rule.threshold;
    default:    return false;
  }
}

function metricValue(metrics: ClusterMetrics, metric: string): number {
  return (metrics as unknown as Record<string, number>)[metric] ?? 0;
}

async function sendNotifications(
  channels: NotificationChannel[],
  rule: AlertRule,
  value: number
): Promise<void> {
  const subject = `[IndexSphere ${rule.severity.toUpperCase()}] ${rule.name}`;
  const body = `Alert rule "${rule.name}" fired.\nMetric: ${rule.metric}\nValue: ${value.toFixed(2)}\nThreshold: ${rule.operator} ${rule.threshold}\nTime: ${new Date().toISOString()}`;

  for (const ch of channels) {
    try {
      if (ch.type === 'email' && ch.to) {
        await sendEmail({ to: ch.to, subject, text: body });
      } else if ((ch.type === 'slack' || ch.type === 'webhook') && ch.url) {
        const payload = ch.type === 'slack'
          ? { text: `*${subject}*\n${body}` }
          : { alert: rule.name, metric: rule.metric, value, threshold: rule.threshold, severity: rule.severity, timestamp: new Date().toISOString() };
        await fetch(ch.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(5000),
        });
      }
    } catch (err) {
      console.warn(`[alert-engine] notification channel ${ch.type} failed:`, err);
    }
  }
}

/**
 * Evaluate all active alert rules against the provided metrics snapshot.
 * Returns the list of new triggers that were recorded.
 */
export async function evaluateAlerts(metrics: ClusterMetrics): Promise<AlertTrigger[]> {
  const db = getDatabase();
  const rules = db.getAlertRules().filter(r => r.is_active);
  const newTriggers: AlertTrigger[] = [];

  for (const rule of rules) {
    const value = metricValue(metrics, rule.metric);
    if (!evaluate(rule, value)) continue;

    // De-duplicate: don't fire again within window_minutes
    const lastFired = rule.last_triggered ? new Date(rule.last_triggered).getTime() : 0;
    const cooldown = (rule.window_minutes ?? 5) * 60 * 1000;
    if (Date.now() - lastFired < cooldown) continue;

    const message = `${rule.metric} is ${value.toFixed(2)} (${rule.operator} ${rule.threshold})`;
    const trigger = db.writeAlertTrigger({
      rule_id: rule.id,
      metric: rule.metric,
      value,
      threshold: rule.threshold,
      severity: rule.severity,
      message,
    });
    newTriggers.push(trigger);

    // Send notifications asynchronously (don't await to avoid blocking the stream)
    let channels: NotificationChannel[] = [];
    try { channels = JSON.parse(rule.channels); } catch { /* ignore */ }
    if (channels.length) {
      sendNotifications(channels, rule, value).catch(console.warn);
    }
  }

  return newTriggers;
}
