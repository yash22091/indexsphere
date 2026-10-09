import { describe, expect, it } from 'vitest';
import { toRow } from '@/lib/migration-runner';

const cols = (defs: [string, string, string][]) => defs.map(([source, column, type]) => ({ source, column, type }));

describe('toRow', () => {
  it('reads nested and dotted-key fields and strips @ from column names', () => {
    const c = cols([['@timestamp', 'timestamp', 'DateTime64(3)'], ['agent.name', 'agent_name', 'LowCardinality(String)'], ['rule.level', 'rule_level', 'Int64']]);
    expect(toRow({ '@timestamp': '2026-01-01T00:00:00Z', agent: { name: 'web-1' }, rule: { level: 7 } }, c))
      .toEqual({ timestamp: '2026-01-01T00:00:00Z', agent_name: 'web-1', rule_level: 7 });
    expect(toRow({ 'agent.name': 'dotted' }, c)).toEqual({ agent_name: 'dotted' });
  });

  it('omits missing and null values so ClickHouse applies column defaults', () => {
    const c = cols([['a', 'a', 'String'], ['b', 'b', 'Int64']]);
    expect(toRow({ a: null }, c)).toEqual({});
  });

  it('handles multi-valued fields, objects, epoch dates, booleans and geo points', () => {
    const c = cols([
      ['tags', 'tags', 'String'], ['ports', 'ports', 'Int32'], ['meta', 'meta', 'String'], ['data', 'data', 'JSON'],
      ['ts', 'ts', 'DateTime64(3)'], ['ok', 'ok', 'Bool'], ['loc', 'loc', 'Point'], ['loc2', 'loc2', 'Point'],
    ]);
    const r = toRow({
      tags: ['a', 'b'], ports: [443, 80], meta: { x: 1 }, data: { k: 'v' }, ts: 0, ok: 'true',
      loc: { lat: 10, lon: 20 }, loc2: '1.5,2.5',
    }, c);
    expect(r).toEqual({
      tags: 'a, b', ports: 443, meta: '{"x":1}', data: { k: 'v' }, ts: '1970-01-01T00:00:00.000Z', ok: true,
      loc: [20, 10], loc2: [2.5, 1.5],
    });
  });

  it('takes the first element when walking through arrays of objects', () => {
    const c = cols([['hits.id', 'hit_id', 'String']]);
    expect(toRow({ hits: [{ id: 'x' }, { id: 'y' }] }, c)).toEqual({ hit_id: 'x' });
  });
});

describe('withRetry / isTransient', async () => {
  const { withRetry, isTransient } = await import('@/lib/migration-runner');
  const { ClickHouseError } = await import('@/lib/clickhouse');

  it('classifies transient errors', () => {
    expect(isTransient(new ClickHouseError('memory limit exceeded', 241, 500))).toBe(true);
    expect(isTransient(new ClickHouseError('too many parts', 252, 500))).toBe(true);
    expect(isTransient(new ClickHouseError('Cannot parse input', 27, 400))).toBe(false);
    expect(isTransient(new ClickHouseError('Unknown table', 60, 404))).toBe(false);
    expect(isTransient(new Error('Request failed: 429 Too Many Requests - es_rejected_execution_exception'))).toBe(true);
    expect(isTransient(new Error('socket hang up'))).toBe(true);
    expect(isTransient(new Error('Request failed: 400 Bad Request'))).toBe(false);
  });

  it('retries transient failures and then succeeds', async () => {
    let n = 0;
    const r = await withRetry(async () => { if (++n < 3) throw new ClickHouseError('memory', 241, 500); return 'ok'; }, { baseMs: 1 });
    expect(r).toBe('ok');
    expect(n).toBe(3);
  });

  it('does not retry permanent errors, and gives up after the attempt limit', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new ClickHouseError('bad', 27, 400); }, { baseMs: 1 })).rejects.toThrow('bad');
    expect(n).toBe(1);
    n = 0;
    await expect(withRetry(async () => { n++; throw new ClickHouseError('memory', 241, 500); }, { baseMs: 1, attempts: 3 })).rejects.toThrow('memory');
    expect(n).toBe(3);
  });

  it('stops retrying when the job is cancelled', async () => {
    let n = 0;
    await expect(withRetry(async () => { n++; throw new ClickHouseError('memory', 241, 500); }, { baseMs: 1, isCancelled: () => n >= 2 })).rejects.toThrow();
    expect(n).toBe(2);
  });
});
