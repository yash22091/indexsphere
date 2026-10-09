/**
 * Background Elasticsearch/OpenSearch → ClickHouse data copy.
 *
 * Reads the source with the scroll API (supported by both Elasticsearch and
 * OpenSearch), flattens each document to the planned columns and inserts into
 * ClickHouse as JSONEachRow in batches (insert-batch-size: 10K–100K rows).
 * Only one insert batch is held in memory at a time. At most
 * MIGRATION_MAX_CONCURRENCY jobs run at once; progress is persisted to SQLite
 * so the UI can poll it, and jobs can be cancelled between batches.
 */
import { randomUUID } from 'crypto';
import type { ElasticsearchClient } from './elasticsearch';
import type { ClickHouseClient } from './clickhouse';
import type { UserRole } from './auth';
import type { ColumnPlan } from './es-to-clickhouse';
import { getDatabase, MigrationJob } from './database-sqlite';
import { namedSemaphore } from './concurrency';
import { ClickHouseError } from './clickhouse';

const SCROLL_PAGE = 5_000;          // ES page size (well under max_result_window)
const SCROLL_KEEPALIVE = '5m';

// ── Pure transform (unit-tested) ─────────────────────────────────────────────

function getPath(source: unknown, path: string): unknown {
  // Documents may hold the field nested ({a:{b:1}}) or with a dotted key ({"a.b":1})
  if (source && typeof source === 'object' && path in (source as object)) return (source as Record<string, unknown>)[path];
  let cur: unknown = source;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined) return undefined;
    if (Array.isArray(cur)) cur = cur[0];
    if (typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function scalar(type: string, value: unknown): unknown {
  if (value === null || value === undefined) return undefined;
  if (Array.isArray(value)) {
    if (!value.length) return undefined;
    // Scalar column, multi-valued field: strings keep every value, others take the first
    if (/String/.test(type) && value.length > 1) return value.map(v => (typeof v === 'object' ? JSON.stringify(v) : String(v))).join(', ');
    value = value[0];
  }
  if (type === 'Point') {
    // geo_point: {lat,lon} | "lat,lon" | [lon,lat]
    if (typeof value === 'string') { const [lat, lon] = value.split(',').map(Number); return [lon, lat]; }
    if (value && typeof value === 'object' && 'lat' in (value as object)) {
      const v = value as { lat: number; lon: number };
      return [Number(v.lon), Number(v.lat)];
    }
    return undefined;
  }
  if (type === 'JSON') return typeof value === 'object' ? value : { value };
  if (/String/.test(type) && typeof value === 'object') return JSON.stringify(value);
  if (/^DateTime64/.test(type) && typeof value === 'number') return new Date(value).toISOString();
  if (type === 'Bool') return value === true || value === 'true' || value === 1;
  return value;
}

/** Flatten one ES document to a ClickHouse row following the plan's columns. */
export function toRow(source: unknown, columns: Pick<ColumnPlan, 'source' | 'column' | 'type'>[]): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  for (const c of columns) {
    // the plan strips a leading "@" from column names but the source path keeps it
    const v = scalar(c.type, getPath(source, c.source));
    if (v !== undefined) row[c.column] = v;
  }
  return row;
}

// ── Transient-failure retry ──────────────────────────────────────────────────

/**
 * ClickHouse errors worth retrying: server memory pressure, too many
 * simultaneous queries/parts, timeouts and dropped connections. A batch is a
 * single INSERT block (≤ max_insert_block_size rows), so a failed insert wrote
 * nothing and retrying it cannot duplicate rows.
 */
const TRANSIENT_CH_CODES = new Set([241, 202, 252, 159, 209, 210, 242, 425, 999]);

export function isTransient(err: unknown): boolean {
  if (err instanceof ClickHouseError) {
    return (err.code !== undefined && TRANSIENT_CH_CODES.has(err.code)) || (err.status !== undefined && err.status >= 500 && err.code === undefined);
  }
  const msg = err instanceof Error ? err.message : String(err);
  // Elasticsearch/OpenSearch throttling and network blips
  return /\b(429|502|503|504)\b|ECONNRESET|ETIMEDOUT|EPIPE|socket hang up|timed out|es_rejected_execution/i.test(msg);
}

export async function withRetry<T>(fn: () => Promise<T>, opts: { attempts?: number; baseMs?: number; isCancelled?: () => boolean } = {}): Promise<T> {
  const attempts = opts.attempts ?? 6;
  const base = opts.baseMs ?? 1000;
  for (let i = 1; ; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i >= attempts || !isTransient(err) || opts.isCancelled?.()) throw err;
      // 1s, 2s, 4s, 8s, 16s (+ jitter): gives a struggling server room to recover
      await new Promise(r => setTimeout(r, base * 2 ** (i - 1) + Math.random() * 250));
    }
  }
}

// ── Job runner ───────────────────────────────────────────────────────────────

interface Running { cancel: boolean }
const RUNNING_KEY = '__INDEXSPHERE_MIGRATIONS__';
function running(): Map<string, Running> {
  const g = globalThis as unknown as Record<string, Map<string, Running>>;
  if (!g[RUNNING_KEY]) g[RUNNING_KEY] = new Map();
  return g[RUNNING_KEY];
}

export interface StartOptions {
  userId: string;
  role: UserRole;
  es: ElasticsearchClient;
  ch: ClickHouseClient;
  index: string;
  database: string;
  table: string;
  columns: ColumnPlan[];
  insertBatch: number;   // rows per INSERT
  maxDocs?: number;
}

export function startMigrationJob(opts: StartOptions): MigrationJob {
  const db = getDatabase();
  const job = db.createMigrationJob({
    id: `mig-${randomUUID()}`,
    created_by: opts.userId,
    source_index: opts.index,
    target_table: `${opts.database}.${opts.table}`,
    batch_size: opts.insertBatch,
    max_docs: opts.maxDocs ?? null,
  });
  running().set(job.id, { cancel: false });
  // Detached: the HTTP request returns immediately; progress is polled
  void runJob(job.id, opts).finally(() => running().delete(job.id));
  return job;
}

export function cancelMigrationJob(id: string): boolean {
  const r = running().get(id);
  if (!r) return false;
  r.cancel = true;
  return true;
}

async function runJob(id: string, o: StartOptions): Promise<void> {
  const db = getDatabase();
  const sem = namedSemaphore('migration', Number(process.env.MIGRATION_MAX_CONCURRENCY ?? 2) || 2);
  let release: (() => void) | null = null;
  let scrollId: string | null = null;
  const indexPath = `/${encodeURIComponent(o.index).replace(/%2A/gi, '*').replace(/%2C/gi, ',')}`;
  const fq = { db: o.database, t: o.table };

  try {
    release = await sem.acquire(10 * 60_000);
    if (running().get(id)?.cancel) throw new CancelledError();
    db.updateMigrationJob(id, { status: 'running' });

    const countRes = await o.es.request(`${indexPath}/_count`) as { count?: number };
    const total = Math.min(countRes.count ?? 0, o.maxDocs ?? Infinity);
    const before = Number((await o.ch.query<{ c: number }>(
      'SELECT count() AS c FROM {db:Identifier}.{t:Identifier}', { params: fq, role: o.role })).data[0]?.c ?? 0);
    db.updateMigrationJob(id, { total_docs: total });

    const sourceFields = [...new Set(o.columns.map(c => c.source))];
    let page = await o.es.request(`${indexPath}/_search?scroll=${SCROLL_KEEPALIVE}`, {
      method: 'POST',
      body: JSON.stringify({ size: Math.min(SCROLL_PAGE, o.insertBatch), sort: ['_doc'], _source: sourceFields }),
    }) as { _scroll_id?: string; hits?: { hits?: { _source?: unknown }[] } };

    let read = 0;
    let inserted = 0;
    let buffer: Record<string, unknown>[] = [];
    const started = Date.now();

    const isCancelled = () => !!running().get(id)?.cancel;
    const flush = async () => {
      if (!buffer.length) return;
      await withRetry(() => o.ch.insertJSONEachRow(o.database, o.table, buffer, o.role), { isCancelled });
      inserted += buffer.length;
      buffer = [];
      db.updateMigrationJob(id, { read_docs: read, inserted_rows: inserted });
    };

    for (;;) {
      scrollId = page._scroll_id ?? scrollId;
      const hits = page.hits?.hits ?? [];
      if (!hits.length) break;
      for (const h of hits) {
        if (read >= total) break;
        buffer.push(toRow(h._source ?? {}, o.columns));
        read++;
      }
      if (buffer.length >= o.insertBatch) await flush();
      else db.updateMigrationJob(id, { read_docs: read });
      if (running().get(id)?.cancel) throw new CancelledError();
      if (read >= total) break;
      page = await withRetry(() => o.es.request('/_search/scroll', {
        method: 'POST',
        body: JSON.stringify({ scroll: SCROLL_KEEPALIVE, scroll_id: scrollId }),
      }), { isCancelled }) as typeof page;
    }
    await flush();

    // ── Verification + storage comparison ────────────────────────────────────
    const after = Number((await o.ch.query<{ c: number }>(
      'SELECT count() AS c FROM {db:Identifier}.{t:Identifier}', { params: fq, role: o.role })).data[0]?.c ?? 0);
    let esBytes = 0;
    try {
      const cat = await o.es.request(`/_cat/indices${indexPath}?format=json&bytes=b&h=pri.store.size`) as { 'pri.store.size'?: string }[];
      esBytes = cat.reduce((s, r) => s + Number(r['pri.store.size'] ?? 0), 0);
    } catch { /* optional */ }
    const chStats = (await o.ch.query<{ compressed: number; uncompressed: number }>(
      `SELECT sum(data_compressed_bytes) AS compressed, sum(data_uncompressed_bytes) AS uncompressed
       FROM system.parts WHERE active AND database = {db:String} AND table = {t:String}`,
      { params: fq, role: o.role })).data[0] ?? { compressed: 0, uncompressed: 0 };

    const result = {
      sourceDocs: total,
      rowsAdded: after - before,
      parity: after - before === inserted && inserted === read,
      esPrimaryBytes: esBytes,
      chCompressedBytes: Number(chStats.compressed),
      chUncompressedBytes: Number(chStats.uncompressed),
      storageRatio: Number(chStats.compressed) > 0 && esBytes > 0 ? esBytes / Number(chStats.compressed) : null,
      durationSec: Math.round((Date.now() - started) / 1000),
      rowsPerSec: Math.round(inserted / Math.max(1, (Date.now() - started) / 1000)),
    };
    db.updateMigrationJob(id, {
      status: 'completed', read_docs: read, inserted_rows: inserted, finished_at: new Date().toISOString(), result: JSON.stringify(result),
    });
  } catch (err) {
    const cancelled = err instanceof CancelledError;
    db.updateMigrationJob(id, {
      status: cancelled ? 'cancelled' : 'failed',
      finished_at: new Date().toISOString(),
      error: cancelled ? null : (err instanceof Error ? err.message : String(err)).slice(0, 2000),
    });
  } finally {
    release?.();
    if (scrollId) {
      // Free the scroll context on the cluster
      o.es.request('/_search/scroll', { method: 'DELETE', body: JSON.stringify({ scroll_id: scrollId }) }).catch(() => {});
    }
  }
}

class CancelledError extends Error {}
