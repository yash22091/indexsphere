import { describe, expect, it } from 'vitest';
import { parseClickHouseVersion, versionSupport } from '@/lib/clickhouse-config-review';
import { searchVersionSupport } from '@/lib/search-config-review';
import { Review, finalizeReview } from '@/lib/config-review';

describe('ClickHouse version support', () => {
  it('parses YY.MM versions and detects LTS', () => {
    expect(parseClickHouseVersion('25.8.2.29')).toEqual({ year: 2025, month: 8, lts: true });
    expect(parseClickHouseVersion('25.12.1.649')).toEqual({ year: 2025, month: 12, lts: false });
    expect(parseClickHouseVersion('garbage')).toBeNull();
  });

  it('supports stable releases ~3 months and LTS ~12 months', () => {
    const now = new Date(Date.UTC(2026, 9, 9)); // Oct 2026
    expect(versionSupport('26.8.1', now)).toMatchObject({ lts: true, supported: true, months: 2 });
    expect(versionSupport('25.8.1', now)).toMatchObject({ lts: true, supported: false });
    expect(versionSupport('26.9.1', now)).toMatchObject({ lts: false, supported: true });
    expect(versionSupport('25.12.1.649', now)).toMatchObject({ lts: false, supported: false, months: 10 });
  });
});

describe('Elasticsearch / OpenSearch version support', () => {
  it('classifies release lines', () => {
    expect(searchVersionSupport('elasticsearch', '9.1.0').status).toBe('current');
    expect(searchVersionSupport('elasticsearch', '8.19.3').status).toBe('current');
    expect(searchVersionSupport('elasticsearch', '8.15.0').status).toBe('maintenance');
    expect(searchVersionSupport('elasticsearch', '7.17.25').status).toBe('eol');
    expect(searchVersionSupport('opensearch', '3.6.0').status).toBe('current');
    expect(searchVersionSupport('opensearch', '2.19.1').status).toBe('maintenance');
    expect(searchVersionSupport('opensearch', '1.3.20').status).toBe('eol');
  });
});

describe('finalizeReview', () => {
  it('scores failures, counts severities and orders checks by category then status', () => {
    const r = new Review<'A' | 'B'>();
    r.pass({ id: 'a1', category: 'A', title: 'ok' });
    r.fail({ id: 'b1', category: 'B', title: 'bad', severity: 'high' });
    r.fail({ id: 'a2', category: 'A', title: 'meh', severity: 'low' });
    r.skip({ id: 'a3', category: 'A', title: 'n/a', detail: 'no privilege' });
    r.fail({ id: 'b2', category: 'B', title: 'fyi', severity: 'info' });
    const out = finalizeReview(r, ['A', 'B'], { version: '1', target: 'x' });
    expect(out.checks.map(c => c.id)).toEqual(['a2', 'a3', 'a1', 'b1', 'b2']);
    expect(out.summary).toMatchObject({ pass: 1, fail: 3, skipped: 1 });
    expect(out.summary.bySeverity).toMatchObject({ high: 1, low: 1, info: 1 });
    expect(out.score).toBe(100 - 12 - 2);
    expect(out.grade).toBe('B');
  });
});
