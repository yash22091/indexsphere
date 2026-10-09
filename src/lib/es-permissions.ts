/**
 * Role-based authorization for raw Elasticsearch/OpenSearch requests.
 *
 *   readonly → GET/HEAD plus POST to read-only APIs (_search, _count, _mget, …)
 *   user     → everything except cluster-administration writes (security,
 *              cluster settings, snapshots/restore, node operations, licensing)
 *   admin    → everything
 */
import type { UserRole } from './auth';

export type EsAccessLevel = 'read' | 'write' | 'admin';

/** APIs that only read data even though they are called with POST. */
const READ_ONLY_POST_APIS = [
  '_search',          // includes _search/template, _search/scroll, _search/point_in_time
  '_msearch',
  '_count',
  '_explain',
  '_validate/query',
  '_field_caps',
  '_mget',
  '_analyze',
  '_termvectors',
  '_mtermvectors',
  '_render/template',
  '_sql',             // Elasticsearch SQL is read-only (OpenSearch _plugins/_sql is not and is excluded)
  '_plugins/_ppl',
  '_query',           // ES|QL
  '_async_search',
  '_eql/search',
  '_pit',
  '_cluster/allocation/explain',
];

/** Writes to these APIs are reserved for admins. */
const ADMIN_ONLY_APIS = [
  '_security',
  '_plugins/_security',
  '_opendistro/_security',
  '_cluster/settings',
  '_cluster/reroute',
  '_cluster/voting_config_exclusions',
  '_snapshot',
  '_nodes',
  '_license',
  '_xpack',
  '_plugins/_ism',    // ISM policy changes affect cluster-wide data retention
  '_ilm',
  '_scripts',
];

function matchesApi(api: string, list: string[]): boolean {
  return list.some(p => api === p || api.startsWith(p + '/'));
}

/**
 * Extract the API portion of an ES path: everything from the first segment that
 * starts with "_". `/logs/_search` → `_search`, `/_plugins/_sql` → `_plugins/_sql`,
 * `/logs` (index create/delete) → ``.
 * Returns null for paths that are ambiguous after decoding (traversal, encoded slashes).
 */
export function extractApi(path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path.split('?')[0]);
  } catch {
    return null;
  }
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some(s => s === '..' || s === '.')) return null;
  // An encoded "/" inside a segment would let a path look different to us than to ES
  if (path.split('?')[0].split('/').some(s => /%2f/i.test(s))) return null;
  const idx = segments.findIndex(s => s.startsWith('_'));
  return idx === -1 ? '' : segments.slice(idx).join('/');
}

export function classifyEsRequest(method: string, path: string): EsAccessLevel {
  const m = method.toUpperCase();
  const api = extractApi(path);
  if (api === null) return 'admin';
  if (m === 'GET' || m === 'HEAD') return 'read';
  if (m === 'POST' && matchesApi(api, READ_ONLY_POST_APIS)) return 'read';
  if (matchesApi(api, ADMIN_ONLY_APIS)) return 'admin';
  return 'write';
}

export function isEsRequestAllowed(role: UserRole, method: string, path: string): boolean {
  const level = classifyEsRequest(method, path);
  if (role === 'admin') return true;
  if (role === 'user') return level !== 'admin';
  return level === 'read';
}
