/**
 * ClickHouse Table Advisor — grades tables against the ClickHouse best-practice
 * rules (github.com/ClickHouse/agent-skills, skills/clickhouse-best-practices).
 * Every finding cites the rule it comes from.
 *
 * Collection (collectTableFacts) reads only system tables, plus — in "deep"
 * mode for a single table — sampled statistics bounded by scan caps.
 * Scoring (scoreTable) is pure so it can be unit-tested.
 */
import { ClickHouseClient } from './clickhouse';
import { quoteIdent } from './clickhouse-sql';
import type { UserRole } from './auth';

export type Severity = 'critical' | 'warning' | 'info';

export interface AdvisorFinding {
  rule: string;           // rule name from the skill, or 'general-guidance'
  severity: Severity;
  message: string;
  fix?: string;
}

export interface ColumnFact {
  name: string;
  type: string;
  inSortingKey: boolean;
  inPartitionKey: boolean;
  compressed: number;
  uncompressed: number;
}

export interface DeepColumnStats {
  /** approximate distinct values (sampled) */
  uniq?: number;
  /** min/max for integer columns */
  min?: number;
  max?: number;
}

export interface TableFacts {
  database: string;
  table: string;
  engine: string;
  engineFull: string;
  sortingKey: string;
  partitionKey: string;
  totalRows: number;
  totalBytes: number;
  columns: ColumnFact[];
  activeParts: number;
  partitions: number;
  maxPartsPerPartition: number;
  skipIndexCount: number;
  pendingMutations: number;
  recentMutations: number;        // last 7 days (ALTER UPDATE/DELETE)
  insertQueries24h?: number;      // undefined when query_log is unavailable
  avgRowsPerInsert24h?: number;
  optimizeFinal7d?: number;
  fullScanQueries24h?: number;    // SELECTs reading > 50% of the table
  selectQueries24h?: number;
  deep?: Record<string, DeepColumnStats>;
}

export interface TableScore {
  database: string;
  table: string;
  engine: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  findings: AdvisorFinding[];
  metrics: {
    rows: number;
    bytes: number;
    compressionRatio: number;
    activeParts: number;
    partitions: number;
    columns: number;
  };
  deepAnalyzed: boolean;
}

const MERGETREE = /MergeTree/;
const PENALTY: Record<Severity, number> = { critical: 30, warning: 12, info: 3 };

function fqName(f: Pick<TableFacts, 'database' | 'table'>) {
  return `${quoteIdent(f.database)}.${quoteIdent(f.table)}`;
}

function baseType(type: string): string {
  return type.replace(/^LowCardinality\((.*)\)$/, '$1').replace(/^Nullable\((.*)\)$/, '$1');
}

function keyColumns(expr: string): string[] {
  return expr.split(',').map(s => s.trim().replace(/^`|`$/g, '')).filter(Boolean);
}

const TIME_NAME = /(^|_)(time|timestamp|ts|dt|date|datetime|created|created_at|updated_at|event_time|@timestamp)$/i;
const IP_NAME = /(^|_)(ip|ip_address|ipaddr|src_ip|dst_ip|client_ip|remote_addr)$/i;
const UUID_NAME = /(^|_)uuid$/i;

export function scoreTable(f: TableFacts): TableScore {
  const findings: AdvisorFinding[] = [];
  const name = fqName(f);
  const isMergeTree = MERGETREE.test(f.engine);
  const bytesUncompressed = f.columns.reduce((s, c) => s + c.uncompressed, 0);
  const bytesCompressed = f.columns.reduce((s, c) => s + c.compressed, 0);

  if (isMergeTree) {
    // ── Primary key ─────────────────────────────────────────────────────────
    const keys = keyColumns(f.sortingKey);
    if (!f.sortingKey || f.sortingKey === 'tuple()' || keys.length === 0) {
      findings.push({
        rule: 'schema-pk-plan-before-creation',
        severity: f.totalRows > 1_000_000 ? 'critical' : 'warning',
        message: 'No ORDER BY key — every query scans the full table. ORDER BY is immutable, so the table must be recreated.',
        fix: `-- Choose ORDER BY from your most common filters, low → high cardinality\nCREATE TABLE ${f.database}.${f.table}_new AS ${name}\nENGINE = MergeTree ORDER BY (/* low_card_col, …, timestamp */);\nINSERT INTO ${f.database}.${f.table}_new SELECT * FROM ${name};\nEXCHANGE TABLES ${name} AND ${f.database}.${f.table}_new;`,
      });
    } else {
      const firstCol = f.columns.find(c => c.name === keys[0]);
      if (firstCol && keys.length > 1 && /^DateTime|^Date/.test(baseType(firstCol.type))) {
        findings.push({
          rule: 'schema-pk-cardinality-order',
          severity: 'warning',
          message: `ORDER BY starts with high-cardinality timestamp "${keys[0]}", so the following key columns (${keys.slice(1).join(', ')}) barely help the index. Order key columns low → high cardinality.`,
          fix: `-- e.g. ORDER BY (${keys.slice(1).join(', ')}, ${keys[0]}) — requires recreating the table (schema-pk-plan-before-creation)`,
        });
      }
      if (f.deep) {
        const card = keys.map(k => ({ k, u: f.deep?.[k]?.uniq })).filter(x => x.u !== undefined) as { k: string; u: number }[];
        for (let i = 1; i < card.length; i++) {
          if (card[i].u * 10 < card[i - 1].u) {
            findings.push({
              rule: 'schema-pk-cardinality-order',
              severity: 'warning',
              message: `Key column "${card[i].k}" (~${card[i].u} distinct) comes after "${card[i - 1].k}" (~${card[i - 1].u} distinct). Lower-cardinality columns should come first.`,
            });
            break;
          }
        }
      }
    }

    if (f.selectQueries24h && f.fullScanQueries24h && f.totalRows > 1_000_000) {
      const pct = Math.round((f.fullScanQueries24h / f.selectQueries24h) * 100);
      if (pct >= 30) {
        findings.push({
          rule: 'schema-pk-filter-on-orderby',
          severity: pct >= 60 ? 'warning' : 'info',
          message: `${f.fullScanQueries24h} of ${f.selectQueries24h} queries in the last 24h (${pct}%) read more than half the table — their filters don't use the ORDER BY prefix (${f.sortingKey || 'none'}).` +
            (f.skipIndexCount === 0 ? ' No data-skipping indices exist either (query-index-skipping-indices).' : ''),
          fix: `-- Find the offending queries\nSELECT normalized_query_hash, any(query), count() c, avg(read_rows)\nFROM system.query_log\nWHERE type = 'QueryFinish' AND has(tables, '${f.database}.${f.table}') AND event_time > now() - INTERVAL 1 DAY\nGROUP BY normalized_query_hash ORDER BY c DESC LIMIT 20;\n-- For frequent filters on non-key columns:\nALTER TABLE ${name} ADD INDEX idx_<col> <col> TYPE bloom_filter GRANULARITY 4;\nALTER TABLE ${name} MATERIALIZE INDEX idx_<col>;`,
        });
      }
    }

    // ── Partitioning ────────────────────────────────────────────────────────
    if (f.partitions > 1000) {
      findings.push({
        rule: 'schema-partition-low-cardinality',
        severity: 'critical',
        message: `${f.partitions} partitions (keep 100–1,000). Too many partitions explode part counts and slow inserts and merges.`,
        fix: `-- Use a coarser partition key, e.g. PARTITION BY toYYYYMM(<date_col>) instead of ${f.partitionKey}`,
      });
    } else if (f.partitions > 100 && f.totalBytes < 50 * 1024 ** 3) {
      findings.push({
        rule: 'schema-partition-start-without',
        severity: 'info',
        message: `${f.partitions} partitions for only ${formatBytes(f.totalBytes)}. Partitioning is for data lifecycle (schema-partition-lifecycle), not query speed — a coarser key or none may serve better.`,
      });
    }

    // ── Parts / insert batching ─────────────────────────────────────────────
    if (f.maxPartsPerPartition > 300) {
      findings.push({
        rule: 'insert-batch-size',
        severity: f.maxPartsPerPartition > 1000 ? 'critical' : 'warning',
        message: `Up to ${f.maxPartsPerPartition} active parts in one partition — inserts are too small/frequent for merges to keep up (risk of "Too many parts").`,
        fix: '-- Batch 10K–100K rows per INSERT, or let the server batch:\nSET async_insert = 1, wait_for_async_insert = 1;',
      });
    }
    if (f.insertQueries24h !== undefined && f.insertQueries24h > 1000 && (f.avgRowsPerInsert24h ?? 0) < 1000) {
      findings.push({
        rule: 'insert-async-small-batches',
        severity: 'warning',
        message: `${f.insertQueries24h} INSERTs in 24h averaging ${Math.round(f.avgRowsPerInsert24h ?? 0)} rows. Batch 10K–100K rows per insert (insert-batch-size) or enable async inserts.`,
        fix: `-- Server-side batching for many small producers\nALTER USER <ingest_user> SETTINGS async_insert = 1, wait_for_async_insert = 1;`,
      });
    }

    // ── Mutations / OPTIMIZE ────────────────────────────────────────────────
    if (f.pendingMutations > 0 || f.recentMutations > 10) {
      findings.push({
        rule: 'insert-mutation-avoid-update',
        severity: f.pendingMutations > 5 ? 'critical' : 'warning',
        message: `${f.pendingMutations} pending and ${f.recentMutations} recent mutations (ALTER UPDATE/DELETE). Mutations rewrite whole parts; use ReplacingMergeTree / CollapsingMergeTree for updates, lightweight DELETE or DROP PARTITION for deletes (insert-mutation-avoid-delete).`,
        fix: `SELECT mutation_id, command, parts_to_do, latest_fail_reason FROM system.mutations\nWHERE database = '${f.database}' AND table = '${f.table}' AND NOT is_done;`,
      });
    }
    if ((f.optimizeFinal7d ?? 0) > 0) {
      findings.push({
        rule: 'insert-optimize-avoid-final',
        severity: (f.optimizeFinal7d ?? 0) > 7 ? 'warning' : 'info',
        message: `OPTIMIZE … FINAL ran ${f.optimizeFinal7d} time(s) in 7 days. It rewrites all data; let background merges work and use FINAL/argMax at query time instead.`,
      });
    }

    // ── Engine-specific ─────────────────────────────────────────────────────
    if (/^ReplacingMergeTree/.test(f.engine) && /ReplacingMergeTree\(\s*\)/.test(f.engineFull)) {
      findings.push({
        rule: 'insert-mutation-avoid-update',
        severity: 'info',
        message: 'ReplacingMergeTree without a version column keeps an arbitrary row among duplicates. Add a version column so the latest row wins deterministically.',
        fix: 'ENGINE = ReplacingMergeTree(updated_at)  -- or a UInt64 version',
      });
    }
  }

  // ── Column types ──────────────────────────────────────────────────────────
  const nullable = f.columns.filter(c => /^(LowCardinality\()?Nullable\(/.test(c.type));
  if (nullable.length) {
    const inKey = nullable.filter(c => c.inSortingKey);
    findings.push({
      rule: 'schema-types-avoid-nullable',
      severity: inKey.length ? 'warning' : 'info',
      message: `${nullable.length} Nullable column(s): ${nullable.slice(0, 6).map(c => c.name).join(', ')}${nullable.length > 6 ? ', …' : ''}. Nullable adds a separate null-map column; prefer non-null types with DEFAULT.`,
      fix: nullable.slice(0, 3).map(c => `ALTER TABLE ${name} MODIFY COLUMN ${quoteIdent(c.name)} ${baseType(c.type)} DEFAULT ${defaultFor(baseType(c.type))};  -- after replacing NULLs`).join('\n'),
    });
  }

  for (const c of f.columns) {
    const t = baseType(c.type);
    if (t !== 'String') continue;
    if (TIME_NAME.test(c.name)) {
      findings.push({
        rule: 'schema-types-native-types',
        severity: 'warning',
        message: `"${c.name}" looks like a timestamp but is stored as String — DateTime/DateTime64 is smaller, faster to filter and enables time functions.`,
        fix: `ALTER TABLE ${name} MODIFY COLUMN ${quoteIdent(c.name)} DateTime64(3);  -- verify all values parse first`,
      });
    } else if (IP_NAME.test(c.name)) {
      findings.push({
        rule: 'schema-types-native-types',
        severity: 'info',
        message: `"${c.name}" looks like an IP address stored as String — IPv4/IPv6 types are 4–16 bytes and support range functions.`,
        fix: `ALTER TABLE ${name} MODIFY COLUMN ${quoteIdent(c.name)} IPv6;  -- IPv6 also stores IPv4-mapped addresses`,
      });
    } else if (UUID_NAME.test(c.name)) {
      findings.push({
        rule: 'schema-types-native-types',
        severity: 'info',
        message: `"${c.name}" looks like a UUID stored as String — the UUID type uses 16 bytes instead of 36+.`,
      });
    }
  }

  if (f.deep) {
    const lowCard = f.columns.filter(c => c.type === 'String' && (f.deep?.[c.name]?.uniq ?? Infinity) < 10_000);
    if (lowCard.length) {
      findings.push({
        rule: 'schema-types-lowcardinality',
        severity: 'warning',
        message: `${lowCard.length} String column(s) have < 10K distinct values: ${lowCard.slice(0, 6).map(c => `${c.name} (~${f.deep?.[c.name]?.uniq})`).join(', ')}. LowCardinality(String) dictionary-encodes them.`,
        fix: lowCard.slice(0, 6).map(c => `ALTER TABLE ${name} MODIFY COLUMN ${quoteIdent(c.name)} LowCardinality(String);`).join('\n'),
      });
    }
    const oversized = f.columns.filter(c => /^U?Int(64|128|256)$/.test(baseType(c.type)) && f.deep?.[c.name]?.max !== undefined)
      .map(c => ({ c, fit: smallestIntType(f.deep![c.name].min ?? 0, f.deep![c.name].max!) }))
      .filter(x => x.fit && x.fit !== baseType(x.c.type));
    if (oversized.length) {
      findings.push({
        rule: 'schema-types-minimize-bitwidth',
        severity: 'info',
        message: `${oversized.length} integer column(s) use more bits than their values need: ${oversized.slice(0, 6).map(x => `${x.c.name} ${baseType(x.c.type)} → ${x.fit}`).join(', ')}.`,
        fix: oversized.slice(0, 6).map(x => `ALTER TABLE ${name} MODIFY COLUMN ${quoteIdent(x.c.name)} ${x.fit};`).join('\n'),
      });
    }
  }

  const jsonish = f.columns.filter(c => baseType(c.type) === 'String' && /(^|_)(json|raw|payload|full_log|original)$/i.test(c.name));
  if (jsonish.length) {
    findings.push({
      rule: 'schema-json-when-to-use',
      severity: 'info',
      message: `${jsonish.map(c => c.name).join(', ')} look like raw/JSON blobs. Extract frequently queried fields into typed columns (or MATERIALIZED columns); use the JSON type only for genuinely dynamic structure.`,
    });
  }

  const ratio = bytesCompressed > 0 ? bytesUncompressed / bytesCompressed : 0;
  if (isMergeTree && bytesCompressed > 1024 ** 3 && ratio > 0 && ratio < 2) {
    findings.push({
      rule: 'general-guidance',
      severity: 'info',
      message: `Compression ratio is only ${ratio.toFixed(1)}x. Better ORDER BY locality, narrower types or codecs (Delta/DoubleDelta for timestamps, ZSTD for text) usually improve it.`,
    });
  }

  const penalty = findings.reduce((s, x) => s + PENALTY[x.severity], 0);
  const score = Math.max(0, 100 - penalty);
  return {
    database: f.database,
    table: f.table,
    engine: f.engine,
    score,
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 65 ? 'C' : score >= 50 ? 'D' : 'F',
    findings: findings.sort((a, b) => PENALTY[b.severity] - PENALTY[a.severity]),
    metrics: {
      rows: f.totalRows,
      bytes: f.totalBytes,
      compressionRatio: Math.round(ratio * 10) / 10,
      activeParts: f.activeParts,
      partitions: f.partitions,
      columns: f.columns.length,
    },
    deepAnalyzed: !!f.deep,
  };
}

export function smallestIntType(min: number, max: number): string | null {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (min >= 0) {
    if (max <= 255) return 'UInt8';
    if (max <= 65_535) return 'UInt16';
    if (max <= 4_294_967_295) return 'UInt32';
    return 'UInt64';
  }
  if (min >= -128 && max <= 127) return 'Int8';
  if (min >= -32_768 && max <= 32_767) return 'Int16';
  if (min >= -2_147_483_648 && max <= 2_147_483_647) return 'Int32';
  return 'Int64';
}

function defaultFor(type: string): string {
  if (/Int|Float|Decimal/.test(type)) return '0';
  if (/^DateTime/.test(type)) return 'now()';
  if (type === 'Date') return 'today()';
  return "''";
}

function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`;
  const u = ['KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let i = -1;
  let v = b;
  do { v /= 1024; i++; } while (v >= 1024 && i < u.length - 1);
  return `${v.toFixed(1)} ${u[i]}`;
}

// ── Collection ──────────────────────────────────────────────────────────────

type Row = Record<string, unknown>;
const num = (v: unknown) => (typeof v === 'number' ? v : Number(v ?? 0)) || 0;

/** Collect facts for every user table in `database` (or all non-system databases). System tables only. */
export async function collectTableFacts(client: ClickHouseClient, role: UserRole, database?: string): Promise<{ facts: TableFacts[]; warnings: string[] }> {
  const warnings: string[] = [];
  const dbFilter = database
    ? 'database = {db:String}'
    : "database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema')";
  const params: Record<string, string> = database ? { db: database } : {};
  const q = (sql: string) => client.query<Row>(sql, { role, params });

  const tables = await q(`
    SELECT database, name, engine, engine_full, sorting_key, partition_key,
           ifNull(total_rows, 0) AS total_rows, ifNull(total_bytes, 0) AS total_bytes
    FROM system.tables
    WHERE ${dbFilter} AND NOT is_temporary AND engine NOT IN ('View', 'MaterializedView', 'Dictionary')
    ORDER BY total_bytes DESC
    LIMIT 500`);

  const [columns, parts, skip, mutations] = await Promise.all([
    q(`SELECT database, table, name, type, is_in_sorting_key, is_in_partition_key,
              data_compressed_bytes, data_uncompressed_bytes
       FROM system.columns WHERE ${dbFilter}`),
    q(`SELECT database, table, count() AS parts, uniqExact(partition_id) AS partitions,
              max(c) AS max_parts_per_partition
       FROM (SELECT database, table, partition_id, count() OVER (PARTITION BY database, table, partition_id) AS c
             FROM system.parts WHERE active AND ${dbFilter})
       GROUP BY database, table`),
    q(`SELECT database, table, count() AS n FROM system.data_skipping_indices WHERE ${dbFilter} GROUP BY database, table`),
    q(`SELECT database, table, countIf(NOT is_done) AS pending, countIf(create_time > now() - INTERVAL 7 DAY) AS recent
       FROM system.mutations WHERE ${dbFilter} GROUP BY database, table`),
  ]);

  // query_log may be disabled or not granted — degrade gracefully
  let qlog: Row[] = [];
  try {
    qlog = (await client.query<Row>(`
      SELECT l.t AS fq,
             countIf(l.query_kind = 'Insert' AND l.event_time > now() - INTERVAL 1 DAY) AS inserts,
             avgIf(l.written_rows, l.query_kind = 'Insert' AND l.event_time > now() - INTERVAL 1 DAY) AS avg_insert_rows,
             countIf(l.query_kind = 'Select' AND l.event_time > now() - INTERVAL 1 DAY) AS selects,
             countIf(l.query_kind = 'Select' AND l.event_time > now() - INTERVAL 1 DAY
                     AND tr.total_rows > 0 AND l.read_rows > 0.5 * tr.total_rows) AS full_scans,
             countIf(l.query_kind = 'Optimize' AND positionCaseInsensitive(l.query, 'FINAL') > 0) AS optimize_final
      FROM (
        SELECT t, query_kind, event_time, written_rows, read_rows, query
        FROM system.query_log
        ARRAY JOIN tables AS t
        WHERE type = 'QueryFinish' AND event_time > now() - INTERVAL 7 DAY AND NOT startsWith(t, 'system.')
      ) AS l
      LEFT JOIN (
        SELECT concat(database, '.', name) AS fq, toFloat64(ifNull(total_rows, 0)) AS total_rows FROM system.tables
      ) AS tr ON l.t = tr.fq
      GROUP BY l.t`, {
        role,
        // Busy servers keep millions of log rows: bound the scan; partial counts are fine for heuristics
        settings: { max_execution_time: 20, max_rows_to_read: 20_000_000, read_overflow_mode: 'break' },
      })).data;
  } catch (err) {
    warnings.push(`system.query_log unavailable (${err instanceof Error ? err.message : 'error'}) — insert/query-pattern rules skipped`);
  }

  const key = (r: Row) => `${r.database}.${r.table ?? r.name}`;
  const colMap = new Map<string, ColumnFact[]>();
  for (const c of columns.data) {
    const k = key(c);
    if (!colMap.has(k)) colMap.set(k, []);
    colMap.get(k)!.push({
      name: String(c.name),
      type: String(c.type),
      inSortingKey: !!num(c.is_in_sorting_key),
      inPartitionKey: !!num(c.is_in_partition_key),
      compressed: num(c.data_compressed_bytes),
      uncompressed: num(c.data_uncompressed_bytes),
    });
  }
  const byKey = (rows: Row[]) => new Map(rows.map(r => [key(r), r]));
  const partMap = byKey(parts.data);
  const skipMap = byKey(skip.data);
  const mutMap = byKey(mutations.data);
  const logMap = new Map(qlog.map(r => [String(r.fq), r]));
  const haveLog = !warnings.length;

  const facts: TableFacts[] = tables.data.map(t => {
    const k = key(t);
    const p = partMap.get(k);
    const l = logMap.get(k);
    return {
      database: String(t.database),
      table: String(t.name),
      engine: String(t.engine),
      engineFull: String(t.engine_full ?? ''),
      sortingKey: String(t.sorting_key ?? ''),
      partitionKey: String(t.partition_key ?? ''),
      totalRows: num(t.total_rows),
      totalBytes: num(t.total_bytes),
      columns: colMap.get(k) ?? [],
      activeParts: num(p?.parts),
      partitions: num(p?.partitions),
      maxPartsPerPartition: num(p?.max_parts_per_partition),
      skipIndexCount: num(skipMap.get(k)?.n),
      pendingMutations: num(mutMap.get(k)?.pending),
      recentMutations: num(mutMap.get(k)?.recent),
      ...(haveLog ? {
        insertQueries24h: num(l?.inserts),
        avgRowsPerInsert24h: num(l?.avg_insert_rows),
        optimizeFinal7d: num(l?.optimize_final),
        selectQueries24h: num(l?.selects),
        fullScanQueries24h: l?.full_scans !== undefined ? num(l.full_scans) : undefined,
      } : {}),
    };
  });
  return { facts, warnings };
}

/**
 * Deep analysis for one table: sampled distinct counts for String / key columns
 * and min/max for wide integers. Bounded by scan caps (agent-query-safety).
 */
export async function collectDeepStats(client: ClickHouseClient, role: UserRole, facts: TableFacts): Promise<Record<string, DeepColumnStats>> {
  const targets = facts.columns.filter(c =>
    c.type === 'String' || c.inSortingKey || /^U?Int(64|128|256)$/.test(baseType(c.type))).slice(0, 40);
  if (!targets.length) return {};
  const exprs: string[] = [];
  for (const c of targets) {
    const col = quoteIdent(c.name);
    exprs.push(`uniqCombined(${col}) AS ${quoteIdent(`u_${c.name}`)}`);
    if (/^U?Int(64|128|256)$/.test(baseType(c.type))) {
      exprs.push(`toFloat64(min(${col})) AS ${quoteIdent(`min_${c.name}`)}`, `toFloat64(max(${col})) AS ${quoteIdent(`max_${c.name}`)}`);
    }
  }
  const sql = `SELECT ${exprs.join(', ')} FROM (SELECT * FROM ${fqName(facts)} LIMIT 1000000)`;
  const r = await client.query<Row>(sql, {
    role,
    settings: { max_execution_time: 30, max_rows_to_read: 2_000_000, read_overflow_mode: 'break' },
  });
  const row = r.data[0] ?? {};
  const out: Record<string, DeepColumnStats> = {};
  for (const c of targets) {
    out[c.name] = {
      uniq: row[`u_${c.name}`] !== undefined ? num(row[`u_${c.name}`]) : undefined,
      ...(row[`max_${c.name}`] !== undefined ? { min: num(row[`min_${c.name}`]), max: num(row[`max_${c.name}`]) } : {}),
    };
  }
  return out;
}
