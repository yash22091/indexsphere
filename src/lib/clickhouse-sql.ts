/**
 * ClickHouse SQL authorization for IndexSphere roles.
 *
 * The primary fence is server-side: readonly users' queries always run with
 * ClickHouse's `readonly=2` setting, so ClickHouse itself refuses writes/DDL.
 * This module adds what `readonly` does not cover (verified against 25.x/26.x):
 *   • KILL QUERY and access-control statements are admin-only
 *   • external table functions / engines (url, file, s3, remote, mysql, …) are
 *     admin-only — otherwise any SQL user could make the ClickHouse server
 *     fetch internal URLs (SSRF) or read its files
 *   • per-query SETTINGS may not loosen the safety limits IndexSphere applies
 *     (agent-query-safety: LIMIT, max_execution_time, scan caps)
 */
import type { UserRole } from './auth';

export type ChAccessLevel = 'read' | 'write' | 'admin';

/** Replace string literals and comments so keyword checks can't be fooled by text inside them. */
export function stripLiteralsAndComments(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '#' && (i === 0 || /\s/.test(sql[i - 1]))) {
      while (i < sql.length && sql[i] !== '\n') i++;
      out += ' ';
    } else if (c === '/' && next === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      out += ' ';
    } else if (c === "'") {
      i++;
      while (i < sql.length && sql[i] !== "'") {
        if (sql[i] === '\\') i++;
        i++;
      }
      i++;
      out += "''";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

const READ_STATEMENTS = new Set(['SELECT', 'WITH', 'SHOW', 'DESCRIBE', 'DESC', 'EXPLAIN', 'EXISTS', 'USE']);
const WRITE_STATEMENTS = new Set([
  'INSERT', 'CREATE', 'ALTER', 'DROP', 'TRUNCATE', 'RENAME', 'OPTIMIZE', 'DELETE', 'UPDATE',
  'EXCHANGE', 'ATTACH', 'DETACH', 'UNDROP',
]);
const ADMIN_STATEMENTS = new Set(['GRANT', 'REVOKE', 'SYSTEM', 'KILL', 'BACKUP', 'RESTORE', 'SET', 'CHECK', 'MOVE']);
/** Objects whose CREATE/ALTER/DROP is access control, not data. */
const ACCESS_OBJECTS = /^(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:USER|ROLE|QUOTA|ROW\s+POLICY|POLICY|MASKING\s+POLICY|SETTINGS\s+PROFILE|PROFILE|NAMED\s+COLLECTION|DATABASE|FUNCTION)\b/;

/**
 * Table functions and table engines that reach outside the ClickHouse server
 * (network, filesystem, other databases, external processes).
 */
const EXTERNAL_SOURCES = [
  'url', 'urlCluster', 'file', 'fileCluster', 's3', 's3Cluster', 'gcs', 'oss', 'cosn',
  'azureBlobStorage', 'azureBlobStorageCluster', 'hdfs', 'hdfsCluster', 'remote', 'remoteSecure',
  'mysql', 'postgresql', 'mongodb', 'redis', 'sqlite', 'odbc', 'jdbc',
  'executable', 'executablePool', 'input', 'deltaLake', 'deltaLakeCluster', 'hudi', 'hudiCluster',
  'iceberg', 'icebergS3', 'icebergAzure', 'icebergHDFS', 'icebergLocal', 'paimon', 'kafka', 'nats',
  'rabbitmq', 'arrowFlight', 'ytsaurus',
];
const EXTERNAL_RE = new RegExp(`(?<![\\w.])(?:${EXTERNAL_SOURCES.join('|')})\\s*\\(`, 'i');

/** Settings that implement IndexSphere's query safety limits; only admins may override them per query. */
const PROTECTED_SETTINGS = [
  'readonly', 'max_execution_time', 'max_result_rows', 'max_result_bytes', 'result_overflow_mode',
  'max_rows_to_read', 'max_bytes_to_read', 'read_overflow_mode', 'timeout_overflow_mode',
  'timeout_before_checking_execution_speed', 'max_memory_usage', 'max_memory_usage_for_user',
];
const PROTECTED_SETTINGS_RE = new RegExp(`\\b(?:${PROTECTED_SETTINGS.join('|')})\\s*=`, 'i');

export interface ChQueryAnalysis {
  level: ChAccessLevel;
  statement: string;
  usesExternalSource: boolean;
  overridesSafetySettings: boolean;
  multipleStatements: boolean;
}

export function analyzeClickHouseQuery(sql: string): ChQueryAnalysis {
  const cleaned = stripLiteralsAndComments(sql).trim().replace(/;\s*$/, '');
  const upper = cleaned.replace(/^\(+/, '').toUpperCase();
  const statement = upper.match(/^[A-Z]+/)?.[0] ?? '';

  let level: ChAccessLevel;
  if (ACCESS_OBJECTS.test(upper)) level = 'admin';
  else if (READ_STATEMENTS.has(statement)) level = 'read';
  else if (WRITE_STATEMENTS.has(statement)) level = 'write';
  else if (ADMIN_STATEMENTS.has(statement)) level = 'admin';
  else level = 'admin'; // unknown → deny by default for non-admins

  // EXPLAIN of a statement is only as safe as the statement (EXPLAIN PIPELINE INSERT …)
  if (statement === 'EXPLAIN' && /\b(INSERT|CREATE|ALTER|DROP|TRUNCATE|DELETE|UPDATE)\b/.test(upper)) level = 'write';

  return {
    level,
    statement,
    usesExternalSource: EXTERNAL_RE.test(cleaned),
    overridesSafetySettings: PROTECTED_SETTINGS_RE.test(cleaned),
    multipleStatements: cleaned.includes(';'),
  };
}

/** Returns null when allowed, otherwise a human-readable reason. */
export function checkClickHouseQuery(role: UserRole, sql: string): string | null {
  if (!sql.trim()) return 'Query is empty';
  const a = analyzeClickHouseQuery(sql);
  if (a.multipleStatements) return 'Only one statement per request is allowed';
  if (role === 'admin') return null;
  if (a.usesExternalSource) {
    return 'External table functions/engines (url, file, s3, remote, mysql, …) are restricted to admins';
  }
  if (a.overridesSafetySettings) {
    return 'Query safety limits (max_execution_time, max_result_rows, scan caps, readonly) cannot be overridden';
  }
  if (a.level === 'admin') return `${a.statement || 'This'} statements are restricted to admins`;
  if (a.level === 'write' && role === 'readonly') return 'Read-only users can only run SELECT / SHOW / DESCRIBE / EXPLAIN';
  return null;
}

/** Quote a ClickHouse identifier (database/table/column) with backticks. */
export function quoteIdent(name: string): string {
  return '`' + name.replace(/\\/g, '\\\\').replace(/`/g, '\\`') + '`';
}
