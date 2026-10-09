import { describe, expect, it } from 'vitest';
import { assessFromFeeds, compareVersions, cpeMatchCovers, recommendUpgrade, type CpeMatch } from '@/lib/vuln-intel';

const cpe = (product: string, over: Partial<CpeMatch> = {}, version = '*'): CpeMatch =>
  ({ vulnerable: true, criteria: `cpe:2.3:a:${product}:${version}:*:*:*:*:*:*:*`, ...over });

describe('compareVersions', () => {
  it.each([
    ['8.10.0', '8.9.9', 1], ['8.10.0', '8.10.0', 0], ['7.17.23', '8.0.0', -1],
    ['25.12.1.649', '25.12.1.1000', -1], ['23.3', '23.3.0.0', 0], ['v2.11.0-SNAPSHOT', '2.11.0', 0],
  ])('%s vs %s', (a, b, r) => expect(compareVersions(a, b)).toBe(r));
});

describe('cpeMatchCovers', () => {
  it('evaluates ranges like NVD', () => {
    const m = cpe('elastic:elasticsearch', { versionStartIncluding: '8.0.0', versionEndExcluding: '8.13.0' });
    expect(cpeMatchCovers(m, '8.10.0')).toBe(true);
    expect(cpeMatchCovers(m, '8.13.0')).toBe(false);
    expect(cpeMatchCovers(m, '7.17.0')).toBe(false);
    expect(cpeMatchCovers(cpe('x:y', { versionEndIncluding: '1.2.3' }), '1.2.3')).toBe(true);
    expect(cpeMatchCovers(cpe('x:y', { versionStartExcluding: '1.0' }), '1.0')).toBe(false);
  });
  it('matches exact-version criteria and ignores non-vulnerable entries', () => {
    expect(cpeMatchCovers(cpe('clickhouse:clickhouse', {}, '24.3.3.102'), '24.3.3.102')).toBe(true);
    expect(cpeMatchCovers(cpe('clickhouse:clickhouse', {}, '24.3.3.102'), '24.3.3.103')).toBe(false);
    expect(cpeMatchCovers({ ...cpe('x:y'), vulnerable: false }, '1.0')).toBe(false);
  });
  it('handles ClickHouse per-branch ranges', () => {
    const ranges = [['23.3', '23.3.18.15'], ['23.8', '23.8.8.20']].map(([s, e]) =>
      cpe('clickhouse:clickhouse', { versionStartIncluding: s, versionEndExcluding: e }));
    expect(ranges.some(m => cpeMatchCovers(m, '23.8.2.7'))).toBe(true);
    expect(ranges.some(m => cpeMatchCovers(m, '23.8.8.20'))).toBe(false);
    expect(ranges.some(m => cpeMatchCovers(m, '25.12.1.649'))).toBe(false);
  });
});

describe('assessFromFeeds', () => {
  const nvd = [
    { id: 'CVE-1', published: '2024-01-01', description: 'old', severity: 'HIGH' as const, score: 7.5, cwes: [], references: [],
      matches: [cpe('elastic:elasticsearch', { versionStartIncluding: '8.0.0', versionEndExcluding: '8.13.0' })] },
    { id: 'CVE-2', published: '2024-02-01', description: 'not affected', severity: 'CRITICAL' as const, cwes: [], references: [],
      matches: [cpe('elastic:elasticsearch', { versionEndExcluding: '7.17.0' })] },
    { id: 'CVE-3', published: '2024-03-01', description: 'exploited', severity: 'MEDIUM' as const, cwes: [], references: [],
      matches: [cpe('elastic:elasticsearch', { versionEndExcluding: '8.11.1' })] },
  ];
  const osv = [
    { id: 'GHSA-a', aliases: ['CVE-1'], summary: 's', published: '', fixed: ['7.17.23', '8.13.0'], references: [] },
    { id: 'GHSA-b', aliases: [], summary: 'osv only', published: '', severityLabel: 'MODERATE', fixed: ['8.12.1'], references: [] },
  ];
  const kev = { 'CVE-3': { dateAdded: '2024-05-01', ransomware: 'Unknown', action: 'patch', due: '2024-06-01' } };

  it('merges sources, filters by version and ranks KEV first', () => {
    const f = assessFromFeeds('elasticsearch', '8.10.0', nvd, osv, kev);
    expect(f.map(x => x.id)).toEqual(['CVE-3', 'CVE-1', 'GHSA-b']);
    expect(f[1].sources).toEqual(['NVD', 'OSV']);
    expect(f[1].fixedIn).toEqual(['8.13.0']);
    expect(f[2].severity).toBe('MEDIUM');
    expect(f[0].kev?.dateAdded).toBe('2024-05-01');
  });

  it('recommends the smallest same-line version that fixes everything', () => {
    const f = assessFromFeeds('elasticsearch', '8.10.0', nvd, osv, kev);
    expect(recommendUpgrade('8.10.0', f)).toEqual({ upgradeTo: '8.13.0', fixesAll: true, unfixed: [] });
    expect(recommendUpgrade('8.10.0', [{ ...f[0], fixedIn: [] }]).unfixed).toEqual(['CVE-3']);
  });
});

describe('singleFlight', () => {
  it('shares one in-flight call between concurrent callers', async () => {
    const { singleFlight } = await import('@/lib/vuln-intel');
    let calls = 0;
    const slow = () => new Promise<number>(r => { calls++; setTimeout(() => r(42), 20); });
    const results = await Promise.all(Array.from({ length: 25 }, () => singleFlight('k', slow)));
    expect(results.every(r => r === 42)).toBe(true);
    expect(calls).toBe(1);
    await singleFlight('k', slow); // finished → next call fetches again
    expect(calls).toBe(2);
  });

  it('propagates errors and does not cache them', async () => {
    const { singleFlight } = await import('@/lib/vuln-intel');
    await expect(singleFlight('e', () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(singleFlight('e', () => Promise.resolve(1))).resolves.toBe(1);
  });
});
