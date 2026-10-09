import { describe, expect, it } from 'vitest';
import { classifyEsRequest, extractApi, isEsRequestAllowed } from '@/lib/es-permissions';

describe('extractApi', () => {
  it('returns the API part of the path', () => {
    expect(extractApi('/logs-*/_search')).toBe('_search');
    expect(extractApi('/_search/scroll')).toBe('_search/scroll');
    expect(extractApi('/_plugins/_sql')).toBe('_plugins/_sql');
    expect(extractApi('/my-index')).toBe('');
    expect(extractApi('/idx/_doc/1?refresh=true')).toBe('_doc/1');
  });

  it('rejects traversal and encoded slashes', () => {
    expect(extractApi('/idx/_search/../_doc/1')).toBeNull();
    expect(extractApi('/idx/_search%2F..%2F_doc')).toBeNull();
  });
});

describe('classifyEsRequest', () => {
  it.each([
    ['GET', '/_cat/indices', 'read'],
    ['HEAD', '/my-index', 'read'],
    ['POST', '/logs/_search', 'read'],
    ['POST', '/_msearch', 'read'],
    ['POST', '/logs/_count', 'read'],
    ['POST', '/_cluster/allocation/explain', 'read'],
    ['POST', '/logs/_doc', 'write'],
    ['POST', '/logs/_delete_by_query', 'write'],
    ['POST', '/logs/_update_by_query', 'write'],
    ['DELETE', '/logs', 'write'],
    ['PUT', '/logs', 'write'],
    ['POST', '/_bulk', 'write'],
    ['POST', '/_plugins/_sql', 'write'],
    ['PUT', '/_cluster/settings', 'admin'],
    ['PUT', '/_plugins/_security/api/internalusers/x', 'admin'],
    ['POST', '/_snapshot/repo/snap/_restore', 'admin'],
    ['DELETE', '/_search/../logs', 'admin'],
  ])('%s %s → %s', (method, path, level) => {
    expect(classifyEsRequest(method, path)).toBe(level);
  });
});

describe('isEsRequestAllowed', () => {
  it('readonly can only read', () => {
    expect(isEsRequestAllowed('readonly', 'GET', '/_cat/indices')).toBe(true);
    expect(isEsRequestAllowed('readonly', 'POST', '/logs/_search')).toBe(true);
    expect(isEsRequestAllowed('readonly', 'DELETE', '/logs')).toBe(false);
    expect(isEsRequestAllowed('readonly', 'POST', '/logs/_delete_by_query')).toBe(false);
    expect(isEsRequestAllowed('readonly', 'PUT', '/logs/_settings')).toBe(false);
  });

  it('user can write data but not administer the cluster', () => {
    expect(isEsRequestAllowed('user', 'DELETE', '/logs')).toBe(true);
    expect(isEsRequestAllowed('user', 'POST', '/_reindex')).toBe(true);
    expect(isEsRequestAllowed('user', 'PUT', '/_cluster/settings')).toBe(false);
    expect(isEsRequestAllowed('user', 'PUT', '/_plugins/_security/api/roles/x')).toBe(false);
  });

  it('admin can do everything', () => {
    expect(isEsRequestAllowed('admin', 'PUT', '/_cluster/settings')).toBe(true);
    expect(isEsRequestAllowed('admin', 'DELETE', '/logs')).toBe(true);
  });
});
