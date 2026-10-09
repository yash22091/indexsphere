/**
 * Configuration drift detection for Elasticsearch / OpenSearch and ClickHouse.
 *
 * A snapshot captures the configuration that changes behaviour or security —
 * not data. Volatile fields (timestamps, UUIDs, versions, counters) are
 * stripped and secrets are never stored, so two snapshots differ only when
 * someone changed something. diffSnapshots() reports what was added, removed
 * or changed, down to the individual setting.
 */
import { createHash } from 'crypto';
import type { ElasticsearchClient } from './elasticsearch';
import type { ClickHouseClient } from './clickhouse';
import type { UserRole } from './auth';

export type Sections = Record<string, Record<string, unknown>>;

export interface DriftSnapshotData {
  engine: 'elasticsearch' | 'opensearch' | 'clickhouse';
  version: string;
  sections: Sections;
  notes: string[]; // sections that could not be read (missing privileges)
}

/** Sections that reveal users, roles and privileges — admins only. */
export const SENSITIVE_SECTIONS = new Set(['security_roles', 'security_role_mappings', 'security_users', 'users', 'grants', 'roles', 'row_policies', 'quotas', 'settings_profiles']);

const VOLATILE_KEYS = /^(uuid|version|modified_date|modified_date_millis|in_use_by|creation_date|provided_name|seq_no|primary_term|_seq_no|_primary_term|last_updated_time|schema_version|policy_id_uuid|index_uuid|upgraded|.*_millis)$/i;
const SECRET_KEYS = /(password|secret|access_key|secret_key|token|credentials|hash)$/i;

/** Remove volatile fields and secrets, sort keys — so equal config hashes equally. */
export function normalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as object).sort()) {
      if (VOLATILE_KEYS.test(k)) continue;
      const v = (value as Record<string, unknown>)[k];
      out[k] = SECRET_KEYS.test(k) ? '[redacted]' : normalize(v);
    }
    return out;
  }
  return value;
}

export function hashSections(sections: Sections): string {
  return createHash('sha256').update(JSON.stringify(normalize(sections))).digest('hex');
}

// ── Capture: Elasticsearch / OpenSearch ──────────────────────────────────────

async function tryReq<T>(client: ElasticsearchClient, path: string): Promise<T | null> {
  try { return await client.request(path) as T; } catch { return null; }
}

export async function captureSearchSnapshot(client: ElasticsearchClient): Promise<DriftSnapshotData> {
  const info = await client.getClusterInfo() as { version?: { number?: string; distribution?: string } };
  const isOS = info.version?.distribution === 'opensearch';
  const sections: Sections = {};
  const notes: string[] = [];
  const put = (name: string, value: Record<string, unknown> | null) => {
    if (value === null) notes.push(name);
    else sections[name] = normalize(value) as Record<string, unknown>;
  };

  const settings = await tryReq<{ persistent?: object; transient?: object }>(client, '/_cluster/settings?flat_settings=true');
  put('cluster_settings', settings ? { ...(settings.persistent ?? {}), ...Object.fromEntries(Object.entries(settings.transient ?? {}).map(([k, v]) => [`transient:${k}`, v])) } : null);

  const composable = await tryReq<{ index_templates?: { name: string; index_template: unknown }[] }>(client, '/_index_template');
  put('index_templates', composable ? Object.fromEntries((composable.index_templates ?? []).map(t => [t.name, t.index_template])) : null);
  put('legacy_templates', await tryReq<Record<string, unknown>>(client, '/_template'));
  const components = await tryReq<{ component_templates?: { name: string; component_template: unknown }[] }>(client, '/_component_template');
  put('component_templates', components ? Object.fromEntries((components.component_templates ?? []).map(t => [t.name, t.component_template])) : null);
  put('ingest_pipelines', await tryReq<Record<string, unknown>>(client, '/_ingest/pipeline'));

  if (isOS) {
    const ism = await tryReq<{ policies?: { _id: string; policy: unknown }[] }>(client, '/_plugins/_ism/policies?size=1000');
    put('lifecycle_policies', ism ? Object.fromEntries((ism.policies ?? []).map(p => [p._id, p.policy])) : null);
  } else {
    const ilm = await tryReq<Record<string, { policy: unknown }>>(client, '/_ilm/policy');
    put('lifecycle_policies', ilm ? Object.fromEntries(Object.entries(ilm).map(([k, v]) => [k, v.policy])) : null);
  }

  const aliases = await tryReq<Record<string, { aliases?: Record<string, unknown> }>>(client, '/_alias');
  put('aliases', aliases ? Object.fromEntries(Object.entries(aliases).filter(([, v]) => Object.keys(v.aliases ?? {}).length).map(([k, v]) => [k, v.aliases])) : null);

  const repos = await tryReq<Record<string, unknown>>(client, '/_snapshot');
  put('snapshot_repositories', repos);

  // Per-index behaviour-defining settings + a fingerprint of the mapping
  const idx = await tryReq<Record<string, { settings?: { index?: Record<string, unknown> } }>>(client,
    '/_all/_settings?expand_wildcards=open&filter_path=*.settings.index.number_of_shards,*.settings.index.number_of_replicas,*.settings.index.refresh_interval,*.settings.index.codec,*.settings.index.lifecycle,*.settings.index.plugins,*.settings.index.blocks');
  const mappings = await tryReq<Record<string, { mappings?: unknown }>>(client, '/_all/_mapping?expand_wildcards=open');
  if (idx) {
    const out: Record<string, unknown> = {};
    for (const [name, v] of Object.entries(idx)) {
      if (name.startsWith('.')) continue;
      out[name] = {
        ...(v.settings?.index ?? {}),
        mapping_sha256: mappings?.[name] ? createHash('sha256').update(JSON.stringify(normalize(mappings[name].mappings))).digest('hex').slice(0, 16) : undefined,
      };
    }
    put('indices', out);
  } else {
    put('indices', null);
  }

  if (isOS) {
    put('security_roles', await tryReq<Record<string, unknown>>(client, '/_plugins/_security/api/roles'));
    put('security_role_mappings', await tryReq<Record<string, unknown>>(client, '/_plugins/_security/api/rolesmapping'));
    const users = await tryReq<Record<string, { backend_roles?: string[]; opendistro_security_roles?: string[]; reserved?: boolean }>>(client, '/_plugins/_security/api/internalusers');
    put('security_users', users ? Object.fromEntries(Object.entries(users).map(([k, u]) => [k, { backend_roles: u.backend_roles, roles: u.opendistro_security_roles, reserved: u.reserved }])) : null);
  } else {
    put('security_roles', await tryReq<Record<string, unknown>>(client, '/_security/role'));
    put('security_role_mappings', await tryReq<Record<string, unknown>>(client, '/_security/role_mapping'));
    const users = await tryReq<Record<string, { roles?: string[]; enabled?: boolean }>>(client, '/_security/user');
    put('security_users', users ? Object.fromEntries(Object.entries(users).map(([k, u]) => [k, { roles: u.roles, enabled: u.enabled }])) : null);
  }

  return { engine: isOS ? 'opensearch' : 'elasticsearch', version: info.version?.number ?? 'unknown', sections, notes };
}

// ── Capture: ClickHouse ──────────────────────────────────────────────────────

export async function captureClickHouseSnapshot(client: ClickHouseClient, role: UserRole, version: string): Promise<DriftSnapshotData> {
  const sections: Sections = {};
  const notes: string[] = [];
  const q = async (name: string, sql: string, toEntry: (r: Record<string, unknown>) => [string, unknown]) => {
    try {
      const rows = (await client.query<Record<string, unknown>>(sql, { role, settings: { max_result_rows: 100_000 } })).data;
      sections[name] = normalize(Object.fromEntries(rows.map(toEntry))) as Record<string, unknown>;
    } catch {
      notes.push(name);
    }
  };

  await q('tables', `SELECT database, name, create_table_query FROM system.tables
                     WHERE database NOT IN ('system', 'INFORMATION_SCHEMA', 'information_schema') AND NOT is_temporary`,
    r => [`${r.database}.${r.name}`, String(r.create_table_query).replace(/ UUID '[0-9a-f-]+'/g, '')]);
  await q('users', `SELECT name, auth_type, host_ip, host_names, host_names_regexp, host_names_like, default_roles_list FROM system.users`,
    r => [String(r.name), { auth_type: r.auth_type, host_ip: r.host_ip, host_names: r.host_names, host_names_regexp: r.host_names_regexp, host_names_like: r.host_names_like, default_roles: r.default_roles_list }]);
  await q('roles', 'SELECT name FROM system.roles', r => [String(r.name), true]);
  await q('grants', `SELECT user_name, role_name, access_type, database, table, column, is_partial_revoke, grant_option FROM system.grants`,
    r => [`${r.user_name || `role:${r.role_name}`} ${r.access_type} ON ${r.database ?? '*'}.${r.table ?? '*'}${r.column ? `(${r.column})` : ''}${Number(r.is_partial_revoke) ? ' (revoke)' : ''}`, { grant_option: Number(r.grant_option) === 1 }]);
  await q('settings_profiles', `SELECT profile_name, setting_name, value, min, max, writability FROM system.settings_profile_elements WHERE profile_name != ''`,
    r => [`${r.profile_name}.${r.setting_name ?? 'inherit'}`, { value: r.value, min: r.min, max: r.max, writability: r.writability }]);
  await q('quotas', 'SELECT name, keys, apply_to_all, apply_to_list FROM system.quotas', r => [String(r.name), { keys: r.keys, all: r.apply_to_all, to: r.apply_to_list }]);
  await q('row_policies', 'SELECT name, select_filter, is_restrictive, apply_to_all, apply_to_list FROM system.row_policies',
    r => [String(r.name), { filter: r.select_filter, restrictive: r.is_restrictive, all: r.apply_to_all, to: r.apply_to_list }]);
  await q('server_settings', `SELECT name, value FROM system.server_settings WHERE changed`, r => [String(r.name), r.value]);
  await q('dictionaries', `SELECT database, name, source, type FROM system.dictionaries`, r => [`${r.database}.${r.name}`, { source: r.source, type: r.type }]);

  return { engine: 'clickhouse', version, sections, notes };
}

// ── Diff ─────────────────────────────────────────────────────────────────────

export interface DriftChange {
  section: string;
  key: string;
  kind: 'added' | 'removed' | 'changed';
  /** For "changed": the individual paths that differ. */
  details?: { path: string; before: unknown; after: unknown }[];
}

const MAX_DETAILS = 25;

function leafDiff(before: unknown, after: unknown, path: string, out: { path: string; before: unknown; after: unknown }[]) {
  if (out.length >= MAX_DETAILS) return;
  const isObj = (v: unknown) => v !== null && typeof v === 'object' && !Array.isArray(v);
  if (isObj(before) && isObj(after)) {
    const keys = new Set([...Object.keys(before as object), ...Object.keys(after as object)]);
    for (const k of [...keys].sort()) leafDiff((before as Record<string, unknown>)[k], (after as Record<string, unknown>)[k], path ? `${path}.${k}` : k, out);
    return;
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) out.push({ path: path || '(value)', before: before ?? null, after: after ?? null });
}

export function diffSnapshots(before: Sections, after: Sections): DriftChange[] {
  const changes: DriftChange[] = [];
  const sections = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const section of [...sections].sort()) {
    const a = before[section] ?? {};
    const b = after[section] ?? {};
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of [...keys].sort()) {
      if (!(key in a)) changes.push({ section, key, kind: 'added' });
      else if (!(key in b)) changes.push({ section, key, kind: 'removed' });
      else if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        const details: { path: string; before: unknown; after: unknown }[] = [];
        leafDiff(a[key], b[key], '', details);
        changes.push({ section, key, kind: 'changed', details });
      }
    }
  }
  return changes;
}
