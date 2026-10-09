/**
 * Server-side ClickHouse client over the HTTP interface (8123 / 8443).
 *
 * Uses sslBypassFetch, so every request gets the same SSRF guard, per-connection
 * TLS policy and timeouts as cluster traffic. Every query carries the safety
 * settings from the clickhouse-best-practices skill (agent-query-safety):
 * max_execution_time, result caps and scan caps — plus readonly=2 for
 * IndexSphere readonly users, which ClickHouse enforces itself.
 */
import { randomUUID } from 'crypto';
import { sslBypassFetch } from './ssl-bypass';
import { parseOutboundUrl } from './url-guard';
import type { UserRole } from './auth';

export interface ClickHouseConfig {
  url: string;
  username?: string;
  password?: string;
  database?: string;
  verifyTls?: boolean;
}

export interface QueryOptions {
  /** ClickHouse query parameters, referenced as {name:Type} in the SQL. */
  params?: Record<string, string | number>;
  /** Per-query settings; `null` leaves a default safety setting unset (to read profile values). */
  settings?: Record<string, string | number | null>;
  /** Caller's IndexSphere role — readonly users get server-enforced readonly=2. */
  role?: UserRole;
  database?: string;
  queryId?: string;
  /** Return 64-bit integers as JSON numbers (fine for metrics; default true). */
  numeric64?: boolean;
}

export interface QueryResult<T = Record<string, unknown>> {
  data: T[];
  meta: { name: string; type: string }[];
  rows: number;
  rowsBeforeLimit?: number;
  statistics?: { elapsed: number; rows_read: number; bytes_read: number };
  queryId: string;
}

/** Defaults for internal/system queries; the SQL workbench uses its own (see WORKBENCH_LIMITS). */
export const SAFETY_SETTINGS: Record<string, number | string> = {
  max_execution_time: 30,
  timeout_before_checking_execution_speed: 0,
  max_result_rows: 10_000,
  result_overflow_mode: 'break',
};

export class ClickHouseError extends Error {
  constructor(message: string, public code?: number, public status?: number) {
    super(message);
    this.name = 'ClickHouseError';
  }
}

export class ClickHouseClient {
  private readonly baseUrl: string;
  private readonly username: string;
  private readonly password: string;
  private readonly database?: string;
  private readonly verifyTls: boolean;

  constructor(config: ClickHouseConfig) {
    parseOutboundUrl(config.url, 'cluster');
    this.baseUrl = config.url.replace(/\/+$/, '');
    this.username = config.username || 'default';
    this.password = config.password ?? '';
    this.database = config.database;
    this.verifyTls = config.verifyTls === true;
  }

  getBaseUrl() {
    return this.baseUrl;
  }

  getUsername() {
    return this.username;
  }

  async query<T = Record<string, unknown>>(sql: string, opts: QueryOptions = {}): Promise<QueryResult<T>> {
    const queryId = opts.queryId ?? `indexsphere-${randomUUID()}`;
    const qs = new URLSearchParams();
    const settings: Record<string, string | number | null> = {
      ...SAFETY_SETTINGS,
      wait_end_of_query: 1, // buffer so errors surface as HTTP status, not mid-stream
      output_format_json_quote_64bit_integers: opts.numeric64 === false ? 1 : 0,
      ...opts.settings,
    };
    for (const [k, v] of Object.entries(settings)) if (v !== null) qs.set(k, String(v));
    // Applied last so nothing above can relax it
    if (opts.role === 'readonly') qs.set('readonly', '2');
    for (const [k, v] of Object.entries(opts.params ?? {})) qs.set(`param_${k}`, String(v));
    qs.set('default_format', 'JSON');
    qs.set('query_id', queryId);
    const db = opts.database ?? this.database;
    if (db) qs.set('database', db);

    // wait_end_of_query buffers the whole result, so the socket is silent until
    // the query ends: allow at least the query's own time limit
    const limit = Number(settings.max_execution_time);
    const response = await sslBypassFetch(`${this.baseUrl}/?${qs.toString()}`, {
      timeoutMs: limit > 45 ? (limit + 15) * 1000 : undefined,
      method: 'POST',
      body: sql,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'X-ClickHouse-User': this.username,
        'X-ClickHouse-Key': this.password,
      },
      verifyTls: this.verifyTls,
    });

    const text: string = await response.text();
    if (!response.ok) {
      const code = Number((response.headers?.['x-clickhouse-exception-code'] as string) ?? NaN);
      throw new ClickHouseError(cleanError(text), Number.isNaN(code) ? undefined : code, response.status);
    }

    if (!text.trim()) return { data: [], meta: [], rows: 0, queryId };
    try {
      const json = JSON.parse(text);
      return {
        data: json.data ?? [],
        meta: json.meta ?? [],
        rows: json.rows ?? (json.data?.length ?? 0),
        rowsBeforeLimit: json.rows_before_limit_at_least,
        statistics: json.statistics,
        queryId,
      };
    } catch {
      // Statement without a result set, or a user-specified FORMAT
      return { data: [{ result: text.slice(0, 100_000) } as unknown as T], meta: [{ name: 'result', type: 'String' }], rows: 1, queryId };
    }
  }

  /**
   * Bulk insert rows as JSONEachRow (one batch = one INSERT; the caller sizes
   * batches per insert-batch-size: 10K–100K rows). Missing/unknown fields fall
   * back to column defaults; dates are parsed best-effort (ISO 8601, epoch ms).
   */
  async insertJSONEachRow(database: string, table: string, rows: Record<string, unknown>[], role?: UserRole): Promise<void> {
    if (!rows.length) return;
    const qs = new URLSearchParams({
      query: `INSERT INTO \`${database.replace(/`/g, '')}\`.\`${table.replace(/`/g, '')}\` FORMAT JSONEachRow`,
      date_time_input_format: 'best_effort',
      input_format_skip_unknown_fields: '1',
      input_format_null_as_default: '1',
      input_format_defaults_for_omitted_fields: '1',
      max_execution_time: '300',
      wait_end_of_query: '1',
    });
    if (role === 'readonly') qs.set('readonly', '2');
    const body = rows.map(r => JSON.stringify(r)).join('\n');
    const response = await sslBypassFetch(`${this.baseUrl}/?${qs.toString()}`, {
      method: 'POST',
      body,
      headers: {
        'Content-Type': 'application/x-ndjson',
        'X-ClickHouse-User': this.username,
        'X-ClickHouse-Key': this.password,
      },
      verifyTls: this.verifyTls,
    });
    if (!response.ok) {
      const code = Number((response.headers?.['x-clickhouse-exception-code'] as string) ?? NaN);
      throw new ClickHouseError(cleanError(await response.text()), Number.isNaN(code) ? undefined : code, response.status);
    }
  }

  /**
   * Values of settings as the user's settings profile defines them. A normal
   * query would report IndexSphere's own per-query safety limits instead.
   */
  async profileSettings(names: string[], role?: UserRole): Promise<Record<string, unknown>[]> {
    const unset = Object.fromEntries(Object.keys(SAFETY_SETTINGS).map(k => [k, null]));
    const r = await this.query('SELECT name, value, changed FROM system.settings WHERE has({names:Array(String)}, name)', {
      role,
      settings: unset,
      params: { names: `[${names.map(n => `'${n.replace(/[\\']/g, '')}'`).join(',')}]` },
    });
    return r.data;
  }

  async ping(): Promise<{ version: string; uptime: number }> {
    const r = await this.query<{ version: string; uptime: number }>('SELECT version() AS version, uptime() AS uptime');
    return r.data[0];
  }
}

function cleanError(text: string): string {
  // "Code: 60. DB::Exception: Table x doesn't exist. (UNKNOWN_TABLE) (version …)" → readable message
  const m = text.match(/DB::Exception:\s*([\s\S]*?)(?:\s*\(version [^)]*\))?\s*$/);
  return (m ? m[1] : text).trim().slice(0, 1000) || 'ClickHouse request failed';
}
