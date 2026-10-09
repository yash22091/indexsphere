import { describe, expect, it } from 'vitest';
import { diffSnapshots, hashSections, normalize } from '@/lib/drift';

describe('drift', () => {
  it('normalize drops volatile fields, redacts secrets and sorts keys', () => {
    expect(normalize({ b: 1, uuid: 'x', a: { modified_date: 5, password: 'p', keep: true } }))
      .toEqual({ a: { keep: true, password: '[redacted]' }, b: 1 });
  });

  it('equal configuration hashes equally regardless of key order or volatile fields', () => {
    expect(hashSections({ s: { x: { a: 1, b: 2 } } })).toBe(hashSections({ s: { x: { b: 2, a: 1, version: 9 } } }));
    expect(hashSections({ s: { x: { a: 1 } } })).not.toBe(hashSections({ s: { x: { a: 2 } } }));
  });

  it('reports added, removed and changed keys with field-level detail', () => {
    const before = { index_templates: { logs: { template: { settings: { number_of_replicas: 1 } } }, old: {} }, users: { a: {} } };
    const after = { index_templates: { logs: { template: { settings: { number_of_replicas: 0 } } }, new: {} }, users: { a: {} } };
    const changes = diffSnapshots(before, after);
    expect(changes).toEqual([
      { section: 'index_templates', key: 'logs', kind: 'changed',
        details: [{ path: 'template.settings.number_of_replicas', before: 1, after: 0 }] },
      { section: 'index_templates', key: 'new', kind: 'added' },
      { section: 'index_templates', key: 'old', kind: 'removed' },
    ]);
  });
});
