/**
 * Elasticsearch/OpenSearch mapping → ClickHouse table design.
 *
 * Applies the clickhouse-best-practices rules when translating:
 *   • schema-types-native-types     — date→DateTime64, ip→IPv6, numerics→native ints/floats
 *   • schema-types-lowcardinality   — keyword fields with < 10K distinct values
 *   • schema-types-avoid-nullable   — non-Nullable columns with DEFAULTs
 *   • schema-pk-cardinality-order / schema-pk-prioritize-filters
 *                                   — ORDER BY low-cardinality filter fields, then time
 *   • schema-partition-lifecycle    — monthly partitions on the event time
 *   • schema-json-when-to-use       — dynamic/flattened objects → JSON
 *   • insert-batch-size             — ingestion guidance
 * Pure functions (no I/O) so the output is unit-testable.
 */
import { quoteIdent } from './clickhouse-sql';

export interface EsField {
  type?: string;
  properties?: Record<string, EsField>;
  fields?: Record<string, EsField>;
  scaling_factor?: number;
  enabled?: boolean;
}

export interface ColumnPlan {
  source: string;        // dotted ES path
  column: string;        // ClickHouse column name
  type: string;
  reason: string;        // rule / explanation
  rule?: string;
}

export interface MigrationPlan {
  database: string;
  table: string;
  columns: ColumnPlan[];
  orderBy: string[];
  orderByReason: string;
  partitionBy?: string;
  timeColumn?: string;
  ddl: string;
  notes: string[];
  skipped: { source: string; reason: string }[];
}

export interface PlanOptions {
  database: string;
  table: string;
  /** Approximate distinct counts from an ES cardinality aggregation, keyed by ES path. */
  cardinality?: Record<string, number>;
  /** 'underscore' → source.ip becomes source_ip; 'dotted' keeps `source.ip`. */
  naming?: 'underscore' | 'dotted';
}

const LOW_CARD_LIMIT = 10_000;
const TIME_PREFERENCE = ['@timestamp', 'timestamp', 'time', 'event.created', 'event.ingested', 'date'];
/** Typical low-cardinality filter fields in log/SIEM data (used when no cardinality data is available). */
const FILTER_HINTS = /(^|\.)(tenant|tenant_id|customer|index|dataset|module|category|class_uid|kind|type|severity|level|rule\.level|agent\.name|agent\.id|manager\.name|host\.name|hostname|cluster|environment|env|service|service\.name|source|log\.level|status)$/i;

function chType(path: string, f: EsField, cardinality?: number): { type: string; reason: string; rule?: string } | null {
  switch (f.type) {
    case 'date':
      return { type: 'DateTime64(3)', reason: 'ES date → millisecond DateTime64', rule: 'schema-types-native-types' };
    case 'date_nanos':
      return { type: 'DateTime64(9)', reason: 'ES date_nanos → nanosecond DateTime64', rule: 'schema-types-native-types' };
    case 'long':
      return { type: 'Int64', reason: 'ES long', rule: 'schema-types-minimize-bitwidth' };
    case 'integer':
      return { type: 'Int32', reason: 'ES integer', rule: 'schema-types-minimize-bitwidth' };
    case 'short':
      return { type: 'Int16', reason: 'ES short', rule: 'schema-types-minimize-bitwidth' };
    case 'byte':
      return { type: 'Int8', reason: 'ES byte', rule: 'schema-types-minimize-bitwidth' };
    case 'unsigned_long':
      return { type: 'UInt64', reason: 'ES unsigned_long' };
    case 'double':
      return { type: 'Float64', reason: 'ES double' };
    case 'float':
    case 'half_float':
      return { type: 'Float32', reason: `ES ${f.type}` };
    case 'scaled_float': {
      const scale = Math.max(0, Math.round(Math.log10(f.scaling_factor ?? 100)));
      return { type: `Decimal64(${scale})`, reason: `ES scaled_float (factor ${f.scaling_factor ?? 100}) → exact decimal`, rule: 'schema-types-native-types' };
    }
    case 'boolean':
      return { type: 'Bool', reason: 'ES boolean', rule: 'schema-types-native-types' };
    case 'ip':
      return { type: 'IPv6', reason: 'ES ip → IPv6 (also stores IPv4-mapped addresses)', rule: 'schema-types-native-types' };
    case 'keyword':
    case 'constant_keyword':
    case 'wildcard': {
      if (/(^|[._])uuid$/i.test(path)) return { type: 'UUID', reason: 'UUID-like keyword', rule: 'schema-types-native-types' };
      if (f.type === 'constant_keyword') return { type: 'LowCardinality(String)', reason: 'constant_keyword has one value', rule: 'schema-types-lowcardinality' };
      if (cardinality !== undefined) {
        return cardinality < LOW_CARD_LIMIT
          ? { type: 'LowCardinality(String)', reason: `~${cardinality} distinct values (< 10K)`, rule: 'schema-types-lowcardinality' }
          : { type: 'String', reason: `~${cardinality} distinct values (≥ 10K, too many for LowCardinality)`, rule: 'schema-types-lowcardinality' };
      }
      if (/(^|[._])(id|hash|md5|sha1|sha256|token|session|trace|span|url|path|message|query)$/i.test(path)) {
        return { type: 'String', reason: 'identifier-like keyword (likely high cardinality)', rule: 'schema-types-lowcardinality' };
      }
      return { type: 'LowCardinality(String)', reason: 'keyword — verify < 10K distinct values', rule: 'schema-types-lowcardinality' };
    }
    case 'text':
    case 'match_only_text': {
      // Dynamic mappings index strings as text + a .keyword sub-field; measured
      // cardinality of that sub-field tells us whether it is really categorical.
      if (f.fields?.keyword?.type === 'keyword' && cardinality !== undefined && cardinality < LOW_CARD_LIMIT) {
        return { type: 'LowCardinality(String)', reason: `text+keyword with ~${cardinality} distinct values (< 10K)`, rule: 'schema-types-lowcardinality' };
      }
      return { type: 'String', reason: 'full-text field (add a text/ngrambf skip index if searched)', rule: 'query-index-skipping-indices' };
    }
    case 'geo_point':
      return { type: 'Point', reason: 'ES geo_point → Point (Tuple(Float64, Float64))', rule: 'schema-types-native-types' };
    case 'flattened':
    case 'object':
    case 'nested':
      return { type: 'JSON', reason: `ES ${f.type} with dynamic keys`, rule: 'schema-json-when-to-use' };
    default:
      return null;
  }
}

function columnName(path: string, naming: 'underscore' | 'dotted'): string {
  const base = path.replace(/^@/, '');
  return naming === 'dotted' ? base : base.replace(/[^A-Za-z0-9_]/g, '_');
}

/** Flatten an ES mapping's properties into dotted leaf fields. */
/**
 * ES field path to aggregate for cardinality: keyword fields directly, text
 * fields through their .keyword sub-field. null when not aggregatable.
 */
export function cardinalityField(path: string, f: EsField): string | null {
  if (f.type === 'keyword') return path;
  if ((f.type === 'text' || f.type === 'match_only_text') && f.fields?.keyword?.type === 'keyword') return `${path}.keyword`;
  return null;
}

export function flattenMapping(properties: Record<string, EsField>, prefix = ''): { path: string; field: EsField }[] {
  const out: { path: string; field: EsField }[] = [];
  for (const [key, field] of Object.entries(properties ?? {})) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (field.properties && field.type !== 'nested') {
      out.push(...flattenMapping(field.properties, path));
    } else {
      // A property with neither a type nor sub-properties is a dynamic object
      out.push({ path, field: field.type ? field : { ...field, type: 'object' } });
    }
  }
  return out;
}

export function planMigration(properties: Record<string, EsField>, opts: PlanOptions): MigrationPlan {
  const naming = opts.naming ?? 'underscore';
  const leaves = flattenMapping(properties);
  const columns: ColumnPlan[] = [];
  const skipped: { source: string; reason: string }[] = [];
  const used = new Set<string>();

  for (const { path, field } of leaves) {
    const mapped = chType(path, field, opts.cardinality?.[path]);
    if (!mapped) {
      skipped.push({ source: path, reason: `unsupported ES type "${field.type}"` });
      continue;
    }
    let name = columnName(path, naming);
    while (used.has(name)) name += '_';
    used.add(name);
    columns.push({ source: path, column: name, type: mapped.type, reason: mapped.reason, rule: mapped.rule });
  }

  // ── Time column ────────────────────────────────────────────────────────────
  const timeCols = columns.filter(c => /^DateTime64/.test(c.type));
  const timeCol = TIME_PREFERENCE.map(p => timeCols.find(c => c.source === p)).find(Boolean) ?? timeCols[0];

  // ── ORDER BY: low-cardinality filter fields first, time last ───────────────
  const candidates = columns.filter(c => c.type === 'LowCardinality(String)' || /^U?Int(8|16)$/.test(c.type));
  let keyCols: ColumnPlan[];
  let orderByReason: string;
  if (opts.cardinality && Object.keys(opts.cardinality).length) {
    keyCols = candidates
      .filter(c => opts.cardinality![c.source] !== undefined && opts.cardinality![c.source] > 1)
      .sort((a, b) => opts.cardinality![a.source] - opts.cardinality![b.source])
      .slice(0, 3);
    orderByReason = 'Low-cardinality fields ordered by measured distinct count (low → high), then the event time (schema-pk-cardinality-order). Put the fields your queries filter on most first (schema-pk-prioritize-filters).';
  } else {
    keyCols = candidates.filter(c => FILTER_HINTS.test(c.source)).slice(0, 3);
    orderByReason = 'Typical low-cardinality filter fields, then the event time (schema-pk-cardinality-order). No cardinality data was available — run "Analyze cardinality" and adjust to the filters your queries actually use (schema-pk-prioritize-filters).';
  }
  const orderBy = [...keyCols.map(c => c.column), ...(timeCol ? [timeCol.column] : [])];

  const partitionBy = timeCol ? `toYYYYMM(${quoteIdent(timeCol.column)})` : undefined;

  const notes = [
    'ORDER BY is immutable — review it before creating the table (schema-pk-plan-before-creation).',
    'Columns are non-Nullable; missing values get type defaults (schema-types-avoid-nullable).',
    partitionBy
      ? 'Monthly partitions keep the partition count low and make retention a cheap DROP PARTITION (schema-partition-lifecycle, schema-partition-low-cardinality).'
      : 'No date field found — table is not partitioned (schema-partition-start-without).',
    'Ingest in batches of 10K–100K rows, or enable async_insert for many small producers (insert-batch-size, insert-async-small-batches).',
    'Store updates as new rows (ReplacingMergeTree) instead of ALTER UPDATE (insert-mutation-avoid-update).',
  ];
  if (!orderBy.length) notes.unshift('No suitable ORDER BY columns were found — choose them manually.');

  const colLines = columns.map(c => `    ${quoteIdent(c.column)} ${c.type}`);
  const ddl = [
    `CREATE TABLE ${quoteIdent(opts.database)}.${quoteIdent(opts.table)}`,
    '(',
    colLines.join(',\n'),
    ')',
    'ENGINE = MergeTree',
    ...(partitionBy ? [`PARTITION BY ${partitionBy}`] : []),
    `ORDER BY (${orderBy.map(quoteIdent).join(', ')})`,
  ].join('\n');

  return {
    database: opts.database,
    table: opts.table,
    columns,
    orderBy,
    orderByReason,
    partitionBy,
    timeColumn: timeCol?.column,
    ddl,
    notes,
    skipped,
  };
}
